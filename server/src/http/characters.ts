/**
 * The routes for a player's characters in a universe (listed in shared/src/characters.ts)
 *
 * Every route needs a logged-in browser and a universe the player may play in its stage, except listing
 * the player's characters and their sheets, which a universe at the end of time still allows. The server
 * rolls ability scores and keeps them until a character is made with them, so asking again doesn't
 * roll again; the player only chooses which ability gets which score
 */
import { randomInt } from 'crypto';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { addMoney, barredOptionsOf, characterBar, canPlayUniverse, canViewUniverse, CHARACTER_STEPS, DEFAULT_ITEM_NAMES, defineMessages, DISALLOWED_TEXT_CHARACTERS, EQUIP_HANDS, EQUIP_RINGS, equipmentSlots, planEquip, startingEquipment, type EditorItem, type EquippedItem, type EquipRefusal, type EquipRequest, type GiveItemsRequest, type Ruleset, type UnequipRequest, isPf1eRollMethod, isReservedName, isSf1eClassRules, isUsable, isSf1eRaceRules, MAX_CHARACTER_NAME_LENGTH, NAME_MESSAGES, NEW_RACE_RULES, PF1E_ABILITIES, PF1E_MAX_POINT_BUY_SCORE, pf1ePointBuyBudget, rulesetHasThemes, SF1E_MAX_BOUGHT_SCORE, sf1eAbilityModifier, UNIVERSES_PATH, type CharacterDeletionPayload, type CharacterDraft, type CharacterListPayload, type CharacterSheet, type CreatedPayload, MAX_ITEMS_PER_CHARACTER_CHANGE, type CharacterItemsRequest, type EditableUniverseDetails, type EditorClass, type EditorRace, type ItemQuantity, type MessageDescriptor, type NewCharacterOptions, type NewCharacterRequest, type OptionName, type UniverseRole, type UniverseStage } from '@multiverse-kiln/shared';

import { countCharacters, createCharacter, deleteCharacter, deleteCharacterDraft, deletePf1eAbilityRoll, findCharacterDetails, findCharacterDraft, findLastPlayedCharacterId, findOwnCharacter, findPf1eAbilityRoll, giveCharacterItems, keepPf1eAbilityRoll, listCharacters, lockCarriedItems, lockCharacters, restoreCharacter, saveCharacterDraft, scheduleCharacterDeletion, takeCharacterItems, type CharacterDetails, type LockedCharacter } from '../db/characterRepo.js';
import { findEditorClass, loadEditorClasses } from '../db/classRepo.js';
import type { Executor } from '../db/client.js';
import { equipItems, listEquipment, unequipSlots } from '../db/equipmentRepo.js';
import { findMembership, listGroupMembers } from '../db/groupRepo.js';
import { lockPlayer } from '../db/playerRepo.js';
import { loadEditorItemsIn } from '../db/itemRepo.js';
import { findEditorRace, findRaceHasTail, loadEditorRaces } from '../db/raceRepo.js';
import { findPf1eSettings, findSf1eSettings, loadRulebookSettings } from '../db/rulesetRepo.js';
import { findSiteSettings } from '../db/siteSettingsRepo.js';
import { findEditorTheme, loadEditorThemes } from '../db/themeRepo.js';
import { inTransaction } from '../db/transactions.js';
import { findUniverseRole } from '../db/universeEditorRepo.js';
import { findEditableUniverse, lockUniverseShared } from '../db/universeRepo.js';
import type { WantedText } from '../db/universeTextRepo.js';
import { liveVersion } from '../db/universeVersions.js';
import { rollPf1eAbilityScores } from '../logic/abilityRolls.js';
import { characterChanges } from '../players/characterChanges.js';
import { characterItemChanges } from '../players/characterItemChanges.js';
import { abilityBonuses, areValidBaseScores, combineStartingItems, finalAbilityScores, isValidFloatingAbility, startingEquipmentOrder, type ScoreSource } from '../logic/characterCreation.js';
import { groupNoticeRates, postGiftNotice, tryTakeGroupNotice } from '../rooms/groupChatNotices.js';
import { displayText } from '../rooms/payloads.js';
import type { RateLimiter } from '../rooms/rateLimiter.js';
import { playerIdOf, refuseWritesFromOtherOrigins, requireLogin } from './editorAccess.js';
import { errorMessages, requestRoute, sendError, sendInvalidRequest, type Refusal } from './errors.js';
import { requestLanguages } from './requestLanguages.js';
import { UniverseTextTranslator } from './universeTextTranslator.js';

/**
 * The universe a character request is about
 */
export type PlayableUniverse = EditableUniverseDetails;

/**
 * A base ability score as sent: no rolled, bought or raised score is outside this
 */
const baseScore = z.number().int().min(0).max(Math.max(PF1E_MAX_POINT_BUY_SCORE, SF1E_MAX_BOUGHT_SCORE));

/**
 * NewCharacterRequest. Whether the race, class, theme and scores are allowed is checked by the route
 */
const newCharacterRequest = z.object({
	name: displayText(MAX_CHARACTER_NAME_LENGTH),
	raceId: z.number().int().min(1).max(2147483647),
	classId: z.number().int().min(1).max(2147483647),
	themeId: z.number().int().min(1).max(2147483647).nullable(),
	baseScores: z.object({
		strength: baseScore,
		dexterity: baseScore,
		constitution: baseScore,
		intelligence: baseScore,
		wisdom: baseScore,
		charisma: baseScore
	}),
	floatingAbility: z.enum(PF1E_ABILITIES).nullable()
}) satisfies z.ZodType<NewCharacterRequest>;

/**
 * CharacterDraft. Nothing in it is checked against the universe; a name may be empty while the player
 * hasn't written one
 */
const characterDraft = z.object({
	step: z.enum(CHARACTER_STEPS),
	name: z.string().max(MAX_CHARACTER_NAME_LENGTH).refine((text) => !DISALLOWED_TEXT_CHARACTERS.test(text), 'Contains disallowed characters'),
	raceId: z.number().int().min(1).max(2147483647).nullable(),
	classId: z.number().int().min(1).max(2147483647).nullable(),
	// Progress saved before themes existed has none
	themeId: z.number().int().min(1).max(2147483647).nullable().default(null),
	baseScores: newCharacterRequest.shape.baseScores.nullable(),
	floatingAbility: z.enum(PF1E_ABILITIES).nullable()
}) satisfies z.ZodType<CharacterDraft>;

/**
 * CharacterItemsRequest. Whether the items can be given, or are carried, is checked by the route
 */
export const characterItemsRequest = z.object({
	items: z.array(z.object({
		itemId: z.number().int().min(1).max(2147483647),
		quantity: z.number().int().min(1).max(2147483647)
	}))
		.min(1)
		.max(MAX_ITEMS_PER_CHARACTER_CHANGE)
		.refine((items) => (new Set(items.map(({ itemId }) => itemId)).size === items.length), 'Lists an item more than once')
}) satisfies z.ZodType<CharacterItemsRequest>;

/**
 * EquipRequest. Whether the character carries the item, and whether it can be held as asked, is
 * checked by the route
 */
export const equipRequest = z.object({
	itemId: z.number().int().min(1).max(2147483647),
	hand: z.enum(EQUIP_HANDS).nullable(),
	ring: z.enum(EQUIP_RINGS).nullable()
}) satisfies z.ZodType<EquipRequest>;

