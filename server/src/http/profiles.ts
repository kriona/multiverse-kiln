/**
 * Player profiles (see Profile edit and Profile view in STRUCTURE-OVERVIEW.md): the logged-in player's
 * own profile, which they can change (PROFILE_PATH), and anyone's profile by username (PLAYERS_PATH)
 *
 * Any logged-in player can read a profile. It shows only what the player filled in, and only the
 * characters they let others see, in universes anyone can play
 */
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { canPlayUniverse, defineMessages, DISALLOWED_TEXT_CHARACTERS, MAX_LOCALE_LENGTH, MAX_LOCATION_LENGTH, MAX_PLAYER_NAME_LENGTH, MAX_PROFILE_LANGUAGES, MAX_PRONOUNS_LENGTH, MAX_SOCIAL_USERNAME_LENGTH, MAX_USERNAME_LENGTH, PLAYERS_PATH, PROFILE_LANGUAGES, PROFILE_PATH, SOCIAL_SITES, SOCIAL_USERNAME_PATTERNS, UNIVERSE_STAGES, type CharacterVisibilityRequest, type OptionName, type OwnProfilePayload, type PlayerProfilePayload, type ProfileCharacter, type ProfileField, type ProfileUpdateRequest, type SocialSite, type SocialUsernames } from '@multiverse-kiln/shared';

import { listProfileCharacters, setCharacterVisibility, type ProfileCharacterRecord } from '../db/characterRepo.js';
import { loadEditorClasses } from '../db/classRepo.js';
import { AccountTakenError, findOwnProfile, findProfileByUsername, saveProfile } from '../db/playerRepo.js';
import { listProviderLogins } from '../db/providerLoginRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { findTwoFactorState } from '../db/twoFactorRepo.js';
import { displayText } from '../rooms/payloads.js';
import { authMessages, checkDisplayName, checkUsername, sendRefusal, type AuthRefusal } from './authCommon.js';
import { playerIdOf, refuseWritesFromOtherOrigins, requireLogin } from './editorAccess.js';
import { errorMessages, sendError, sendInvalidRequest } from './errors.js';

/**
 * Reasons the profile routes give (see shared/src/localization.ts)
 */
const profileMessages = defineMessages({
	noSuchPlayer: {
		id: 'error.noSuchPlayer',
		defaultMessage: 'No player has that username.',
		description: 'Why a player\'s profile couldn\'t be shown: no account has the username in its address'
	},
	noSuchCharacter: {
		id: 'error.profile.noSuchCharacter',
		defaultMessage: 'You have no such character.',
		description: 'Why showing or hiding a character on the player\'s profile was refused: the character isn\'t theirs, or was deleted'
	},
	timeZone: {
		id: 'error.profile.timeZone',
		defaultMessage: 'Choose a time zone from the list.',
		description: 'Shown under the time zone field on the profile when what was sent isn\'t a time zone the server knows'
	},
	locale: {
		id: 'error.profile.locale',
		defaultMessage: 'Choose a language from the list.',
		description: 'Shown under the language field on the profile when what was sent isn\'t a language tag'
	},
	socialUsername: {
		id: 'error.profile.socialUsername',
		defaultMessage: 'That isn\'t a username on {site}. Enter the username alone, not a link.',
		description: 'Shown under one of the profile\'s social site fields when what was typed can\'t be a username there; {site} is Discord, Facebook, Instagram or TikTok'
	}
});

/**
 * Each social site's name, as players know it
 */
const SOCIAL_SITE_NAMES: Readonly<Record<SocialSite, string>> = {
	discord: 'Discord',
	facebook: 'Facebook',
	instagram: 'Instagram',
	tiktok: 'TikTok'
};

/**
 * The stages of universes anyone can play, whose characters others can see on a profile
 */
const PUBLIC_STAGES = UNIVERSE_STAGES.filter((stage) => canPlayUniverse(stage, undefined));

/**
 * A profile field that can be left blank: trimmed text of at most a length, or null. Blank text is null
 *
 * @param maxLength The most characters it can have
 * @return The schema
 */
function optionalText(maxLength: number): z.ZodType<string | null>
{
	return(z.string()
		.trim()
		.max(maxLength)
		.refine((text) => !DISALLOWED_TEXT_CHARACTERS.test(text), 'Contains disallowed characters')
		.nullable()
		.transform((text) => (((text === null) || (text === '')) ? null : text)));
}

/**
 * A social site username as typed, without a leading @, or null when blank
 */
const socialUsername = z.string()
	.trim()
	.max(MAX_SOCIAL_USERNAME_LENGTH + 1)
	.nullable()
	.transform((text) => (((text === null) || (text === '')) ? null : text.replace(/^@/, '')));

