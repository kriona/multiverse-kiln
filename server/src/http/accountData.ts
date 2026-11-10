/**
 * What the logged-in player can take away before deleting their account, and what deleting it asks
 * them to decide (see Deleting an account in STRUCTURE-OVERVIEW.md), on the profile router:
 * PROFILE_EXPORT_PATH and PROFILE_DELETION_PATH
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { accountExportFileName, DEFAULT_CLASS_NAMES, DEFAULT_ITEM_NAMES, DEFAULT_RACE_NAMES, DEFAULT_THEME_NAMES, MAX_LOCALE_LENGTH, type AccountDeletionPayload, type AccountExport, type ExportedCharacter, type MessageDescriptor, type OptionName, type Ruleset, type Translator } from '@multiverse-kiln/shared';

import { findPlayerAdminEvents } from '../db/adminEventRepo.js';
import { findPlayerAuthEvents } from '../db/authEventRepo.js';
import { listOwnChatMessages, listOwnChatReads } from '../db/chatRepo.js';
import { listCharacterDetails, listCharacterDrafts, listProfileCharacters, type ProfileCharacterRecord } from '../db/characterRepo.js';
import { loadLiveClassNames } from '../db/classRepo.js';
import { anchorsAnyGroup, listPlayerMemberships } from '../db/groupRepo.js';
import { loadLiveItemNames } from '../db/itemRepo.js';
import { findOwnProfile } from '../db/playerRepo.js';
import { listProviderLogins } from '../db/providerLoginRepo.js';
import { isLastServerAdmin } from '../db/serverAdminRepo.js';
import { loadLiveRaceNames } from '../db/raceRepo.js';
import { listPlayerSessions } from '../db/sessionRepo.js';
import { loadLiveThemeNames } from '../db/themeRepo.js';
import { findTwoFactorState, hasTwoFactor } from '../db/twoFactorRepo.js';
import { listEditorChanges, listPlayerUniverseEdits } from '../db/universeEditRepo.js';
import { listEditableUniverses, listOtherUniverseEditors, listSoleCreatedUniverses } from '../db/universeEditorRepo.js';
import { emailTranslator } from '../email/emailLocales.js';
import { playerIdOf } from './editorAccess.js';
import { errorMessages, sendError } from './errors.js';

/**
 * The language the export names default races, classes, themes and items in
 */
const exportLocale = z.string().max(MAX_LOCALE_LENGTH).regex(/^[A-Za-z0-9-]+$/);

/**
 * A race's, class's, theme's or item's name as the universe calls it
 *
 * @param named It, or undefined when it can't be found
 * @param defaultNames The ruleset's default names, by key
 * @param translator The language default names are written in
 * @return The name, the key of a default the ruleset has no name for, or an empty string
 */
function nameOf(named: OptionName | undefined, defaultNames: Record<string, MessageDescriptor | undefined>, translator: Translator): string
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
 * editors each could be handed to, whether it disbands any groups, how the player confirms deleting
 * their account, and whether they can't because they are the site's only server admin
 *
 * @param request The request
 * @param response The response: an AccountDeletionPayload
 */
export async function deletionRoute(request: Request, response: Response): Promise<void>
{
	const playerId = playerIdOf(request);
	const [profile, universes, anchorsGroups, twoFactor, lastServerAdmin] = await Promise.all([
		findOwnProfile(playerId),
		listSoleCreatedUniverses(playerId),
		anchorsAnyGroup(playerId),
		hasTwoFactor(playerId),
		isLastServerAdmin(playerId)
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
			deletionPrevented: universe.deletionPrevented,
			twoFactorRequired: (universe.requireTwoFactor && !twoFactor),
			editors: await listOtherUniverseEditors(universe.id, playerId)
		}))),
		anchorsGroups,
		hasPassword: profile.hasPassword,
		twoFactor,
		lastServerAdmin
	};

	response.json(payload);
}

/**
 * The player's characters as the export gives them, with the names their universes use. Loads them in
 * a fixed number of queries, however many characters and universes the player has
 *
 * @param playerId The player's ID
 * @param records The player's characters
 * @param translator The language default names are written in
 * @return The characters, in the same order
 */