/**
 * UnequipRequest
 */
export const unequipRequest = z.object({
	itemId: z.number().int().min(1).max(2147483647),
	slot: z.string().min(1).max(40).nullable()
}) satisfies z.ZodType<UnequipRequest>;

/**
 * GiveItemsRequest. Whether the other character is in the group, and the item is carried, is checked
 * by the route
 */
export const giveItemsRequest = z.object({
	characterId: z.uuid(),
	itemId: z.number().int().min(1).max(2147483647),
	quantity: z.number().int().min(1).max(2147483647)
}) satisfies z.ZodType<GiveItemsRequest>;

/**
 * Reasons the character routes give (see shared/src/localization.ts)
 */
const messages = defineMessages({
	characterLimit: {
		id: 'error.characterLimit',
		defaultMessage: 'You can have at most {max, plural, one {# character} other {# characters}} in a universe.',
		description: 'Why a new character wasn\'t made: the player has as many characters in this universe as allowed'
	},
	scoresChanged: {
		id: 'error.scoresChanged',
		defaultMessage: 'The universe has changed how ability scores are made. Close Create Character and open it again.',
		description: 'Why a new character wasn\'t made: the universe\'s editor changed between rolling and buying ability scores, or how they are rolled, while the player was making the character'
	},
	invalidScores: {
		id: 'error.invalidScores',
		defaultMessage: 'The ability scores aren\'t allowed: use each rolled score once, or stay within the points you can spend.',
		description: 'Why a new character wasn\'t made: the ability scores sent weren\'t the rolled ones, or cost more points than allowed'
	},
	raceUnavailable: {
		id: 'error.raceUnavailable',
		defaultMessage: 'That race can\'t be chosen any more. Choose another.',
		description: 'Why a new character wasn\'t made: the race chosen was deleted or disabled while the player was making the character'
	},
	classUnavailable: {
		id: 'error.classUnavailable',
		defaultMessage: 'That class can\'t be chosen any more. Choose another.',
		description: 'Why a new character wasn\'t made: the class chosen was deleted or disabled while the player was making the character'
	},
	themeUnavailable: {
		id: 'error.themeUnavailable',
		defaultMessage: 'That theme can\'t be chosen any more. Choose another.',
		description: 'Why a new character wasn\'t made: the theme (character background, such as ace pilot) chosen was deleted or disabled while the player was making the character, or none was chosen'
	},
	floatingAbility: {
		id: 'error.floatingAbility',
		defaultMessage: 'Choose the ability that gets the race\'s bonus, and only for a race that has one.',
		description: 'Why a new character wasn\'t made: a race that lets the player choose an ability to raise had none chosen, or another race had one'
	},
	noSuchCharacter: {
		id: 'error.noSuchCharacter',
		defaultMessage: 'The character doesn\'t exist, or isn\'t yours.',
		description: 'Why a character\'s sheet couldn\'t be shown: the character isn\'t one of the player\'s in this universe'
	},
	lastRitesOff: {
		id: 'error.lastRitesOff',
		defaultMessage: 'Characters can\'t be given their last rites on this site. They can only be deleted immediately.',
		description: 'Why a character wasn\'t given their last rites (deleted after some days): the site\'s settings have turned waiting off'
	},
	inGroup: {
		id: 'error.deleteGroupMember',
		defaultMessage: 'That character is in a group. They have to leave it before they can be deleted.',
		description: 'Why a character wasn\'t deleted, immediately or after some days: characters in a group can\'t be deleted'
	},
	itemsNotCarried: {
		id: 'error.discardItemsNotCarried',
		defaultMessage: 'The character doesn\'t carry that item any more.',
		description: 'Why items weren\'t discarded from a character\'s sheet: the character no longer carries one of them, perhaps because it was discarded in another window first'
	},
	itemNotCarried: {
		id: 'error.equipItemNotCarried',
		defaultMessage: 'The character doesn\'t carry that item any more.',
		description: 'Why an item wasn\'t equipped from a character\'s sheet: the character no longer carries it, perhaps because it was discarded or given away in another window first'
	},
	giveItemNotCarried: {
		id: 'error.giveItemNotCarried',
		defaultMessage: 'The character doesn\'t carry that item any more.',
		description: 'Why an item wasn\'t given to another character from a character\'s sheet, by their player or from the editor\'s Character List tab: the character no longer carries it, perhaps because it was discarded or given away in another window first'
	},
	giveTooFast: {
		id: 'error.giveTooFast',
		defaultMessage: 'You are giving items too quickly. Wait a moment and try again.',
		description: 'Why an item wasn\'t given to another character from a character\'s sheet, by their player or from the editor\'s Character List tab: the player\'s characters gave items in, joined or left their group faster than allowed, since each gift, join and leave writes a line in the group\'s chat'
	},
	giveToSelf: {
		id: 'error.giveToSelf',
		defaultMessage: 'Choose another character to give the items to.',
		description: 'Why items weren\'t given from a character\'s sheet: the character chosen to get them was the one giving them'
	},
	notInGroupWith: {
		id: 'error.giveNotInGroup',
		defaultMessage: 'Items can only be given to another character in the same group.',
		description: 'Why items weren\'t given from a character\'s sheet: the giving character isn\'t in a group, or the character chosen to get them isn\'t in it any more'
	}
});

/**
 * Why an item can't be equipped as asked, by planEquip()'s refusal
 */
const EQUIP_REFUSALS: Record<EquipRefusal, MessageDescriptor> = defineMessages({
	notEquippable: {
		id: 'error.notEquippable',
		defaultMessage: 'That item can\'t be equipped that way.',
		description: 'Why an item wasn\'t equipped from a character\'s sheet: it can\'t be equipped at all, or not in the hands chosen, perhaps because the universe\'s creators changed where it equips'
	},
	noTail: {
		id: 'error.equipNoTail',
		defaultMessage: 'The character has no tail to wear that on.',
		description: 'Why an item wasn\'t equipped from a character\'s sheet: it is worn on the tail, such as a tail blade, and the character\'s race has no tail'
	},
	ringSlotsFull: {
		id: 'error.equipRingSlotsFull',
		defaultMessage: 'Both ring slots are full. Choose which ring to replace.',
		description: 'Why a ring wasn\'t equipped from a character\'s sheet: both of the character\'s ring slots filled up before it was equipped, so the item\'s menu now asks whether to equip it as the left or the right ring'
	}
});

const universes = new WeakMap<Request, PlayableUniverse>();

/**
 * Adds the character routes under UNIVERSES_PATH/:universeId/characters
 *
 * @param app Express app to add the routes to
 * @param allowedOrigins Normalized origins allowed to make characters from a browser
 */