const profileUpdateRequest = z.object({
	username: z.string().trim().max(MAX_USERNAME_LENGTH * 4),
	displayName: displayText(MAX_PLAYER_NAME_LENGTH),
	pronouns: optionalText(MAX_PRONOUNS_LENGTH),
	location: optionalText(MAX_LOCATION_LENGTH),
	timeZone: z.string().max(100).nullable(),
	languages: z.array(z.enum(PROFILE_LANGUAGES))
		.max(MAX_PROFILE_LANGUAGES)
		.transform((languages) => [...new Set(languages)]),
	locale: z.string().max(MAX_LOCALE_LENGTH).nullable(),
	socials: z.object({
		discord: socialUsername,
		facebook: socialUsername,
		instagram: socialUsername,
		tiktok: socialUsername
	}),
	showCharacters: z.boolean()
}) satisfies z.ZodType<ProfileUpdateRequest, unknown>;

const characterVisibilityRequest = z.object({
	visibleOnProfile: z.boolean()
}) satisfies z.ZodType<CharacterVisibilityRequest>;

let timeZones: Set<string> | undefined;

/**
 * Whether the server knows a time zone
 *
 * @param timeZone An IANA time zone name, such as Europe/Paris
 * @return Whether it is one
 */
function isKnownTimeZone(timeZone: string): boolean
{
	timeZones ??= new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

	return(timeZones.has(timeZone));
}

/**
 * Whether a language tag is well formed, such as en or pt-BR
 *
 * @param locale The tag
 * @return Whether it is
 */
function isLanguageTag(locale: string): boolean
{
	try
	{
		return(Intl.getCanonicalLocales(locale).length === 1);
	}
	catch
	{
		return(false);
	}
}

/**
 * Adds the profile routes
 *
 * @param app Express app to add the routes to
 * @param allowedOrigins Normalized origins allowed to make changes from a browser
 */
export function addProfileRoutes(app: Application, allowedOrigins: Set<string>): void
{
	const own = express.Router();

	own.use((_request, response, next) =>
	{
		response.set('Cache-Control', 'no-store');
		next();
	});
	own.use(refuseWritesFromOtherOrigins(allowedOrigins));
	own.use(express.json());
	own.use(requireLogin);
	own.get('/', ownProfileRoute);
	own.put('/', updateProfileRoute);
	own.put('/characters/:characterId', characterVisibilityRoute);
	own.use(handleProfileError);

	const players = express.Router();

	players.use((_request, response, next) =>
	{
		response.set('Cache-Control', 'no-store');
		next();
	});
	players.use(requireLogin);
	players.get('/:username', playerProfileRoute);
	players.use(handleProfileError);

	app.use(PROFILE_PATH, own);
	app.use(PLAYERS_PATH, players);
}

/**
 * Names the races and classes of a profile's characters, as their universes call them
 *
 * @param records The characters, with their universes
 * @return The characters as the profile lists them, in the same order
 */
async function nameCharacters(records: ProfileCharacterRecord[]): Promise<(ProfileCharacter & { visibleOnProfile: boolean })[]>
{
	const universes = new Map(records.map((record) => [record.universeId, record.ruleset]));
	const names = new Map(await Promise.all([...universes].map(async ([universeId, ruleset]) =>
	{
		const [races, classes] = await Promise.all([
			loadEditorRaces(universeId, ruleset),
			loadEditorClasses(universeId, ruleset)
		]);

		return([universeId, {
			races: new Map(races.map(({ id, key, name }) => [id, { key, name }])),
			classes: new Map(classes.map(({ id, key, name }) => [id, { key, name }]))
		}] as const);
	})));
	const unnamed: OptionName = { key: null, name: null };

	return(records.map((record) => ({
		id: record.id,
		name: record.name,
		race: (names.get(record.universeId)?.races.get(record.raceId) ?? unnamed),
		characterClass: (names.get(record.universeId)?.classes.get(record.classId) ?? unnamed),
		universe: {
			id: record.universeId,
			slug: record.universeSlug,
			name: record.universeName,
			ruleset: record.ruleset
		},
		visibleOnProfile: record.visibleOnProfile
	})));
}

/**
 * GET PLAYERS_PATH/:username: a player's profile, as other players see it
 *
 * @param request The request
 * @param response The response: a PlayerProfilePayload
 */
async function playerProfileRoute(request: Request, response: Response): Promise<void>
{
	const username = z.string().max(MAX_USERNAME_LENGTH * 4).safeParse(request.params.username);
	const profile = (username.success ? await findProfileByUsername(username.data) : undefined);

	if (!profile)
	{
		sendError(response, 404, profileMessages.noSuchPlayer);
		return;
	}

	const characters = await nameCharacters(await listProfileCharacters(profile.id, {
		stages: PUBLIC_STAGES,
		onlyVisible: !profile.showCharacters
	}));
	const payload: PlayerProfilePayload = {
		username: profile.username,
		displayName: profile.displayName,
		pronouns: profile.pronouns,
		pronounsLanguage: ((profile.pronouns === null) ? null : profile.locale),
		location: profile.location,
		timeZone: profile.timeZone,
		languages: profile.languages,
		socials: profile.socials,
		characters: characters.map(({ visibleOnProfile: _visible, ...character }) => character)
	};

	response.json(payload);
}

