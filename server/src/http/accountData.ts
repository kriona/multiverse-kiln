/**
 * What the logged-in player can take away before deleting their account, and what deleting it asks
 * them to decide (see Deleting an account in STRUCTURE-OVERVIEW.md), on the profile router:
 * PROFILE_EXPORT_PATH and PROFILE_DELETION_PATH
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { accountExportFileName, DEFAULT_CLASS_NAMES, DEFAULT_ITEM_NAMES, DEFAULT_RACE_NAMES, DEFAULT_THEME_NAMES, MAX_LOCALE_LENGTH, type AccountDeletionPayload, type AccountExport, type ExportedCharacter, type MessageDescriptor, type Ruleset, type Translator } from '@multiverse-kiln/shared';

import { findPlayerAuthEvents } from '../db/authEventRepo.js';
import { findCharacterDetails, listCharacterDrafts, listProfileCharacters, type ProfileCharacterRecord } from '../db/characterRepo.js';
import { loadEditorClasses } from '../db/classRepo.js';
import { findMembership } from '../db/groupRepo.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { findOwnProfile } from '../db/playerRepo.js';
import { listProviderLogins } from '../db/providerLoginRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { listPlayerSessions } from '../db/sessionRepo.js';
import { loadEditorThemes } from '../db/themeRepo.js';
import { findTwoFactorState, hasTwoFactor } from '../db/twoFactorRepo.js';
import { listEditableUniverses, listOtherUniverseEditors, listSoleCreatedUniverses } from '../db/universeEditorRepo.js';
import { emailTranslator } from '../email/emailLocales.js';
import { playerIdOf } from './editorAccess.js';
import { errorMessages, sendError } from './errors.js';

/**
 * The language the export names default races, classes, themes and items in
 */
const exportLocale = z.string().max(MAX_LOCALE_LENGTH).regex(/^[A-Za-z0-9-]+$/);

/**
 * Something named the way races, classes, themes and items are: a name of the universe's own, or a
 * default's key
 */
interface Named
{
	key: string | null;
	name: string | null;
}

/**
 * A race's, class's, theme's or item's name as the universe calls it
 *
 * @param named It, or undefined when it can't be found
 * @param defaultNames The ruleset's default names, by key
 * @param translator The language default names are written in
 * @return The name, the key of a default the ruleset has no name for, or an empty string
 */
function nameOf(named: Named | undefined, defaultNames: Record<string, MessageDescriptor | undefined>, translator: Translator): string
{
	if (named?.name)
	{
		return(named.name);
	}

	const key = (named?.key ?? null);
	const descriptor = ((key === null) ? undefined : defaultNames[key]);

	return(((descriptor === undefined) ? (key ?? '') : translator.format(descriptor)));
}

/**
 * GET PROFILE_DELETION_PATH: the universes the logged-in player is the only creator of, with the
 * editors each could be handed to, and how the player confirms deleting their account
 *
 * @param request The request
 * @param response The response: an AccountDeletionPayload
 */
export async function deletionRoute(request: Request, response: Response): Promise<void>
{
	const playerId = playerIdOf(request);
	const [profile, universes, twoFactor] = await Promise.all([
		findOwnProfile(playerId),
		listSoleCreatedUniverses(playerId),
		hasTwoFactor(playerId)
	]);

	if (!profile)
	{
		sendError(response, 401, errorMessages.logInFirst);
		return;
	}

	const payload: AccountDeletionPayload = {
		universes: await Promise.all(universes.map(async (universe) => ({
			id: universe.id,
			name: universe.name,
			editors: await listOtherUniverseEditors(universe.id, playerId)
		}))),
		hasPassword: profile.hasPassword,
		twoFactor
	};

	response.json(payload);
}

/**
 * The player's characters as the export gives them, with the names their universes use
 *
 * @param playerId The player's ID
 * @param records The player's characters
 * @param translator The language default names are written in
 * @return The characters, in the same order
 */