export function addCharacterRoutes(app: Application, allowedOrigins: Set<string>): void
{
	const router = express.Router({ mergeParams: true });

	router.use((_request, response, next) =>
	{
		response.set('Cache-Control', 'no-store');
		next();
	});
	router.use(refuseWritesFromOtherOrigins(allowedOrigins));
	router.use(express.json());
	router.use(requireLogin);

	// Characters can be listed and looked at in a universe at the end of time, but not made or deleted
	router.get('/', loadViewableUniverse, listRoute);
	router.get('/new', loadPlayableUniverse, newCharacterRoute);
	router.put('/draft', loadPlayableUniverse, saveDraftRoute);
	router.delete('/draft', loadPlayableUniverse, deleteDraftRoute);
	router.post('/', loadPlayableUniverse, createRoute);
	router.get('/:characterId', loadViewableUniverse, sheetRoute);
	router.delete('/:characterId', loadPlayableUniverse, deleteRoute);
	router.put('/:characterId/deletion', loadPlayableUniverse, scheduleDeletionRoute);
	router.delete('/:characterId/deletion', loadPlayableUniverse, restoreRoute);
	router.post('/:characterId/items/discard', loadPlayableUniverse, discardRoute);
	router.post('/:characterId/items/equip', loadPlayableUniverse, equipRoute);
	router.post('/:characterId/items/unequip', loadPlayableUniverse, unequipRoute);
	router.post('/:characterId/items/give', loadPlayableUniverse, giveRoute);
	router.use(handleCharacterError);

	app.use(`${UNIVERSES_PATH}/:universeId/characters`, router);
}

/**
 * Makes middleware that loads the universe, answering 404 unless it isn't disabled and its stage and
 * the player's role in it pass a check
 *
 * @param allows The check, given the universe's stage and the player's role in it
 * @return The middleware
 */
function universeLoader(allows: (stage: UniverseStage, role: UniverseRole | undefined) => boolean): (request: Request, response: Response, next: NextFunction) => Promise<void>
{
	return(async (request, response, next) =>
	{
		const universeId = z.uuid().safeParse(request.params.universeId);
		const universe = (universeId.success ? await findAllowedUniverse(universeId.data, playerIdOf(request), allows) : undefined);

		if (universe)
		{
			universes.set(request, universe);
			next();
			return;
		}

		sendError(response, 404, errorMessages.noSuchUniverse);
	});
}

/**
 * Loads a universe's live version when it isn't disabled and its stage and the player's role in it pass
 * a check. Disabling a universe, changing its stage and changing roles all take the universe's lock, so
 * a transaction holding it reads what stays true until it commits
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @param allows The check, given the universe's stage and the player's role in it
 * @param executor The database, or a transaction
 * @return The universe, or undefined when there is none or the player may not
 */
export async function findAllowedUniverse(universeId: string, playerId: string, allows: (stage: UniverseStage, role: UniverseRole | undefined) => boolean, executor?: Executor): Promise<PlayableUniverse | undefined>
{
	const [universe, role] = await Promise.all([
		findEditableUniverse(liveVersion(universeId), executor),
		findUniverseRole(universeId, playerId, executor)
	]);

	return(((universe && (universe.disabledReason === null) && allows(universe.stage, role)) ? universe : undefined));
}

/**
 * Middleware that loads the universe, answering 404 unless the player may play it: it isn't disabled, and
 * its stage and the player's role in it allow them to
 */
export const loadPlayableUniverse = universeLoader(canPlayUniverse);

/**
 * Middleware that loads the universe, answering 404 unless the player may look at it: it isn't
 * disabled, and its stage and the player's role in it allow them to (canViewUniverse), which a universe
 * at the end of time allows everyone
 */
export const loadViewableUniverse = universeLoader(canViewUniverse);

/**
 * The universe of a request that has passed loadPlayableUniverse or loadViewableUniverse
 *
 * @param request The request
 * @return The universe
 */
export function universeOf(request: Request): PlayableUniverse
{
	const universe = universes.get(request);

	if (!universe)
	{
		throw new Error(`${request.method} ${request.path} reached a handler without loading its universe`);
	}

	return(universe);
}

/**
 * Loads a universe's translations of some kinds of text, for the languages a request asks for
 *
 * @param request The request
 * @param universe The universe
 * @param kinds The kinds of text the response shows, each whole or only some things'
 * @return The translator
 */
export async function loadTranslator(request: Request, universe: PlayableUniverse, kinds: readonly WantedText[]): Promise<UniverseTextTranslator>
{
	return(UniverseTextTranslator.load(universe, await requestLanguages(request), kinds));
}

/**
 * GET /: the player's characters in the universe
 *
 * @param request The request
 * @param response The response
 */
async function listRoute(request: Request, response: Response): Promise<void>
{
	const universe = universeOf(request);
	const playerId = playerIdOf(request);
	const [characters, races, classes, rulebooks, translator] = await Promise.all([
		listCharacters(playerId, universe.id),
		loadEditorRaces(liveVersion(universe.id), universe.ruleset),
		loadEditorClasses(liveVersion(universe.id), universe.ruleset),
		loadRulebookSettings(liveVersion(universe.id), universe.ruleset),
		loadTranslator(request, universe, ['race', 'class'])
	]);
	const barred = barredOptionsOf(races, classes, rulebooks);
	const lastPlayedId = await findLastPlayedCharacterId(playerId, universe.id, barred);
	const raceNames = new Map(races.map(({ id, key, name }) => [id, translator.name('race', id, { key, name })]));
	const classNames = new Map(classes.map(({ id, key, name }) => [id, translator.name('class', id, { key, name })]));
	const unnamed: OptionName = { key: null, name: null };
	const payload: CharacterListPayload = {
		ruleset: universe.ruleset,
		characters: characters.map(({ id, name, raceId, classId, deleteAt, groupId }) => ({
			id,
			name,
			race: (raceNames.get(raceId) ?? unnamed),
			characterClass: (classNames.get(classId) ?? unnamed),
			deleteAt: (deleteAt?.toISOString() ?? null),
			barredBy: characterBar({ raceId, classId }, barred),
			groupId
		})),
		lastPlayedId: (lastPlayedId ?? null)
	};

	response.json(payload);
}

/**
 * GET /:characterId: one of the player's characters, as their character sheet shows them
 *
 * @param request The request
 * @param response The response
 */
async function sheetRoute(request: Request, response: Response): Promise<void>
{
	const characterId = characterIdOf(request, response);
	const universe = universeOf(request);

	if (characterId === undefined)
	{
		return;
	}

	const character = await findCharacterDetails(playerIdOf(request), universe.id, universe.ruleset, characterId);

	if (!character)
	{
		sendError(response, 404, messages.noSuchCharacter);
		return;
	}

	response.json(await characterSheetOf(universe, character, (kinds) => loadTranslator(request, universe, kinds)));
}

/**
 * A character as their sheet shows them, with the universe's live version's races, classes, themes and
 * items
 *
 * @param universe The universe's live version
 * @param character The character
 * @param loadTexts Loads the translator for the kinds of universe text the sheet shows
 * @return The sheet
 */