/**
 * GET PROFILE_PATH: the logged-in player's own profile
 *
 * @param request The request
 * @param response The response: an OwnProfilePayload
 */
async function ownProfileRoute(request: Request, response: Response): Promise<void>
{
	const playerId = playerIdOf(request);
	const [profile, providers, twoFactor, records] = await Promise.all([
		findOwnProfile(playerId),
		listProviderLogins(playerId),
		findTwoFactorState(playerId, new Date()),
		listProfileCharacters(playerId, {})
	]);

	if (!profile)
	{
		sendError(response, 401, errorMessages.logInFirst);
		return;
	}

	const payload: OwnProfilePayload = {
		username: profile.username,
		displayName: profile.displayName,
		pronouns: profile.pronouns,
		location: profile.location,
		timeZone: profile.timeZone,
		languages: profile.languages,
		locale: profile.locale,
		socials: profile.socials,
		email: profile.email,
		hasPassword: profile.hasPassword,
		providers,
		twoFactor,
		showCharacters: profile.showCharacters,
		characters: await nameCharacters(records)
	};

	response.json(payload);
}

/**
 * Checks the profile's social site usernames
 *
 * @param socials The usernames, without a leading @
 * @return The refusal for the first that can't be a username on its site
 */
function checkSocials(socials: SocialUsernames): AuthRefusal<ProfileField> | undefined
{
	const wrong = SOCIAL_SITES.find((site) =>
	{
		const username = socials[site];

		return((username !== null) && !SOCIAL_USERNAME_PATTERNS[site].test(username));
	});

	if (wrong === undefined)
	{
		return(undefined);
	}

	return({
		status: 400,
		message: profileMessages.socialUsername,
		values: {
			site: SOCIAL_SITE_NAMES[wrong]
		},
		field: wrong
	});
}

/**
 * PUT PROFILE_PATH: changes the logged-in player's profile
 *
 * @param request The request, with a ProfileUpdateRequest
 * @param response The response: 204
 */
async function updateProfileRoute(request: Request, response: Response): Promise<void>
{
	const body = profileUpdateRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const profile = body.data;
	const problem: AuthRefusal<ProfileField> | undefined = (checkUsername(profile.username)
		?? checkDisplayName(profile.displayName)
		?? (((profile.timeZone !== null) && !isKnownTimeZone(profile.timeZone)) ? { status: 400, message: profileMessages.timeZone, field: 'timeZone' } : undefined)
		?? (((profile.locale !== null) && !isLanguageTag(profile.locale)) ? { status: 400, message: profileMessages.locale, field: 'locale' } : undefined)
		?? checkSocials(profile.socials));

	if (problem)
	{
		sendRefusal(response, problem);
		return;
	}

	try
	{
		await saveProfile(playerIdOf(request), {
			...profile,
			locale: ((profile.locale === null) ? null : Intl.getCanonicalLocales(profile.locale)[0])
		});
	}
	catch (error)
	{
		if (!(error instanceof AccountTakenError))
		{
			throw error;
		}

		sendRefusal<ProfileField>(response, {
			status: 409,
			message: authMessages.usernameTaken,
			field: 'username'
		});
		return;
	}

	response.sendStatus(204);
}

/**
 * PUT PROFILE_PATH/characters/:characterId: whether the profile lists one of the player's characters
 * when it doesn't list them all
 *
 * @param request The request, with a CharacterVisibilityRequest
 * @param response The response: 204
 */
async function characterVisibilityRoute(request: Request, response: Response): Promise<void>
{
	const characterId = z.uuid().safeParse(request.params.characterId);
	const body = characterVisibilityRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	if (!characterId.success || !(await setCharacterVisibility(playerIdOf(request), characterId.data, body.data.visibleOnProfile)))
	{
		sendError(response, 404, profileMessages.noSuchCharacter);
		return;
	}

	response.sendStatus(204);
}

/**
 * Answers errors from the profile routes: 4xx errors from parsing the body as they are, anything else as 500
 *
 * @param error What went wrong
 * @param request The request
 * @param response The response
 * @param next The next error handler, for when the response has already started
 */
function handleProfileError(error: unknown, request: Request, response: Response, next: NextFunction): void
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

	console.error(`Profile request ${request.method} ${request.originalUrl} failed:`, error);
	sendError(response, 500, errorMessages.somethingWentWrong);
}
