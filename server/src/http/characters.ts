/**
 * The routes for a player's characters in a universe (listed in shared/src/characters.ts)
 *
 * Every route needs a logged-in browser and a universe the player may play in its stage. The server
 * rolls ability scores and keeps them until a character is made with them, so asking again doesn't
 * roll again; the player only chooses which ability gets which score
 */
import { randomInt } from 'crypto';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { canPlayUniverse, CHARACTER_STEPS, defineMessages, DISALLOWED_TEXT_CHARACTERS, isPf1eRollMethod, isReservedName, MAX_CHARACTER_NAME_LENGTH, MAX_CHARACTERS_PER_UNIVERSE, NAME_MESSAGES, NEW_PF1E_RACE_RULES, PF1E_ABILITIES, PF1E_MAX_POINT_BUY_SCORE, pf1ePointBuyBudget, UNIVERSES_PATH, type CharacterDeletionPayload, type CharacterDraft, type CharacterListPayload, type CharacterSheet, type CreatedPayload, type EditableUniverse, type NewCharacterOptions, type NewCharacterRequest, type OptionName } from '@multiverse-kiln/shared';

import { countCharacters, createCharacter, deleteCharacter, deleteCharacterDraft, deletePf1eAbilityRoll, findCharacterDetails, findCharacterDraft, findPf1eAbilityRoll, keepPf1eAbilityRoll, listCharacters, restoreCharacter, saveCharacterDraft, scheduleCharacterDeletion } from '../db/characterRepo.js';
import { loadEditorClasses } from '../db/classRepo.js';
import { lockPlayer } from '../db/playerRepo.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { findPf1eSettings } from '../db/rulesetRepo.js';
import { findSiteSettings } from '../db/siteSettingsRepo.js';
import { inTransaction } from '../db/transactions.js';
import { findUniverseRole } from '../db/universeEditorRepo.js';
import { findEditableUniverse, lockUniverse } from '../db/universeRepo.js';
import { rollPf1eAbilityScores } from '../logic/abilityRolls.js';
import { characterChanges } from '../players/characterChanges.js';
import { areValidBaseScores, combineStartingItems, combineStartingMoney, finalPf1eAbilityScores, isValidFloatingAbility, type Pf1eScoreSource } from '../logic/characterCreation.js';
import { chooseStartingArea } from '../logic/startingArea.js';
import { displayText } from '../rooms/payloads.js';
import { playerIdOf, refuseWritesFromOtherOrigins, requireLogin } from './editorAccess.js';
import { errorMessages, sendError, sendInvalidRequest, type Refusal } from './errors.js';

/**
 * The universe a character request is about
 */
type PlayableUniverse = Omit<EditableUniverse, 'role'>;

/**
 * A base ability score as sent: no rolled or bought score is outside this
 */
const baseScore = z.number().int().min(0).max(PF1E_MAX_POINT_BUY_SCORE);

/**
 * NewCharacterRequest. Whether the race, class and scores are allowed is checked by the route
 */