export async function characterSheetOf(universe: PlayableUniverse, character: CharacterDetails, loadTexts: (kinds: readonly WantedText[]) => Promise<UniverseTextTranslator>): Promise<CharacterSheet>
{
	// Only the character's own items and their names' translations, of the thousands a universe can have
	const itemIds = character.items.map((item) => item.itemId);
	const groupLoad = findMembership(character.id)
		.then(async (membership) => ({
			membership,
			members: ((membership === undefined) ? [] : await listGroupMembers(membership.groupId))
		}));

	// The group's characters are listed with their races and classes, so their translations wait for the members
	const textsLoad = groupLoad
		.then(({ members }) => loadTexts([
			{
				kind: 'race',
				thingIds: [...new Set([character.raceId, ...members.map((member) => member.raceId)])]
			},
			{
				kind: 'class',
				thingIds: [...new Set([character.classId, ...members.map((member) => member.classId)])]
			},
			{
				kind: 'theme',
				thingIds: ((character.themeId === null) ? [] : [character.themeId])
			},
			{
				kind: 'item',
				thingIds: itemIds
			},
			'coin'
		]));
	const [{ membership, members }, races, classes, themes, rulebooks, siteSettings, items, translator] = await Promise.all([
		groupLoad,
		loadEditorRaces(liveVersion(universe.id), universe.ruleset),
		loadEditorClasses(liveVersion(universe.id), universe.ruleset),
		loadEditorThemes(liveVersion(universe.id), universe.ruleset),
		loadRulebookSettings(liveVersion(universe.id), universe.ruleset),
		findSiteSettings(),
		loadEditorItemsIn(liveVersion(universe.id), universe.ruleset, itemIds),
		textsLoad
	]);

	/**
	 * A race's name as the sheet shows it
	 *
	 * @param raceId The race's ID
	 * @return The name, in the player's language
	 */
	const raceNameOf = (raceId: number): OptionName =>
	{
		const option = races.find((candidate) => (candidate.id === raceId));

		return(translator.name('race', raceId, {
			key: (option?.key ?? null),
			name: (option?.name ?? null)
		}));
	};

	/**
	 * A class's name as the sheet shows it
	 *
	 * @param classId The class's ID
	 * @return The name, in the player's language
	 */
	const classNameOf = (classId: number): OptionName =>
	{
		const option = classes.find((candidate) => (candidate.id === classId));

		return(translator.name('class', classId, {
			key: (option?.key ?? null),
			name: (option?.name ?? null)
		}));
	};

	const race = races.find((option) => (option.id === character.raceId));
	const characterClass = classes.find((option) => (option.id === character.classId));
	const theme = themes.find((option) => (option.id === character.themeId));
	const itemsById = new Map(items.map((item) => [item.id, item]));
	const { hitPoints, staminaPoints } = ((universe.ruleset === 'sf1e')
		? sf1ePoints(race, characterClass, character.abilityScores.constitution)
		: { hitPoints: null, staminaPoints: null });
	const payload: CharacterSheet = {
		ruleset: universe.ruleset,
		id: character.id,
		name: character.name,
		race: raceNameOf(character.raceId),
		characterClass: classNameOf(character.classId),
		deleteAt: (character.deleteAt?.toISOString() ?? null),
		deletionDays: siteSettings.characterDeletionDays,
		group: ((membership === undefined)
			? null
			: {
				groupId: membership.groupId,
				isAnchor: membership.isAnchor,
				members: members
					.filter((member) => (member.characterId !== character.id))
					.map((member) => ({
						characterId: member.characterId,
						name: member.name,
						race: raceNameOf(member.raceId),
						characterClass: classNameOf(member.classId)
					}))
					.sort((a, b) => a.name.localeCompare(b.name))
			}),
		barredBy: characterBar(character, barredOptionsOf(races, classes, rulebooks)),
		size: (race?.rules.size ?? NEW_RACE_RULES[universe.ruleset].size),
		darkvision: (race?.rules.darkvision ?? NEW_RACE_RULES[universe.ruleset].darkvision),
		lightSensitivity: (race?.rules.lightSensitivity ?? NEW_RACE_RULES[universe.ruleset].lightSensitivity),
		theme: ((character.themeId === null)
			? null
			: translator.name('theme', character.themeId, {
				key: (theme?.key ?? null),
				name: (theme?.name ?? null)
			})),
		hitPoints,
		staminaPoints,
		abilityScores: character.abilityScores,
		money: character.money,
		coinNames: Object.fromEntries(Object.entries(universe.coinNames)
			.map(([coin, name]) => [coin, translator.text('coin', coin, 'name', name)])),
		coinAbbreviations: Object.fromEntries(Object.entries(universe.coinAbbreviations)
			.map(([coin, abbreviation]) => [coin, translator.text('coin', coin, 'abbreviation', abbreviation)])),
		items: character.items.map(({ itemId, quantity }) =>
		{
			const item = itemsById.get(itemId);

			return(translator.described('item', itemId, {
				id: itemId,
				key: (item?.key ?? null),
				name: (item?.name ?? null),
				description: (item?.description ?? null),
				category: (item?.category ?? ''),
				types: (item?.types ?? []),
				equips: (item?.equips ?? 'none'),
				rulebook: (item?.rulebook ?? null),
				quantity
			}));
		}),
		hasTail: raceHasTail(race),
		equipment: sortedEquipment(universe.ruleset, character.equipment)
	};

	return(payload);
}

/**
 * Whether a race's characters have a tail, which gives them the tail slot
 *
 * @param race The race as the universe sets it now, or undefined when it can't be found
 * @return True for a race with a tail; false for one without, one of a ruleset without tails, and one
 * that can't be found
 */
export function raceHasTail(race: EditorRace | undefined): boolean
{
	return(((race !== undefined) && !isSf1eRaceRules(race.rules) && race.rules.hasTail));
}

/**
 * Equipped items in the order the character sheet lists their slots
 *
 * @param ruleset The universe's ruleset
 * @param equipment The equipped items
 * @return The same items, sorted
 */
function sortedEquipment(ruleset: Ruleset, equipment: readonly EquippedItem[]): EquippedItem[]
{
	const slots = equipmentSlots(ruleset);

	return([...equipment].sort((a, b) => (slots.indexOf(a.slot) - slots.indexOf(b.slot))));
}

/**
 * A 1st-level Starfinder 1E character's hit points (their race's and class's) and stamina points (their
 * class's and their Constitution modifier, at least 0), as the race and class set them now
 *
 * @param race The character's race, or undefined when it can't be found
 * @param characterClass The character's class, or undefined when it can't be found
 * @param constitution The character's Constitution score
 * @return The points; a race or class that can't be found gives none
 */
function sf1ePoints(race: EditorRace | undefined, characterClass: EditorClass | undefined, constitution: number): { hitPoints: number; staminaPoints: number }
{
	const raceHitPoints = ((race && isSf1eRaceRules(race.rules)) ? race.rules.hitPoints : 0);
	const classRules = ((characterClass && isSf1eClassRules(characterClass.rules)) ? characterClass.rules : undefined);

	return({
		hitPoints: (raceHitPoints + (classRules?.hitPoints ?? 0)),
		staminaPoints: Math.max((classRules?.staminaPoints ?? 0) + sf1eAbilityModifier(constitution), 0)
	});
}

/**
 * The character a request's path names, answering 404 when the ID can't be one
 *
 * @param request The request
 * @param response The response
 * @return The character's ID, or undefined once the response has been sent
 */
function characterIdOf(request: Request, response: Response): string | undefined
{
	const characterId = z.uuid().safeParse(request.params.characterId);

	if (!characterId.success)
	{
		sendError(response, 404, messages.noSuchCharacter);
		return(undefined);
	}

	return(characterId.data);
}

/**
 * Refuses to delete a character who isn't the player's or is in a group. It locks the player's
 * characters first, so the character can't join a group before the transaction deletes them
 *
 * @param playerId The character's player's ID
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @param noSuchCharacter Why a character who isn't the player's can't be deleted
 * @param transaction The transaction that deletes the character
 * @return Why the character can't be deleted, or undefined when they can
 */
