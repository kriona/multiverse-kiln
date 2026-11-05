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
import { addMoney, barredOptionsOf, characterBar, canPlayUniverse, canViewUniverse, CHARACTER_STEPS, defineMessages, DISALLOWED_TEXT_CHARACTERS, isPf1eRollMethod, isReservedName, isSf1eClassRules, isSf1eRaceRules, MAX_CHARACTER_NAME_LENGTH, MAX_CHARACTERS_PER_UNIVERSE, NAME_MESSAGES, NEW_RACE_RULES, PF1E_ABILITIES, PF1E_MAX_POINT_BUY_SCORE, pf1ePointBuyBudget, rulesetHasThemes, SF1E_MAX_BOUGHT_SCORE, sf1eAbilityModifier, UNIVERSES_PATH, type CharacterDeletionPayload, type CharacterDraft, type CharacterListPayload, type CharacterSheet, type CreatedPayload, type EditableUniverseDetails, type EditorClass, type EditorRace, type NewCharacterOptions, type NewCharacterRequest, type OptionName, type UniverseRole, type UniverseStage, type UniverseTextKind } from '@multiverse-kiln/shared';

import { countCharacters, createCharacter, deleteCharacter, deleteCharacterDraft, deletePf1eAbilityRoll, findCharacterDetails, findCharacterDraft, findLastPlayedCharacterId, findOwnCharacter, findPf1eAbilityRoll, keepPf1eAbilityRoll, listCharacters, restoreCharacter, saveCharacterDraft, scheduleCharacterDeletion } from '../db/characterRepo.js';
import { loadEditorClasses } from '../db/classRepo.js';
import type { Executor } from '../db/client.js';
import { findMembership } from '../db/groupRepo.js';
import { lockPlayer } from '../db/playerRepo.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { findPf1eSettings, findSf1eSettings } from '../db/rulesetRepo.js';
import { findSiteSettings } from '../db/siteSettingsRepo.js';
import { loadEditorThemes } from '../db/themeRepo.js';
import { inTransaction } from '../db/transactions.js';
import { findUniverseRole } from '../db/universeEditorRepo.js';
import { findEditableUniverse, lockUniverse } from '../db/universeRepo.js';
import { liveVersion } from '../db/universeVersions.js';
import { rollPf1eAbilityScores } from '../logic/abilityRolls.js';
import { characterChanges } from '../players/characterChanges.js';
import { abilityBonuses, areValidBaseScores, combineStartingItems, finalAbilityScores, isValidFloatingAbility, type ScoreSource } from '../logic/characterCreation.js';
import { displayText } from '../rooms/payloads.js';
import { playerIdOf, refuseWritesFromOtherOrigins, requireLogin } from './editorAccess.js';
import { errorMessages, sendError, sendInvalidRequest, type Refusal } from './errors.js';
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

		if (universeId.success)
		{
			const [universe, role] = await Promise.all([
				findEditableUniverse(liveVersion(universeId.data)),
				findUniverseRole(universeId.data, playerIdOf(request))
			]);

			if (universe && (universe.disabledReason === null) && allows(universe.stage, role))
			{
				universes.set(request, universe);
				next();
				return;
			}
		}

		sendError(response, 404, errorMessages.noSuchUniverse);
	});
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
 * @param kinds The kinds of text the response shows
 * @return The translator
 */
export async function loadTranslator(request: Request, universe: PlayableUniverse, kinds: readonly UniverseTextKind[]): Promise<UniverseTextTranslator>
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
	const [characters, races, classes, translator] = await Promise.all([
		listCharacters(playerId, universe.id),
		loadEditorRaces(liveVersion(universe.id), universe.ruleset),
		loadEditorClasses(liveVersion(universe.id), universe.ruleset),
		loadTranslator(request, universe, ['race', 'class'])
	]);
	const barred = barredOptionsOf(races, classes);
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

	const [character, membership, races, classes, themes, items, siteSettings, translator] = await Promise.all([
		findCharacterDetails(playerIdOf(request), universe.id, universe.ruleset, characterId),
		findMembership(characterId),
		loadEditorRaces(liveVersion(universe.id), universe.ruleset),
		loadEditorClasses(liveVersion(universe.id), universe.ruleset),
		loadEditorThemes(liveVersion(universe.id), universe.ruleset),
		loadEditorItems(liveVersion(universe.id), universe.ruleset),
		findSiteSettings(),
		loadTranslator(request, universe, ['race', 'class', 'theme', 'item'])
	]);

	if (!character)
	{
		sendError(response, 404, messages.noSuchCharacter);
		return;
	}

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
		race: translator.name('race', character.raceId, {
			key: (race?.key ?? null),
			name: (race?.name ?? null)
		}),
		characterClass: translator.name('class', character.classId, {
			key: (characterClass?.key ?? null),
			name: (characterClass?.name ?? null)
		}),
		deleteAt: (character.deleteAt?.toISOString() ?? null),
		deletionDays: siteSettings.characterDeletionDays,
		group: ((membership === undefined)
			? null
			: {
				groupId: membership.groupId,
				isAnchor: membership.isAnchor
			}),
		barredBy: characterBar(character, barredOptionsOf(races, classes)),
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
		items: character.items.map(({ itemId, quantity }) =>
		{
			const item = itemsById.get(itemId);

			return(translator.name('item', itemId, {
				id: itemId,
				key: (item?.key ?? null),
				name: (item?.name ?? null),
				type: (item?.type ?? ''),
				quantity
			}));
		})
	};

	response.json(payload);
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
 * @param playerId The player's ID
 * @param universeId The universe's ID
 * @param characterId The character's ID
 * @param transaction The transaction that deletes the character
 * @return Why the character can't be deleted, or undefined when they can
 */