const newCharacterRequest = z.object({
	name: displayText(MAX_CHARACTER_NAME_LENGTH),
	raceId: z.number().int().min(1).max(2147483647),
	classId: z.number().int().min(1).max(2147483647),
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
		defaultMessage: 'Characters can\'t be given their last rites on this site. They can only be deleted straight away.',
		description: 'Why a character wasn\'t given their last rites (deleted after some days): the site\'s settings have turned waiting off'
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
	router.use(loadPlayableUniverse);

	router.get('/', listRoute);
	router.get('/new', newCharacterRoute);
	router.put('/draft', saveDraftRoute);
	router.delete('/draft', deleteDraftRoute);
	router.post('/', createRoute);
	router.get('/:characterId', sheetRoute);
	router.delete('/:characterId', deleteRoute);
	router.put('/:characterId/deletion', scheduleDeletionRoute);
	router.delete('/:characterId/deletion', restoreRoute);
	router.use(handleCharacterError);

	app.use(`${UNIVERSES_PATH}/:universeId/characters`, router);
}

/**
 * Middleware that loads the universe, answering 404 unless the player may play it
 *
 * @param request The request
 * @param response The response
 * @param next Continues to the next handler
 */
async function loadPlayableUniverse(request: Request, response: Response, next: NextFunction): Promise<void>
{
	const universeId = z.uuid().safeParse(request.params.universeId);

	if (universeId.success)
	{
		const [universe, role] = await Promise.all([
			findEditableUniverse(universeId.data),
			findUniverseRole(universeId.data, playerIdOf(request))
		]);

		if (universe && canPlayUniverse(universe.stage, role))
		{
			universes.set(request, universe);
			next();
			return;
		}
	}

	sendError(response, 404, errorMessages.noSuchUniverse);
}

/**
 * The universe of a request that has passed loadPlayableUniverse
 *
 * @param request The request
 * @return The universe
 */
function universeOf(request: Request): PlayableUniverse
{
	const universe = universes.get(request);

	if (!universe)
	{
		throw new Error(`${request.method} ${request.path} reached a handler without loadPlayableUniverse`);
	}

	return(universe);
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
	const [characters, races, classes] = await Promise.all([
		listCharacters(playerIdOf(request), universe.id),
		loadEditorRaces(universe.id, universe.ruleset),
		loadEditorClasses(universe.id, universe.ruleset)
	]);
	const raceNames = new Map(races.map(({ id, key, name }) => [id, { key, name }]));
	const classNames = new Map(classes.map(({ id, key, name }) => [id, { key, name }]));
	const unnamed: OptionName = { key: null, name: null };
	const payload: CharacterListPayload = {
		ruleset: universe.ruleset,
		characters: characters.map(({ id, name, raceId, classId, deleteAt }) => ({
			id,
			name,
			race: (raceNames.get(raceId) ?? unnamed),
			characterClass: (classNames.get(classId) ?? unnamed),
			deleteAt: (deleteAt?.toISOString() ?? null)
		}))
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

	const [character, races, classes, items, siteSettings] = await Promise.all([
		findCharacterDetails(playerIdOf(request), universe.id, characterId),
		loadEditorRaces(universe.id, universe.ruleset),
		loadEditorClasses(universe.id, universe.ruleset),
		loadEditorItems(universe.id, universe.ruleset),
		findSiteSettings()
	]);

	if (!character)
	{
		sendError(response, 404, messages.noSuchCharacter);
		return;
	}

	const race = races.find((option) => (option.id === character.raceId));
	const characterClass = classes.find((option) => (option.id === character.classId));
	const itemsById = new Map(items.map((item) => [item.id, item]));
	const payload: CharacterSheet = {
		ruleset: universe.ruleset,
		id: character.id,
		name: character.name,
		race: {
			key: (race?.key ?? null),
			name: (race?.name ?? null)
		},
		characterClass: {
			key: (characterClass?.key ?? null),
			name: (characterClass?.name ?? null)
		},
		deleteAt: (character.deleteAt?.toISOString() ?? null),
		deletionDays: siteSettings.characterDeletionDays,
		size: (race?.rules.size ?? NEW_PF1E_RACE_RULES.size),
		darkvision: (race?.rules.darkvision ?? NEW_PF1E_RACE_RULES.darkvision),
		abilityScores: character.abilityScores,
		money: character.money,
		items: character.items.map(({ itemId, quantity }) =>
		{
			const item = itemsById.get(itemId);

			return({
				id: itemId,
				key: (item?.key ?? null),
				name: (item?.name ?? null),
				type: (item?.type ?? ''),
				quantity
			});
		})
	};

	response.json(payload);
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
 * DELETE /:characterId: deletes one of the player's characters straight away
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

	if (!await deleteCharacter(playerId, universeId, characterId))
	{
		sendError(response, 404, messages.noSuchCharacter);
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
 * site's characterDeletionDays from now, or refuses while it is 0. A character already given them keeps
 * their time
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

	const deleteAt = await scheduleCharacterDeletion(playerId, universeId, characterId, new Date(Date.now() + (characterDeletionDays * 24 * 60 * 60 * 1000)));

	if (!deleteAt)
	{
		sendError(response, 404, messages.noSuchCharacter);
		return;
	}

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
		character
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
	const [settings, races, classes, characterCount, storedDraft] = await Promise.all([
		findPf1eSettings(universe.id),
		loadEditorRaces(universe.id, universe.ruleset),
		loadEditorClasses(universe.id, universe.ruleset),
		countCharacters(playerId, universe.id),
		findCharacterDraft(playerId, universe.id)
	]);

	// Progress saved by an older version of Create Character is dropped rather than refused
	const draft = characterDraft.safeParse(storedDraft);
	const { statMethod } = settings;
	let abilities: NewCharacterOptions['abilities'];

	if (isPf1eRollMethod(statMethod))
	{
		const roll = await keepPf1eAbilityRoll(playerId, universe.id, {
			statMethod,
			scores: rollPf1eAbilityScores(statMethod, secureRandom)
		});

		abilities = {
			kind: 'roll',
			statMethod,
			rolls: roll.scores
		};
	}
	else
	{
		abilities = {
			kind: 'pointBuy',
			statMethod,
			budget: pf1ePointBuyBudget(statMethod, settings.customPointBuyBudget)
		};
	}

	const payload: NewCharacterOptions = {
		universeName: universe.name,
		ruleset: universe.ruleset,
		abilities,
		races: races
			.filter((race) => race.enabled)
			.map(({ id, key, name, rules }) => ({ id, key, name, rules })),
		classes: classes
			.filter((characterClass) => characterClass.enabled)
			.map(({ id, key, name, rules }) => ({ id, key, name, rules })),
		characterCount,
		draft: (draft.success ? draft.data : null)
	};

	response.json(payload);
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
	const { name, raceId, classId, baseScores, floatingAbility } = body.data;

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

		const universe = await findEditableUniverse(universeId, transaction);

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

		const settings = await findPf1eSettings(universeId, transaction);
		let source: Pf1eScoreSource;

		if (isPf1eRollMethod(settings.statMethod))
		{
			const roll = await findPf1eAbilityRoll(playerId, universeId, transaction);

			if (roll?.statMethod !== settings.statMethod)
			{
				return({
					status: 409,
					message: messages.scoresChanged
				});
			}

			source = {
				kind: 'roll',
				rolls: roll.scores
			};
		}
		else
		{
			source = {
				kind: 'pointBuy',
				budget: pf1ePointBuyBudget(settings.statMethod, settings.customPointBuyBudget)
			};
		}

		if (!areValidBaseScores(baseScores, source))
		{
			return({
				status: 400,
				message: messages.invalidScores
			});
		}

		const race = (await loadEditorRaces(universeId, universe.ruleset, transaction)).find((option) => ((option.id === raceId) && option.enabled));

		if (!race)
		{
			return({
				status: 409,
				message: messages.raceUnavailable
			});
		}

		const characterClass = (await loadEditorClasses(universeId, universe.ruleset, transaction)).find((option) => ((option.id === classId) && option.enabled));

		if (!characterClass)
		{
			return({
				status: 409,
				message: messages.classUnavailable
			});
		}

		if (!isValidFloatingAbility(race.rules, floatingAbility))
		{
			return({
				status: 400,
				message: messages.floatingAbility
			});
		}

		const enabledItemIds = new Set((await loadEditorItems(universeId, universe.ruleset, transaction))
			.filter((item) => item.enabled)
			.map((item) => item.id));
		const characterId = await createCharacter({
			playerId,
			universeId,
			name,
			raceId,
			classId,
			abilityScores: finalPf1eAbilityScores(baseScores, race.rules, floatingAbility),
			money: combineStartingMoney([universe.startingMoney, race.startingMoney, characterClass.startingMoney]),
			items: combineStartingItems([universe.startingItems, race.startingItems, characterClass.startingItems], enabledItemIds),
			areaId: chooseStartingArea(universe.startingAreaId, race, characterClass)
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

	console.error(`Character request ${request.method} ${request.originalUrl} failed:`, error);
	sendError(response, 500, errorMessages.somethingWentWrong);
}