async function refuseDeletion(playerId: string, universeId: string, characterId: string, noSuchCharacter: MessageDescriptor, transaction: Executor): Promise<Refusal | undefined>
{
	await lockPlayer(playerId, transaction);

	if (!await findOwnCharacter(playerId, universeId, characterId, transaction))
	{
		return({ status: 404, message: noSuchCharacter });
	}

	if (await findMembership(characterId, transaction))
	{
		return({ status: 409, message: messages.inGroup });
	}

	return(undefined);
}

/**
 * DELETE /:characterId: deletes one of the player's characters immediately, unless they are in a group
 *
 * @param request The request
 * @param response The response
 */
async function deleteRoute(request: Request, response: Response): Promise<void>
{
	const characterId = characterIdOf(request, response);

	if (characterId === undefined)
	{
		return;
	}

	const refusal = await deleteCharacterNow(playerIdOf(request), universeOf(request).id, characterId, messages.noSuchCharacter);

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	response.sendStatus(204);
}

/**
 * Deletes a character immediately, unless they are in a group, and tells the rooms
 *
 * @param playerId The character's player's ID
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @param noSuchCharacter Why a character who isn't the player's can't be deleted
 * @return Why the character wasn't deleted, or undefined once they are
 */
export async function deleteCharacterNow(playerId: string, universeId: string, characterId: string, noSuchCharacter: MessageDescriptor): Promise<Refusal | undefined>
{
	const refusal = await inTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		const reason = await refuseDeletion(playerId, universeId, characterId, noSuchCharacter, transaction);

		if (reason)
		{
			return(reason);
		}

		await deleteCharacter(playerId, universeId, characterId, transaction);
		return(undefined);
	});

	if (!refusal)
	{
		characterChanges.publish({
			kind: 'removed',
			playerId,
			universeId,
			characterId
		});
	}

	return(refusal);
}

/**
 * PUT /:characterId/deletion: gives one of the player's characters their last rites, to be deleted the
 * site's characterDeletionDays from now, or refuses while it is 0 or the character is in a group. A
 * character already given them keeps their time
 *
 * @param request The request
 * @param response The response
 */
async function scheduleDeletionRoute(request: Request, response: Response): Promise<void>
{
	const characterId = characterIdOf(request, response);

	if (characterId === undefined)
	{
		return;
	}

	const result = await giveLastRites(playerIdOf(request), universeOf(request).id, characterId, messages.noSuchCharacter);

	if (!(result instanceof Date))
	{
		sendError(response, result.status, result.message, result.values);
		return;
	}

	const payload: CharacterDeletionPayload = { deleteAt: result.toISOString() };

	response.json(payload);
}

/**
 * Gives a character their last rites, to be deleted the site's characterDeletionDays from now, and
 * tells the rooms; refuses while it is 0 or the character is in a group. A character already given
 * them keeps their time
 *
 * @param playerId The character's player's ID
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @param noSuchCharacter Why a character who isn't the player's can't be deleted
 * @return When the character will be deleted, or why they weren't given their last rites
 */
export async function giveLastRites(playerId: string, universeId: string, characterId: string, noSuchCharacter: MessageDescriptor): Promise<Refusal | Date>
{
	const { characterDeletionDays } = await findSiteSettings();

	if (characterDeletionDays === 0)
	{
		return({ status: 409, message: messages.lastRitesOff });
	}

	const result = await inTransaction(async (transaction): Promise<Refusal | Date> =>
	{
		const reason = await refuseDeletion(playerId, universeId, characterId, noSuchCharacter, transaction);

		if (reason)
		{
			return(reason);
		}

		const scheduled = await scheduleCharacterDeletion(playerId, universeId, characterId, new Date(Date.now() + (characterDeletionDays * 24 * 60 * 60 * 1000)), transaction);

		return(scheduled ?? { status: 404, message: noSuchCharacter });
	});

	if (result instanceof Date)
	{
		characterChanges.publish({
			kind: 'removed',
			playerId,
			universeId,
			characterId
		});
	}

	return(result);
}

/**
 * DELETE /:characterId/deletion: restores one of the player's characters given their last rites
 *
 * @param request The request
 * @param response The response
 */
async function restoreRoute(request: Request, response: Response): Promise<void>
{
	const characterId = characterIdOf(request, response);

	if (characterId === undefined)
	{
		return;
	}

	if (!await restoreCharacterOf(playerIdOf(request), universeOf(request).id, characterId))
	{
		sendError(response, 404, messages.noSuchCharacter);
		return;
	}

	response.sendStatus(204);
}

/**
 * Restores a character given their last rites, and tells the rooms
 *
 * @param playerId The character's player's ID
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @return Whether the character was restored: false when the player has no such character waiting
 */
export async function restoreCharacterOf(playerId: string, universeId: string, characterId: string): Promise<boolean>
{
	const character = await restoreCharacter(playerId, universeId, characterId);

	if (!character)
	{
		return(false);
	}

	characterChanges.publish({
		kind: 'restored',
		playerId,
		universeId,
		character,
		inGroup: (await findMembership(characterId) !== undefined)
	});

	return(true);
}

/**
 * POST /:characterId/items/discard: discards items one of the player's characters carries, all of an
 * item when asked for as many as they carry or more
 *
 * @param request The request, with a CharacterItemsRequest
 * @param response The response
 */
async function discardRoute(request: Request, response: Response): Promise<void>
{
	const characterId = characterIdOf(request, response);

	if (characterId === undefined)
	{
		return;
	}

	const body = characterItemsRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const refusal = await discardItems(universeOf(request), characterId, body.data.items, playerIdOf(request), messages.noSuchCharacter);

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	response.sendStatus(204);
}

/**
 * Discards items a character carries, all of an item when asked for as many as they carry or more, and
 * tells their player's windows. Discarding more than are unequipped unequips the rest. Any item they
 * carry can be discarded, disabled ones included
 *
 * @param universe The universe's ID and ruleset
 * @param characterId The character's ID
 * @param items The items, each listed once, and how many of each to discard
 * @param playerId The player the character must belong to, or undefined for any player's, as the
 * universe's creators may
 * @param noSuchCharacter Why a character who isn't there can't have items discarded
 * @return Why nothing was discarded, or undefined once the items are
 */
export async function discardItems(universe: Pick<PlayableUniverse, 'id' | 'ruleset'>, characterId: string, items: readonly ItemQuantity[], playerId: string | undefined, noSuchCharacter: MessageDescriptor): Promise<Refusal | undefined>
{
	let changed: LockedCharacter | undefined;
	const refusal = await inTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		const character = await lockOwnCharacter(universe.id, characterId, playerId, noSuchCharacter, transaction);

		if ('status' in character)
		{
			return(character);
		}

		if (!await takeCharacterItems(characterId, universe.ruleset, items, transaction))
		{
			return({ status: 409, message: messages.itemsNotCarried });
		}

		changed = character;
		return(undefined);
	});

	if (changed)
	{
		characterItemChanges.publishChanged(universe.id, [{ characterId, playerId: changed.playerId }]);
	}

	return(refusal);
}

/**
 * Makes a route that changes one of the player's characters' items or equipment
 *
 * @param body The request's validator
 * @param change Makes the change, given the universe, the character, the body and the player
 * @return The route, answering 204 once the change is made
 */