async function refuseDeletion(playerId: string, universeId: string, characterId: string, transaction: Executor): Promise<Refusal | undefined>
{
	await lockPlayer(playerId, transaction);

	if (!await findOwnCharacter(playerId, universeId, characterId, transaction))
	{
		return({ status: 404, message: messages.noSuchCharacter });
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
	const playerId = playerIdOf(request);
	const universeId = universeOf(request).id;

	if (characterId === undefined)
	{
		return;
	}

	const refusal = await inTransaction(async (transaction): Promise<Refusal | undefined> =>
	{
		const reason = await refuseDeletion(playerId, universeId, characterId, transaction);

		if (reason)
		{
			return(reason);
		}

		await deleteCharacter(playerId, universeId, characterId, transaction);
		return(undefined);
	});

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	characterChanges.publish({
		kind: 'removed',
		playerId,
		universeId,
		characterId
	});
	response.sendStatus(204);
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
	const playerId = playerIdOf(request);
	const universeId = universeOf(request).id;

	if (characterId === undefined)
	{
		return;
	}

	const { characterDeletionDays } = await findSiteSettings();

	if (characterDeletionDays === 0)
	{
		sendError(response, 409, messages.lastRitesOff);
		return;
	}

	const result = await inTransaction(async (transaction): Promise<Refusal | Date> =>
	{
		const reason = await refuseDeletion(playerId, universeId, characterId, transaction);

		if (reason)
		{
			return(reason);
		}

		const scheduled = await scheduleCharacterDeletion(playerId, universeId, characterId, new Date(Date.now() + (characterDeletionDays * 24 * 60 * 60 * 1000)), transaction);

		return(scheduled ?? { status: 404, message: messages.noSuchCharacter });
	});

	if (!(result instanceof Date))
	{
		sendError(response, result.status, result.message, result.values);
		return;
	}

	const deleteAt = result;

	characterChanges.publish({
		kind: 'removed',
		playerId,
		universeId,
		characterId
	});

	const payload: CharacterDeletionPayload = { deleteAt: deleteAt.toISOString() };

	response.json(payload);
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
	const playerId = playerIdOf(request);
	const universeId = universeOf(request).id;

	if (characterId === undefined)
	{
		return;
	}

	const character = await restoreCharacter(playerId, universeId, characterId);

	if (!character)
	{
		sendError(response, 404, messages.noSuchCharacter);
		return;
	}

	characterChanges.publish({
		kind: 'restored',
		playerId,
		universeId,
		character,
		inGroup: (await findMembership(characterId) !== undefined)
	});
	response.sendStatus(204);
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
	const [abilities, races, classes, themes, characterCount, storedDraft, translator] = await Promise.all([
		offerAbilities(universe, playerId),
		loadEditorRaces(liveVersion(universe.id), universe.ruleset),
		loadEditorClasses(liveVersion(universe.id), universe.ruleset),
		loadEditorThemes(liveVersion(universe.id), universe.ruleset),
		countCharacters(playerId, universe.id),
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
			.filter((race) => race.enabled)
			.map(({ id, key, name, rules }) => translator.name('race', id, { id, key, name, rules })),
		classes: classes
			.filter((characterClass) => characterClass.enabled)
			.map(({ id, key, name, rules }) => translator.name('class', id, { id, key, name, rules })),
		themes: themes
			.filter((theme) => theme.enabled)
			.map(({ id, key, name, rules }) => translator.name('theme', id, { id, key, name, rules })),
		characterCount,
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
		// Deleting a race, class or item waits for the universe's lock, so none goes while it is given out
		await lockPlayer(playerId, transaction);
		await lockUniverse(universeId, transaction);

		const universe = await findEditableUniverse(liveVersion(universeId), transaction);

		if (!universe)
		{
			return({
				status: 404,
				message: errorMessages.noSuchUniverse
			});
		}

		if (await countCharacters(playerId, universeId, transaction) >= MAX_CHARACTERS_PER_UNIVERSE)
		{
			return({
				status: 409,
				message: messages.characterLimit,
				values: { max: MAX_CHARACTERS_PER_UNIVERSE }
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

		const race = (await loadEditorRaces(liveVersion(universeId), universe.ruleset, transaction)).find((option) => ((option.id === raceId) && option.enabled));

		if (!race)
		{
			return({
				status: 409,
				message: messages.raceUnavailable
			});
		}

		const characterClass = (await loadEditorClasses(liveVersion(universeId), universe.ruleset, transaction)).find((option) => ((option.id === classId) && option.enabled));

		if (!characterClass)
		{
			return({
				status: 409,
				message: messages.classUnavailable
			});
		}

		const theme = (rulesetHasThemes(universe.ruleset)
			? (await loadEditorThemes(liveVersion(universeId), universe.ruleset, transaction)).find((option) => ((option.id === themeId) && option.enabled))
			: undefined);

		if (rulesetHasThemes(universe.ruleset) ? !theme : (themeId !== null))
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

		const enabledItemIds = new Set((await loadEditorItems(liveVersion(universeId), universe.ruleset, transaction))
			.filter((item) => item.enabled)
			.map((item) => item.id));
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
			items: combineStartingItems([universe.startingItems, race.startingItems, characterClass.startingItems], enabledItemIds)
		}, transaction);

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

	console.error('Character request %s %s failed:', request.method, request.originalUrl, error);
	sendError(response, 500, errorMessages.somethingWentWrong);
}