async function exportCharacters(playerId: string, records: readonly ProfileCharacterRecord[], translator: Translator): Promise<ExportedCharacter[]>
{
	if (records.length === 0)
	{
		return([]);
	}

	const universes = [...new Map(records.map((record) => [record.universeId, {
		id: record.universeId,
		ruleset: record.ruleset
	}])).values()];
	const [details, membershipList, raceNames, classNames, themeNames] = await Promise.all([
		listCharacterDetails(playerId),
		listPlayerMemberships(playerId),
		loadLiveRaceNames(universes),
		loadLiveClassNames(universes),
		loadLiveThemeNames(universes)
	]);
	const memberships = new Map(membershipList.map((membership) => [membership.character.characterId, membership]));
	const itemNames = await loadLiveItemNames(universes, [...details.values()].flatMap((character) => character.items.map((item) => item.itemId)));
	const exported: ExportedCharacter[] = [];

	for (const record of records)
	{
		const ruleset: Ruleset = record.ruleset;
		const character = details.get(record.id);
		const membership = memberships.get(record.id);

		if (!character)
		{
			continue;
		}

		exported.push({
			id: character.id,
			name: character.name,
			universe: {
				id: record.universeId,
				name: record.universeName
			},
			race: nameOf(raceNames.get(record.universeId)?.get(character.raceId), DEFAULT_RACE_NAMES[ruleset], translator),
			characterClass: nameOf(classNames.get(record.universeId)?.get(character.classId), DEFAULT_CLASS_NAMES[ruleset], translator),
			theme: ((character.themeId === null) ? null : nameOf(themeNames.get(record.universeId)?.get(character.themeId), DEFAULT_THEME_NAMES[ruleset], translator)),
			abilityScores: character.abilityScores,
			money: character.money,
			items: character.items.map(({ itemId, quantity }) => ({
				name: nameOf(itemNames.get(record.universeId)?.get(itemId), DEFAULT_ITEM_NAMES[ruleset], translator),
				quantity
			})),
			group: (membership
				? {
					id: membership.groupId,
					anchorBeing: membership.isAnchor
				}
				: null),
			visibleOnProfile: record.visibleOnProfile,
			deleteAt: (character.deleteAt?.toISOString() ?? null)
		});
	}

	return(exported);
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
	const [profile, providers, twoFactor, sessions, events, universes, records, drafts, chats, reads, edits, editorChanges, adminEvents] = await Promise.all([
		findOwnProfile(playerId),
		listProviderLogins(playerId),
		findTwoFactorState(playerId, now),
		listPlayerSessions(playerId),
		findPlayerAuthEvents(playerId),
		listEditableUniverses(playerId),
		listProfileCharacters(playerId, {}),
		listCharacterDrafts(playerId),
		listOwnChatMessages(playerId),
		listOwnChatReads(playerId),
		listPlayerUniverseEdits(playerId),
		listEditorChanges(playerId),
		findPlayerAdminEvents(playerId)
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
			dismissedNotices: profile.dismissedNotices,
			createdAt: profile.createdAt.toISOString(),
			lastLoginAt: (profile.lastLoginAt?.toISOString() ?? null)
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
		characterDrafts: drafts,
		chatMessages: chats.map((message) => ({
			...message,
			sentAt: message.sentAt.toISOString()
		})),
		chatReads: reads.map((read) => ({
			...read,
			readAt: read.readAt.toISOString()
		})),
		universeEdits: edits.map(({ changeDetails, savedAt, ...edit }) => ({
			...edit,
			changes: changeDetails,
			savedAt: savedAt.toISOString()
		})),
		editorChanges: editorChanges.map(({ changeDetails, savedAt, ...change }) => ({
			...change,
			changes: changeDetails,
			savedAt: savedAt.toISOString()
		})),
		adminEvents: adminEvents.map((event) => ({
			kind: event.kind,
			byPlayer: (event.adminId === playerId),
			playerId: event.playerId,
			universe: ((event.universeName === null)
				? null
				: {
					id: event.universeId,
					name: event.universeName
				}),
			reason: event.reason,
			preventsDeletion: event.preventsDeletion,
			occurredAt: event.occurredAt.toISOString()
		}))
	};

	response.attachment(accountExportFileName(profile.username));
	response.json(payload);
}