function itemRoute<Body>(body: z.ZodType<Body>, change: (universe: PlayableUniverse, characterId: string, request: Body, playerId: string, noSuchCharacter: MessageDescriptor) => Promise<Refusal | undefined>): (request: Request, response: Response) => Promise<void>
{
	return(async (request, response) =>
	{
		const characterId = characterIdOf(request, response);

		if (characterId === undefined)
		{
			return;
		}

		const parsed = body.safeParse(request.body);

		if (!parsed.success)
		{
			sendInvalidRequest(response, parsed.error);
			return;
		}

		const refusal = await change(universeOf(request), characterId, parsed.data, playerIdOf(request), messages.noSuchCharacter);

		if (refusal)
		{
			sendError(response, refusal.status, refusal.message, refusal.values);
			return;
		}

		response.sendStatus(204);
	});
}

/**
 * POST /:characterId/items/equip: equips an item one of the player's characters carries
 */
const equipRoute = itemRoute(equipRequest, equipItem);

/**
 * POST /:characterId/items/unequip: unequips an item one of the player's characters has equipped
 */
const unequipRoute = itemRoute(unequipRequest, unequipItem);

/**
 * POST /:characterId/items/give: gives items one of the player's characters carries to another
 * character in their group
 */
const giveRoute = itemRoute(giveItemsRequest, giveItems);

/**
 * Locks a character while their items or equipment change, refusing one who isn't there or isn't the
 * player's. The universe's shared lock comes first, so a world editor save changing where items equip or
 * taking them waits for the change, or the change waits for the save and reads what it saved. The
 * character's lock makes two changes to their items wait for each other
 *
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @param playerId The player the character must belong to, or undefined for any player's
 * @param noSuchCharacter Why a character who isn't there can't be changed
 * @param transaction The transaction making the change
 * @return The character, or why they can't be changed
 */
async function lockOwnCharacter(universeId: string, characterId: string, playerId: string | undefined, noSuchCharacter: MessageDescriptor, transaction: Executor): Promise<LockedCharacter | Refusal>
{
	await lockUniverseShared(universeId, transaction);

	const character = (await lockCharacters(universeId, [characterId], transaction)).get(characterId);

	if (!character || ((playerId !== undefined) && (character.playerId !== playerId)))
	{
		return({ status: 404, message: noSuchCharacter });
	}

	return(character);
}

/**
 * Equips an item a character carries, unequipping what was in its slots (planEquip()). Any item they
 * carry can be equipped, disabled ones and those whose book is off included
 *
 * @param universe The universe's ID and ruleset; its live version's items are used
 * @param characterId The character's ID
 * @param request The item, the hands to hold it in and the ring slot to put it in
 * @param playerId The player the character must belong to, or undefined for any player's, as the
 * universe's creators may
 * @param noSuchCharacter Why a character who isn't there can't equip items
 * @return Why nothing was equipped, or undefined once it is
 */
export async function equipItem(universe: Pick<PlayableUniverse, 'id' | 'ruleset'>, characterId: string, request: EquipRequest, playerId: string | undefined, noSuchCharacter: MessageDescriptor): Promise<Refusal | undefined>
{
	let changed: LockedCharacter | undefined;
	const refusal = await inTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		const character = await lockOwnCharacter(universe.id, characterId, playerId, noSuchCharacter, transaction);

		if ('status' in character)
		{
			return(character);
		}

		// Locked, so none can be taken between counting them and equipping them
		const quantity = ((await lockCarriedItems(characterId, [request.itemId], transaction)).get(request.itemId) ?? 0);

		if (quantity === 0)
		{
			return({ status: 409, message: messages.itemNotCarried });
		}

		const equipment = await listEquipment(characterId, transaction);
		const items = new Map((await loadEditorItemsIn(liveVersion(universe.id), universe.ruleset, [request.itemId, ...equipment.map((equipped) => equipped.itemId)], transaction))
			.map((item) => [item.id, item]));
		const item = items.get(request.itemId);

		if (!item)
		{
			return({ status: 409, message: messages.itemNotCarried });
		}

		const hasTail = await findRaceHasTail(liveVersion(universe.id), universe.ruleset, character.raceId, transaction);
		const plan = planEquip(universe.ruleset, equipment, items, item, quantity, request.hand, hasTail, request.ring);

		if (typeof plan === 'string')
		{
			return({ status: 409, message: EQUIP_REFUSALS[plan] });
		}

		if (plan.added === null)
		{
			return(undefined);
		}

		await unequipSlots(characterId, plan.removed.map((equipped) => equipped.slot), transaction);
		await equipItems(characterId, [plan.added], transaction);
		changed = character;
		return(undefined);
	});

	if (changed)
	{
		characterItemChanges.publishChanged(universe.id, [{ characterId, playerId: changed.playerId }]);
	}

	return(refusal);
}

/**
 * Unequips an item from one of a character's slots, or from everywhere it is equipped. An item that
 * isn't equipped there changes nothing
 *
 * @param universe The universe's ID and ruleset
 * @param characterId The character's ID
 * @param request The item and the slot
 * @param playerId The player the character must belong to, or undefined for any player's, as the
 * universe's creators may
 * @param noSuchCharacter Why a character who isn't there can't unequip items
 * @return Why nothing was unequipped, or undefined once it is
 */
export async function unequipItem(universe: Pick<PlayableUniverse, 'id' | 'ruleset'>, characterId: string, request: UnequipRequest, playerId: string | undefined, noSuchCharacter: MessageDescriptor): Promise<Refusal | undefined>
{
	let changed: LockedCharacter | undefined;
	const refusal = await inTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		const character = await lockOwnCharacter(universe.id, characterId, playerId, noSuchCharacter, transaction);

		if ('status' in character)
		{
			return(character);
		}

		const slots = (await listEquipment(characterId, transaction))
			.filter((equipped) => ((equipped.itemId === request.itemId) && ((request.slot === null) || (equipped.slot === request.slot))))
			.map((equipped) => equipped.slot);

		if (slots.length > 0)
		{
			await unequipSlots(characterId, slots, transaction);
			changed = character;
		}

		return(undefined);
	});

	if (changed)
	{
		characterItemChanges.publishChanged(universe.id, [{ characterId, playerId: changed.playerId }]);
	}

	return(refusal);
}

/**
 * Gives an item a character carries to another character in their group, the same player's included,
 * online or not: all of it when asked for as many as they carry or more. Those given that were equipped
 * are unequipped (unequippedByRemoval()), and they arrive unequipped. Once given, both players' windows
 * hear of it, and the group's chat says who gave whom what. Any item the character carries can be given,
 * disabled ones and those whose book is off included. Each gift is a line in the group's chat, so it
 * counts toward the limit on the notices the giving character's player's characters write in their
 * group (tryTakeGroupNotice()), whether their player or the universe's creators give it
 *
 * @param universe The universe's ID and ruleset; its live version's items name what is given
 * @param characterId The giving character's ID
 * @param request Who gets the item, and how many
 * @param playerId The player the giving character must belong to, or undefined for any player's, as
 * the universe's creators may
 * @param noSuchCharacter Why a character who isn't there can't give items
 * @param notices How fast each player's characters write notices in each group's chat
 * @return Why nothing was given, or undefined once it is
 */