async function exportCharacters(playerId: string, records: readonly ProfileCharacterRecord[], translator: Translator): Promise<ExportedCharacter[]>
{
	const universes = new Map(records.map((record) => [record.universeId, record.ruleset]));
	const options = new Map(await Promise.all([...universes].map(async ([universeId, ruleset]) =>
	{
		const [races, classes, themes, items] = await Promise.all([
			loadEditorRaces(universeId, ruleset),
			loadEditorClasses(universeId, ruleset),
			loadEditorThemes(universeId, ruleset),
			loadEditorItems(universeId, ruleset)
		]);

		return([universeId, { races, classes, themes, items }] as const);
	})));
	const exported = await Promise.all(records.map(async (record): Promise<ExportedCharacter | undefined> =>
	{
		const ruleset: Ruleset = record.ruleset;
		const [details, membership] = await Promise.all([
			findCharacterDetails(playerId, record.universeId, ruleset, record.id),
			findMembership(record.id)
		]);
		const universeOptions = options.get(record.universeId);

		if (!details || !universeOptions)
		{
			return(undefined);
		}

		return({
			id: details.id,
			name: details.name,
			universe: {
				id: record.universeId,
				name: record.universeName
			},
			race: nameOf(universeOptions.races.find((race) => (race.id === details.raceId)), DEFAULT_RACE_NAMES[ruleset], translator),
			characterClass: nameOf(universeOptions.classes.find((option) => (option.id === details.classId)), DEFAULT_CLASS_NAMES[ruleset], translator),
			theme: ((details.themeId === null) ? null : nameOf(universeOptions.themes.find((theme) => (theme.id === details.themeId)), DEFAULT_THEME_NAMES[ruleset], translator)),
			abilityScores: details.abilityScores,
			money: details.money,
			items: details.items.map(({ itemId, quantity }) => ({
				name: nameOf(universeOptions.items.find((item) => (item.id === itemId)), DEFAULT_ITEM_NAMES[ruleset], translator),
				quantity
			})),
			group: (membership
				? {
					id: membership.groupId,
					anchorBeing: membership.isAnchor
				}
				: null),
			visibleOnProfile: record.visibleOnProfile,
			deleteAt: (details.deleteAt?.toISOString() ?? null)
		});
	}));

	return(exported.filter((character): character is ExportedCharacter => (character !== undefined)));
}

/**
 * GET PROFILE_EXPORT_PATH: everything the site keeps about the logged-in player, as a JSON file to
 * download. Never gives out the password's hash, the authenticator's secret, recovery codes, session
 * tokens or the hashes of networks
 *
 * @param request The request, with ?locale= naming the language of default names
 * @param response The response: an AccountExport, as an attachment
 */
export async function exportRoute(request: Request, response: Response): Promise<void>
{
	const playerId = playerIdOf(request);
	const now = new Date();
	const locale = exportLocale.safeParse(request.query.locale);
	const translator = emailTranslator((locale.success ? locale.data : 'en'));
	const [profile, providers, twoFactor, sessions, events, universes, records, drafts] = await Promise.all([
		findOwnProfile(playerId),
		listProviderLogins(playerId),
		findTwoFactorState(playerId, now),
		listPlayerSessions(playerId),
		findPlayerAuthEvents(playerId),
		listEditableUniverses(playerId),
		listProfileCharacters(playerId, {}),
		listCharacterDrafts(playerId)
	]);

	if (!profile)
	{
		sendError(response, 401, errorMessages.logInFirst);
		return;
	}

	const payload: AccountExport = {
		exportedAt: now.toISOString(),
		account: {
			id: profile.id,
			username: profile.username,
			displayName: profile.displayName,
			email: profile.email,
			hasPassword: profile.hasPassword,
			pronouns: profile.pronouns,
			location: profile.location,
			timeZone: profile.timeZone,
			languages: profile.languages,
			locale: profile.locale,
			socials: profile.socials,
			showCharacters: profile.showCharacters,
			createdAt: profile.createdAt.toISOString()
		},
		providers,
		twoFactor,
		sessions: sessions.map((session) => ({
			createdAt: session.createdAt.toISOString(),
			lastUsedAt: session.lastUsedAt.toISOString(),
			rememberMe: session.rememberMe
		})),
		authEvents: events.map((event) => ({
			kind: event.kind,
			occurredAt: event.occurredAt.toISOString()
		})),
		universes: universes.map(({ id, name, role }) => ({ id, name, role })),
		characters: await exportCharacters(playerId, records, translator),
		characterDrafts: drafts
	};

	response.attachment(accountExportFileName(profile.username));
	response.json(payload);
}