export async function giveItems(universe: Pick<PlayableUniverse, 'id' | 'ruleset'>, characterId: string, request: GiveItemsRequest, playerId: string | undefined, noSuchCharacter: MessageDescriptor, notices: RateLimiter = groupNoticeRates): Promise<Refusal | undefined>
{
	if (request.characterId === characterId)
	{
		return({ status: 400, message: messages.giveToSelf });
	}

	let gift: Gift | undefined;
	const refusal = await inTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		// Disabling items with remove waits for the universe's lock, so none is taken while it is given
		await lockUniverseShared(universe.id, transaction);

		const locked = await lockCharacters(universe.id, [characterId, request.characterId], transaction);
		const giver = locked.get(characterId);
		const receiver = locked.get(request.characterId);

		if (!giver || ((playerId !== undefined) && (giver.playerId !== playerId)))
		{
			return({ status: 404, message: noSuchCharacter });
		}

		const membership = await findMembership(characterId, transaction);

		if (!membership || !receiver || ((await findMembership(receiver.id, transaction))?.groupId !== membership.groupId))
		{
			return({ status: 409, message: messages.notInGroupWith });
		}

		// Before anything is written, since a refusal still commits the transaction
		if (!tryTakeGroupNotice(membership.groupId, giver.playerId, notices))
		{
			return({ status: 429, message: messages.giveTooFast });
		}

		const carried = ((await lockCarriedItems(characterId, [request.itemId], transaction)).get(request.itemId) ?? 0);
		const given: ItemQuantity = {
			itemId: request.itemId,
			quantity: Math.min(request.quantity, carried)
		};

		if ((given.quantity === 0) || !await takeCharacterItems(characterId, universe.ruleset, [given], transaction))
		{
			return({ status: 409, message: messages.giveItemNotCarried });
		}

		await giveCharacterItems(receiver.id, [given], transaction);

		const item = (await loadEditorItemsIn(liveVersion(universe.id), universe.ruleset, [given.itemId], transaction))
			.find((found) => (found.id === given.itemId));

		gift = {
			groupId: membership.groupId,
			giver,
			receiver,
			item: {
				key: (item?.key ?? null),
				name: (item?.name ?? null)
			},
			quantity: given.quantity
		};

		return(undefined);
	});

	if (gift)
	{
		announceGift(universe, characterId, gift);
	}

	return(refusal);
}

/**
 * Items one character gave another, as given
 */
interface Gift
{
	groupId: string;
	giver: LockedCharacter;
	receiver: LockedCharacter;

	/**
	 * The item given, named as the universe names it
	 */
	item: OptionName;

	quantity: number;
}

/**
 * Tells both players' windows that the characters' items changed, the receiver's who gave them what,
 * and the group's chat
 *
 * @param universe The universe's ID and ruleset
 * @param giverId The giving character's ID
 * @param gift What was given
 */
function announceGift(universe: Pick<PlayableUniverse, 'id' | 'ruleset'>, giverId: string, gift: Gift): void
{
	const { giver, receiver, item, quantity } = gift;
	const universeId = universe.id;

	characterItemChanges.publishChanged(universeId, [
		{
			characterId: giverId,
			playerId: giver.playerId
		},
		{
			characterId: receiver.id,
			playerId: receiver.playerId
		}
	]);

	characterItemChanges.publish({
		kind: 'received',
		playerId: receiver.playerId,
		received: {
			universeId,
			ruleset: universe.ruleset,
			characterId: receiver.id,
			giver: giver.name,
			receiver: receiver.name,
			item,
			quantity
		}
	});
	void postGiftNotice(universeId, gift.groupId, {
		playerId: giver.playerId,
		name: giver.name
	}, {
		receiver: receiver.name,
		item,
		quantity
	});
}

/**
 * GET /new: what Create Character offers, rolling the player's ability scores if the universe rolls
 * them and none are kept
 *
 * @param request The request
 * @param response The response
 */
async function newCharacterRoute(request: Request, response: Response): Promise<void>
{
	const universe = universeOf(request);
	const playerId = playerIdOf(request);
	const [abilities, races, classes, themes, { rulebooks }, characterCount, siteSettings, storedDraft, translator] = await Promise.all([
		offerAbilities(universe, playerId),
		loadEditorRaces(liveVersion(universe.id), universe.ruleset),
		loadEditorClasses(liveVersion(universe.id), universe.ruleset),
		loadEditorThemes(liveVersion(universe.id), universe.ruleset),
		loadRulebookSettings(liveVersion(universe.id), universe.ruleset),
		countCharacters(playerId, universe.id),
		findSiteSettings(),
		findCharacterDraft(playerId, universe.id),
		loadTranslator(request, universe, ['universe', 'race', 'class', 'theme'])
	]);

	// Progress saved by an older version of Create Character is dropped rather than refused
	const draft = characterDraft.safeParse(storedDraft);
	const payload: NewCharacterOptions = {
		universeName: translator.text('universe', universe.id, 'name', universe.name),
		ruleset: universe.ruleset,
		abilities,
		races: races
			.filter((race) => isUsable(race, rulebooks))
			.map(({ id, key, name, description, rules }) => translator.described('race', id, { id, key, name, description, rules })),
		classes: classes
			.filter((characterClass) => isUsable(characterClass, rulebooks))
			.map(({ id, key, name, description, rules }) => translator.described('class', id, { id, key, name, description, rules })),
		themes: themes
			.filter((theme) => isUsable(theme, rulebooks))
			.map(({ id, key, name, description, rules }) => translator.described('theme', id, { id, key, name, description, rules })),
		characterCount,
		characterLimit: siteSettings.charactersPerUniverse,
		draft: (draft.success ? draft.data : null)
	};

	response.json(payload);
}

/**
 * How a universe's new characters get their ability scores, rolling the player's scores if the universe
 * rolls them and none are kept
 *
 * @param universe The universe
 * @param playerId The player's ID
 * @return What Create Character offers
 */
async function offerAbilities(universe: PlayableUniverse, playerId: string): Promise<NewCharacterOptions['abilities']>
{
	if (universe.ruleset === 'sf1e')
	{
		return({
			kind: 'abilityPoints',
			points: (await findSf1eSettings(liveVersion(universe.id))).abilityPoints
		});
	}

	const settings = await findPf1eSettings(liveVersion(universe.id));
	const { statMethod } = settings;

	if (isPf1eRollMethod(statMethod))
	{
		const roll = await keepPf1eAbilityRoll(playerId, universe.id, {
			statMethod,
			scores: rollPf1eAbilityScores(statMethod, secureRandom)
		});

		return({
			kind: 'roll',
			statMethod,
			rolls: roll.scores
		});
	}

	return({
		kind: 'pointBuy',
		statMethod,
		budget: pf1ePointBuyBudget(statMethod, settings.customPointBuyBudget)
	});
}

/**
 * PUT /draft: saves the player's progress in Create Character
 *
 * @param request The request
 * @param response The response
 */
async function saveDraftRoute(request: Request, response: Response): Promise<void>
{
	const body = characterDraft.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	await saveCharacterDraft(playerIdOf(request), universeOf(request).id, body.data);
	response.sendStatus(204);
}

/**
 * DELETE /draft: throws away the player's progress in Create Character, keeping their rolled scores
 *
 * @param request The request
 * @param response The response
 */
async function deleteDraftRoute(request: Request, response: Response): Promise<void>
{
	await deleteCharacterDraft(playerIdOf(request), universeOf(request).id);
	response.sendStatus(204);
}

/**
 * POST /: makes a character with the scores and choices sent, and what the universe, race and class
 * start characters with
 *
 * @param request The request
 * @param response The response
 */
async function createRoute(request: Request, response: Response): Promise<void>
{
	const body = newCharacterRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const playerId = playerIdOf(request);
	const { id: universeId } = universeOf(request);
	const { name, raceId, classId, themeId, baseScores, floatingAbility } = body.data;

	if (isReservedName(name))
	{
		sendError(response, 400, NAME_MESSAGES.reserved);
		return;
	}

	const result = await inTransaction(async (transaction): Promise<Refusal | string> =>
	{
		// Concurrent requests from the same player wait here, so they can't all slip under the limit.
		// Deleting a race, class or item waits for the universe's lock, so none goes while it is given out.
		// The lock is shared, so players creating characters in the same universe don't wait for each other
		await lockPlayer(playerId, transaction);
		await lockUniverseShared(universeId, transaction);

		const universe = await findAllowedUniverse(universeId, playerId, canPlayUniverse, transaction);

		if (!universe)
		{
			return({
				status: 404,
				message: errorMessages.noSuchUniverse
			});
		}

		const { charactersPerUniverse } = await findSiteSettings(transaction);

		if (await countCharacters(playerId, universeId, transaction) >= charactersPerUniverse)
		{
			return({
				status: 409,
				message: messages.characterLimit,
				values: { max: charactersPerUniverse }
			});
		}

		const source = await findScoreSource(universe, playerId, transaction);

		if (source === undefined)
		{
			return({
				status: 409,
				message: messages.scoresChanged
			});
		}

		const { rulebooks } = await loadRulebookSettings(liveVersion(universeId), universe.ruleset, transaction);
		const race = await findEditorRace(liveVersion(universeId), universe.ruleset, raceId, transaction);

		if (!race || !isUsable(race, rulebooks))
		{
			return({
				status: 409,
				message: messages.raceUnavailable
			});
		}

		const characterClass = await findEditorClass(liveVersion(universeId), universe.ruleset, classId, transaction);

		if (!characterClass || !isUsable(characterClass, rulebooks))
		{
			return({
				status: 409,
				message: messages.classUnavailable
			});
		}

		const theme = ((rulesetHasThemes(universe.ruleset) && (themeId !== null))
			? await findEditorTheme(liveVersion(universeId), universe.ruleset, themeId, transaction)
			: undefined);

		if (rulesetHasThemes(universe.ruleset) ? (!theme || !isUsable(theme, rulebooks)) : (themeId !== null))
		{
			return({
				status: 409,
				message: messages.themeUnavailable
			});
		}

		if (!isValidFloatingAbility(race.rules, floatingAbility))
		{
			return({
				status: 400,
				message: messages.floatingAbility
			});
		}

		const bonuses = abilityBonuses(universe.ruleset, race.rules, floatingAbility, (theme?.rules ?? null));

		if (!areValidBaseScores(baseScores, source, bonuses))
		{
			return({
				status: 400,
				message: messages.invalidScores
			});
		}

		const startingItems = [universe.startingItems, race.startingItems, characterClass.startingItems];
		const usableItems = new Map((await loadEditorItemsIn(liveVersion(universeId), universe.ruleset, startingItems.flat().map((item) => item.itemId), transaction))
			.filter((item) => isUsable(item, rulebooks))
			.map((item) => [item.id, item]));
		const items = combineStartingItems(startingItems, new Set(usableItems.keys()));
		const characterId = await createCharacter({
			playerId,
			universeId,
			ruleset: universe.ruleset,
			name,
			raceId,
			classId,
			themeId: (theme?.id ?? null),
			abilityScores: finalAbilityScores(universe.ruleset, baseScores, bonuses),
			money: addMoney([universe.startingMoney, race.startingMoney, characterClass.startingMoney]),
			items
		}, transaction);
		const equipmentOrder = startingEquipmentOrder([characterClass.startingItems, race.startingItems, universe.startingItems], items, usableItems, (itemId) => itemName(universe.ruleset, usableItems.get(itemId)));

		await equipItems(characterId, startingEquipment(universe.ruleset, equipmentOrder, raceHasTail(race)), transaction);

		if (source.kind === 'roll')
		{
			await deletePf1eAbilityRoll(playerId, universeId, transaction);
		}

		await deleteCharacterDraft(playerId, universeId, transaction);

		return(characterId);
	});

	if (typeof result !== 'string')
	{
		sendError(response, result.status, result.message, result.values);
		return;
	}

	const payload: CreatedPayload = { id: result };

	response.status(201).json(payload);
}

/**
 * An item's name as the universe names it, in the universe's own words or a default item's English
 *
 * @param ruleset The universe's ruleset
 * @param item The item, or undefined when it can't be found
 * @return The name, or an empty string for an item that can't be found
 */
function itemName(ruleset: Ruleset, item: EditorItem | undefined): string
{
	if (!item)
	{
		return('');
	}

	if (item.name !== null)
	{
		return(item.name);
	}

	const names = DEFAULT_ITEM_NAMES[ruleset];

	return((((item.key !== null) && Object.hasOwn(names, item.key)) ? names[item.key].defaultMessage : ''));
}

/**
 * Where a new character's base ability scores have to come from, under the universe's settings now
 *
 * @param universe The universe
 * @param playerId The player's ID
 * @param executor A transaction
 * @return The rolls, point buy budget or ability points, or undefined when the universe rolls scores but
 * the scores kept for the player weren't rolled the way it rolls them now
 */
async function findScoreSource(universe: PlayableUniverse, playerId: string, executor: Executor): Promise<ScoreSource | undefined>
{
	if (universe.ruleset === 'sf1e')
	{
		return({
			kind: 'abilityPoints',
			points: (await findSf1eSettings(liveVersion(universe.id), executor)).abilityPoints
		});
	}

	const settings = await findPf1eSettings(liveVersion(universe.id), executor);

	if (!isPf1eRollMethod(settings.statMethod))
	{
		return({
			kind: 'pointBuy',
			budget: pf1ePointBuyBudget(settings.statMethod, settings.customPointBuyBudget)
		});
	}

	const roll = await findPf1eAbilityRoll(playerId, universe.id, executor);

	if (roll?.statMethod !== settings.statMethod)
	{
		return(undefined);
	}

	return({
		kind: 'roll',
		rolls: roll.scores
	});
}

/**
 * A random number from 0 up to but not including 1, from the operating system's secure source, so
 * rolls can't be predicted
 *
 * @return The number
 */
function secureRandom(): number
{
	return(randomInt(0, 2 ** 47) / (2 ** 47));
}

/**
 * Answers errors from the character routes: 4xx errors from parsing the body as they are, anything
 * else as 500
 *
 * @param error What went wrong
 * @param request The request
 * @param response The response
 * @param next The next error handler, for when the response has already started
 */
function handleCharacterError(error: unknown, request: Request, response: Response, next: NextFunction): void
{
	if (response.headersSent)
	{
		next(error);
		return;
	}

	const status = (((typeof error === 'object') && (error !== null) && ('status' in error) && (typeof error.status === 'number')) ? error.status : 500);

	if ((status >= 400) && (status < 500))
	{
		sendError(response, status, errorMessages.unreadableBody);
		return;
	}

	console.error('Character request %s %s failed:', request.method, requestRoute(request), error);
	sendError(response, 500, errorMessages.somethingWentWrong);
}
