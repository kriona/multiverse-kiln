/**
 * The routes that make groups, invite characters to them and take characters out of them (listed in
 * shared/src/groups.ts)
 *
 * Every route needs a logged-in browser, and a universe the player may play. Each change is published
 * to groupChanges once it is saved, so the group's room and the lobby follow it
 */
import { createHash, randomBytes } from 'crypto';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { canPlayUniverse, characterBar, defineMessages, DISALLOWED_TEXT_CHARACTERS, INVITE_DURATION_MS, INVITE_DURATIONS, INVITES_PATH, MAX_GROUP_NAME_LENGTH, UNIVERSES_PATH, type DifficultyLevelListPayload, type GroupCharacterRequest, type GroupCreatedPayload, type GroupJoinedPayload, type InviteCreatedPayload, type InviteDetails, type NewGroupRequest, type NewInviteRequest } from '@multiverse-kiln/shared';

import { loadBarredOptions } from '../db/barredOptions.js';
import { findOwnCharacter, type OwnCharacter } from '../db/characterRepo.js';
import { findClassStart } from '../db/classRepo.js';
import type { Executor } from '../db/client.js';
import { findDifficultyLevel, listDifficultyLevels } from '../db/difficultyRepo.js';
import { addGroupMember, countGroupMembers, createGroup, createInvite, deleteInvite, findGroup, findInvite, findMembership, leaveGroup, listGroupMembers, lockGroup, type GroupCharacter, type GroupRecord, type LeftGroup } from '../db/groupRepo.js';
import { lockPlayer } from '../db/playerRepo.js';
import { findRaceStart } from '../db/raceRepo.js';
import { inTransaction } from '../db/transactions.js';
import { lockUniverseShared } from '../db/universeRepo.js';
import { liveVersion } from '../db/universeVersions.js';
import { chooseStartingArea, type StartingPlace } from '../logic/startingArea.js';
import { groupChanges } from '../players/groupChanges.js';
import { groupNoticeRates, tryTakeGroupNotice } from '../rooms/groupChatNotices.js';
import type { RateLimiter } from '../rooms/rateLimiter.js';
import { findAllowedUniverse, loadPlayableUniverse, loadTranslator, universeOf, type PlayableUniverse } from './characters.js';
import { playerIdOf, refuseWritesFromOtherOrigins, requireLogin } from './editorAccess.js';
import { errorMessages, requestRoute, sendError, sendInvalidRequest, type Refusal } from './errors.js';

/**
 * Bytes of randomness in an invite link's token: far too many to guess
 */
const INVITE_TOKEN_BYTES = 24;

/**
 * An invite link's token as it appears in a path: base64url, a little longer than INVITE_TOKEN_BYTES makes
 */
const inviteToken = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/**
 * A character's ID in a request body
 */
const characterId = z.uuid();

/**
 * NewGroupRequest: the anchor being and the group's name, which may be empty
 */
const newGroupRequest = z.object({
	characterId,
	name: z.string().trim().max(MAX_GROUP_NAME_LENGTH).refine((text) => !DISALLOWED_TEXT_CHARACTERS.test(text), 'Contains disallowed characters'),
	difficultyLevelId: z.number().int().min(1).max(2147483647)
}) satisfies z.ZodType<NewGroupRequest>;

/**
 * GroupCharacterRequest: one of the player's characters
 */
const groupCharacterRequest = z.object({
	characterId
}) satisfies z.ZodType<GroupCharacterRequest>;

/**
 * NewInviteRequest: how the link may be used and for how long
 */
const newInviteRequest = z.object({
	multiUse: z.boolean(),
	duration: z.enum(INVITE_DURATIONS)
}) satisfies z.ZodType<NewInviteRequest>;

/**
 * Reasons the group routes give (see shared/src/localization.ts)
 */
const messages = defineMessages({
	characterUnavailable: {
		id: 'error.groupCharacterUnavailable',
		defaultMessage: 'That character can\'t do that: they don\'t exist, aren\'t yours, or have been given their last rites.',
		description: 'Why a character couldn\'t make, join or leave a group: the character isn\'t one of the player\'s in this universe, or is waiting to be deleted'
	},
	characterBarred: {
		id: 'error.groupCharacterBarred',
		defaultMessage: '{bar, select, race {That character\'s race is disabled, so they can\'t play.} other {That character\'s class is disabled, so they can\'t play.}}',
		description: 'Why a character couldn\'t make or join a group: the universe\'s creators disabled their race (bar is race) or class (bar is class) and stopped characters already of it playing'
	},
	alreadyInGroup: {
		id: 'error.alreadyInGroup',
		defaultMessage: 'That character is already in a group. They have to leave it first.',
		description: 'Why a character couldn\'t make or join a group: a character can be in only one group at a time'
	},
	noSuchGroup: {
		id: 'error.noSuchGroup',
		defaultMessage: 'The group doesn\'t exist any more, or that character isn\'t in it.',
		description: 'Why a character couldn\'t leave a group or an invite link couldn\'t be made: the group was disbanded, or the character had already left'
	},
	onlyAnchorInvites: {
		id: 'error.onlyAnchorInvites',
		defaultMessage: 'Only the anchor being\'s player can invite others to the group.',
		description: 'Why an invite link wasn\'t made: only the player of the character the group is centered on (its "anchor being") may make one'
	},
	inviteGone: {
		id: 'error.inviteGone',
		defaultMessage: 'This invite link has expired, has already been used, or is wrong.',
		description: 'Why an invite link to a group didn\'t work'
	},
	noSuchDifficulty: {
		id: 'error.noSuchDifficultyLevel',
		defaultMessage: 'That difficulty doesn\'t exist any more. Choose another.',
		description: 'Why a group wasn\'t made: the difficulty level chosen for it was deleted by the universe\'s creators, perhaps while the player was choosing'
	},
	groupFull: {
		id: 'error.groupFull',
		defaultMessage: 'The group is full: it already has {max, plural, one {# character} other {# characters}}.',
		description: 'Why a character couldn\'t join a group with an invite link; {max} is the most characters the universe allows in a group'
	},
	joinTooFast: {
		id: 'error.joinGroupTooFast',
		defaultMessage: 'You are joining this group too quickly. Wait a moment and try again.',
		description: 'Why a character couldn\'t join a group with an invite link: the player\'s characters joined, left or gave items in the group faster than allowed, since each join, leave and gift writes a line in the group\'s chat'
	},
	leaveTooFast: {
		id: 'error.leaveGroupTooFast',
		defaultMessage: 'You are leaving this group too quickly. Wait a moment and try again.',
		description: 'Why a character couldn\'t leave their group, from the group or their sheet: the player\'s characters joined, left or gave items in the group faster than allowed, since each join, leave and gift writes a line in the group\'s chat'
	}
});

/**
 * Adds the group routes under UNIVERSES_PATH/:universeId/groups, and the invite link routes under INVITES_PATH
 *
 * @param app Express app to add the routes to
 * @param allowedOrigins Normalized origins allowed to change groups from a browser
 */
export function addGroupRoutes(app: Application, allowedOrigins: Set<string>): void
{
	const groupRouter = express.Router({ mergeParams: true });
	const inviteRouter = express.Router();

	for (const router of [groupRouter, inviteRouter])
	{
		router.use((_request, response, next) =>
		{
			response.set('Cache-Control', 'no-store');
			next();
		});
		router.use(refuseWritesFromOtherOrigins(allowedOrigins));
		router.use(express.json());
		router.use(requireLogin);
	}

	groupRouter.use(loadPlayableUniverse);
	groupRouter.get('/difficulty-levels', difficultyLevelsRoute);
	groupRouter.post('/', createRoute);
	groupRouter.post('/:groupId/leave', leaveRoute);
	groupRouter.post('/:groupId/invites', inviteRoute);
	groupRouter.use(handleGroupError);
	app.use(`${UNIVERSES_PATH}/:universeId/groups`, groupRouter);

	inviteRouter.get('/:token', inviteDetailsRoute);
	inviteRouter.post('/:token', acceptInviteRoute);
	inviteRouter.use(handleGroupError);
	app.use(INVITES_PATH, inviteRouter);
}

/**
 * GET /difficulty-levels: the universe's difficulty levels, which Create Group offers
 *
 * @param request The request
 * @param response The response
 */
async function difficultyLevelsRoute(request: Request, response: Response): Promise<void>
{
	const universe = universeOf(request);
	const [levels, translator] = await Promise.all([
		listDifficultyLevels(liveVersion(universe.id)),
		loadTranslator(request, universe, ['difficultyLevel'])
	]);
	const payload: DifficultyLevelListPayload = { difficultyLevels: levels.map((level) => translator.name('difficultyLevel', level.id, level)) };

	response.json(payload);
}

/**
 * Where a group made around a character starts: the starting area the universe, the character's race
 * and their class choose now
 *
 * @param universe The universe
 * @param character The group's anchor being
 * @param executor A transaction
 * @return The area and cell, or null when nothing names an area
 */
async function findStartingPlace(universe: PlayableUniverse, character: OwnCharacter, executor: Executor): Promise<StartingPlace | null>
{
	const race = await findRaceStart(liveVersion(universe.id), universe.ruleset, character.raceId, executor);
	const characterClass = await findClassStart(liveVersion(universe.id), universe.ruleset, character.classId, character.raceId, executor);

	// A race or class that characters have can't be deleted
	if (!race || !characterClass)
	{
		throw new Error(`Character ${character.id} has a race or class universe ${universe.id} doesn't have`);
	}

	return(chooseStartingArea(((universe.startingAreaId === null)
		? null
		: {
			areaId: universe.startingAreaId,
			column: universe.startingColumn,
			row: universe.startingRow
		}), race, characterClass));
}

/**
 * POST /: makes a group around one of the player's characters who isn't in one, starting in their
 * starting area
 *
 * @param request The request
 * @param response The response
 */
async function createRoute(request: Request, response: Response): Promise<void>
{
	const body = newGroupRequest.safeParse(request.body);
	const playerId = playerIdOf(request);
	const universe = universeOf(request);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const { characterId: anchorId, name, difficultyLevelId } = body.data;
	const result = await inTransaction(async (transaction): Promise<Refusal | { groupId: string; anchor: GroupCharacter }> =>
	{
		// One change at a time to the player's characters, so a character can't be put in two groups at once
		await lockPlayer(playerId, transaction);
		// Deleting a difficulty level waits for the universe's lock too, so the level can't go as the group
		// takes it. The lock is shared, so players making groups in the same universe don't wait for each other
		await lockUniverseShared(universe.id, transaction);

		// Read again under the lock, since a save or a server admin that held it may have disabled the
		// universe, changed its stage or the player's role, or moved its starting area and deleted the old one
		const locked = await findAllowedUniverse(universe.id, playerId, canPlayUniverse, transaction);

		if (!locked)
		{
			return({ status: 404, message: errorMessages.noSuchUniverse });
		}

		const character = await findOwnCharacter(playerId, universe.id, anchorId, transaction);

		if (!character?.playable)
		{
			return({ status: 404, message: messages.characterUnavailable });
		}

		const bar = characterBar(character, await loadBarredOptions(universe.id, universe.ruleset, transaction));

		if (bar !== null)
		{
			return({
				status: 409,
				message: messages.characterBarred,
				values: {
					bar
				}
			});
		}

		if (await findMembership(anchorId, transaction))
		{
			return({ status: 409, message: messages.alreadyInGroup });
		}

		if (!(await findDifficultyLevel(liveVersion(universe.id), difficultyLevelId, transaction)))
		{
			return({ status: 404, message: messages.noSuchDifficulty });
		}

		const start = await findStartingPlace(locked, character, transaction);
		const groupId = await createGroup({
			universeId: universe.id,
			anchorCharacterId: anchorId,
			name,
			startingAreaId: (start?.areaId ?? null),
			startingColumn: (start?.column ?? 0),
			startingRow: (start?.row ?? 0),
			difficultyLevelId
		}, transaction);

		return({
			groupId,
			anchor: {
				characterId: anchorId,
				playerId,
				name: character.name,
				raceId: character.raceId,
				classId: character.classId,
				playable: true
			}
		});
	});

	if ('status' in result)
	{
		sendError(response, result.status, result.message, result.values);
		return;
	}

	groupChanges.publish({
		kind: 'joined',
		groupId: result.groupId,
		universeId: universe.id,
		character: result.anchor,
		created: true
	});

	const payload: GroupCreatedPayload = { groupId: result.groupId };

	response.status(201).json(payload);
}

/**
 * POST /:groupId/leave: takes one of the player's characters out of the group. The anchor being leaving
 * disbands it
 *
 * @param request The request
 * @param response The response
 */
async function leaveRoute(request: Request, response: Response): Promise<void>
{
	const groupId = z.uuid().safeParse(request.params.groupId);
	const body = groupCharacterRequest.safeParse(request.body);
	const playerId = playerIdOf(request);
	const universe = universeOf(request);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	if (!groupId.success)
	{
		sendError(response, 404, messages.noSuchGroup);
		return;
	}

	const refusal = await takeOutOfGroup(playerId, universe.id, groupId.data, body.data.characterId, groupNoticeRates);

	if (refusal)
	{
		sendError(response, refusal.status, refusal.message, refusal.values);
		return;
	}

	response.sendStatus(204);
}

/**
 * Takes a character out of a group, disbanding it when they are its anchor being, and tells the rooms.
 * A character leaving writes a notice in the group's chat, so it counts toward the limit on the notices
 * their player's characters write there (tryTakeGroupNotice()). Disbanding deletes the chat, so the
 * anchor being leaving doesn't count
 *
 * @param playerId The character's player's ID
 * @param universeId The universe's ID
 * @param groupId The group's ID
 * @param characterId The character's ID
 * @param notices How fast each player's characters write notices in each group's chat, or null when
 * the universe's creators take the character out, which isn't limited
 * @return Why they didn't leave (404 when the player has no such character or they aren't in the group,
 * 429 when the player's characters write notices in the group too quickly), or undefined once they have
 */
export async function takeOutOfGroup(playerId: string, universeId: string, groupId: string, characterId: string, notices: RateLimiter | null): Promise<Refusal | undefined>
{
	const result = await inTransaction(async (transaction): Promise<Refusal | LeftGroup> =>
	{
		// The player, then the universe, then the group (leaveGroup locks it): the order making and joining
		// a group take them in
		await lockPlayer(playerId, transaction);
		await lockUniverseShared(universeId, transaction);

		if (!await findOwnCharacter(playerId, universeId, characterId, transaction))
		{
			return({ status: 404, message: messages.noSuchGroup });
		}

		const membership = await findMembership(characterId, transaction);

		// Before anything is written, since a refusal still commits the transaction
		if ((notices !== null) && (membership?.groupId === groupId) && !membership.isAnchor && !tryTakeGroupNotice(groupId, playerId, notices))
		{
			return({ status: 429, message: messages.leaveTooFast });
		}

		return(((await leaveGroup(groupId, characterId, transaction)) ?? { status: 404, message: messages.noSuchGroup }));
	});

	if ('status' in result)
	{
		return(result);
	}

	if (result.kind === 'disbanded')
	{
		groupChanges.publish({
			kind: 'disbanded',
			groupId,
			universeId,
			members: result.members
		});
	}
	else
	{
		groupChanges.publish({
			kind: 'left',
			groupId,
			universeId,
			character: result.character
		});
	}

	return(undefined);
}

/**
 * Why a character couldn't leave a group: the group was disbanded, or the character had already left
 */
export const noSuchGroupMessage = messages.noSuchGroup;

/**
 * POST /:groupId/invites: makes an invite link to the group, for the anchor being's player only
 *
 * @param request The request
 * @param response The response
 */
async function inviteRoute(request: Request, response: Response): Promise<void>
{
	const groupId = z.uuid().safeParse(request.params.groupId);
	const body = newInviteRequest.safeParse(request.body);
	const playerId = playerIdOf(request);
	const universe = universeOf(request);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const group = (groupId.success ? await findGroup(groupId.data) : undefined);

	if (!group || (group.universeId !== universe.id))
	{
		sendError(response, 404, messages.noSuchGroup);
		return;
	}

	if (!await findOwnCharacter(playerId, universe.id, group.anchorCharacterId))
	{
		sendError(response, 403, messages.onlyAnchorInvites);
		return;
	}

	const token = randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
	const durationMs = INVITE_DURATION_MS[body.data.duration];
	const expiresAt = ((durationMs !== null) ? new Date(Date.now() + durationMs) : null);

	await createInvite({
		groupId: group.id,
		tokenHash: hashToken(token),
		multiUse: body.data.multiUse,
		expiresAt
	});

	const payload: InviteCreatedPayload = {
		token,
		expiresAt: (expiresAt?.toISOString() ?? null)
	};

	response.status(201).json(payload);
}

/**
 * GET INVITES_PATH/:token: the group an invite link leads to, unless the link has expired or been used
 * up, or the player may not play its universe
 *
 * @param request The request
 * @param response The response
 */
async function inviteDetailsRoute(request: Request, response: Response): Promise<void>
{
	const found = await findInviteGroup(request.params.token, playerIdOf(request));

	if (!found)
	{
		sendError(response, 404, messages.inviteGone);
		return;
	}

	const { universe, group } = found;
	const [members, difficulty, translator] = await Promise.all([
		listGroupMembers(group.id),
		findDifficultyLevel(liveVersion(universe.id), group.difficultyLevelId),
		loadTranslator(request, universe, ['universe', 'difficultyLevel'])
	]);

	// A group's level is moved to the default before the level is deleted, so it is always there
	if (!difficulty)
	{
		throw new Error(`Group ${group.id} plays at difficulty level ${group.difficultyLevelId}, which its universe doesn't have`);
	}

	const payload: InviteDetails = {
		universeId: universe.id,
		universeSlug: universe.slug,
		universeName: translator.text('universe', universe.id, 'name', universe.name),
		groupId: group.id,
		groupName: group.name,
		anchorName: (members.find((member) => (member.characterId === group.anchorCharacterId))?.name ?? ''),
		memberCount: members.length,
		groupSize: universe.groupSize,
		difficulty: {
			key: difficulty.key,
			name: translator.name('difficultyLevel', difficulty.id, difficulty).name,
			mobScale: difficulty.mobScale,
			permadeath: difficulty.permadeath
		}
	};

	response.json(payload);
}

/**
 * POST INVITES_PATH/:token: puts one of the player's characters in the invite's group (joinWithInvite())
 *
 * @param request The request
 * @param response The response
 */
async function acceptInviteRoute(request: Request, response: Response): Promise<void>
{
	const body = groupCharacterRequest.safeParse(request.body);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const result = await joinWithInvite(request.params.token, playerIdOf(request), body.data.characterId);

	if ('status' in result)
	{
		sendError(response, result.status, result.message, result.values);
		return;
	}

	response.json(result);
}

/**
 * Puts one of a player's characters in an invite link's group, unless it is full, and tells the rooms.
 * A single-use link is used up. A character already in the group just stays in it. Joining writes a
 * notice in the group's chat, so it counts toward the limit on the notices the player's characters write
 * there (tryTakeGroupNotice())
 *
 * @param token The invite link's token, as the request's path has it
 * @param playerId The player's ID
 * @param joiningId The character's ID
 * @param notices How fast each player's characters write notices in each group's chat
 * @return The group the character is in, or why they didn't join
 */
export async function joinWithInvite(token: unknown, playerId: string, joiningId: string, notices: RateLimiter = groupNoticeRates): Promise<Refusal | GroupJoinedPayload>
{
	const found = await findInviteGroup(token, playerId);

	if (!found)
	{
		return({ status: 404, message: messages.inviteGone });
	}

	const { universe, tokenHash } = found;
	const result = await inTransaction(async (transaction): Promise<Refusal | { groupId: string; joined?: GroupCharacter }> =>
	{
		// The player, then the universe, then the group: the order making a group and saving the world
		// editor (which changes groups) take them in. The universe's lock is shared, so players joining
		// groups in the same universe wait only for the group they join
		await lockPlayer(playerId, transaction);
		await lockUniverseShared(universe.id, transaction);

		// Read again under the lock, since a save or a server admin that held it may have disabled the
		// universe, changed its stage, its group size or the player's role
		const locked = await findAllowedUniverse(universe.id, playerId, canPlayUniverse, transaction);

		if (!locked)
		{
			return({ status: 404, message: messages.inviteGone });
		}

		// The invite is read again under the group's lock, so a single-use link lets in only one character
		const invite = await findInvite(tokenHash, transaction);
		const group = (invite ? await lockGroup(invite.groupId, transaction) : undefined);

		if (!invite || !group)
		{
			return({ status: 404, message: messages.inviteGone });
		}

		const character = await findOwnCharacter(playerId, universe.id, joiningId, transaction);

		if (!character?.playable)
		{
			return({ status: 404, message: messages.characterUnavailable });
		}

		const bar = characterBar(character, await loadBarredOptions(universe.id, universe.ruleset, transaction));

		if (bar !== null)
		{
			return({
				status: 409,
				message: messages.characterBarred,
				values: {
					bar
				}
			});
		}

		const membership = await findMembership(joiningId, transaction);

		if (membership?.groupId === group.id)
		{
			return({ groupId: group.id });
		}

		if (membership)
		{
			return({ status: 409, message: messages.alreadyInGroup });
		}

		if (await countGroupMembers(group.id, transaction) >= locked.groupSize)
		{
			return({
				status: 409,
				message: messages.groupFull,
				values: {
					max: locked.groupSize
				}
			});
		}

		// Before anything is written, since a refusal still commits the transaction
		if (!tryTakeGroupNotice(group.id, playerId, notices))
		{
			return({ status: 429, message: messages.joinTooFast });
		}

		await addGroupMember(group.id, joiningId, transaction);

		if (!invite.multiUse)
		{
			await deleteInvite(invite.id, transaction);
		}

		return({
			groupId: group.id,
			joined: {
				characterId: joiningId,
				playerId,
				name: character.name,
				raceId: character.raceId,
				classId: character.classId,
				playable: true
			}
		});
	});

	if ('status' in result)
	{
		return(result);
	}

	if (result.joined)
	{
		groupChanges.publish({
			kind: 'joined',
			groupId: result.groupId,
			universeId: universe.id,
			character: result.joined
		});
	}

	return({ groupId: result.groupId });
}

/**
 * The group and universe an invite link leads to, when the link still works and the player may play
 * the universe, which isn't disabled
 *
 * @param token The link's token, as a request's path has it; anything that can't be one leads nowhere
 * @param playerId The player following the link
 * @return The universe, the group and the token's hash, or undefined
 */
async function findInviteGroup(token: unknown, playerId: string): Promise<{ universe: PlayableUniverse; group: GroupRecord; tokenHash: string } | undefined>
{
	const parsed = inviteToken.safeParse(token);

	if (!parsed.success)
	{
		return(undefined);
	}

	const tokenHash = hashToken(parsed.data);
	const invite = await findInvite(tokenHash);
	const group = (invite ? await findGroup(invite.groupId) : undefined);

	if (!group)
	{
		return(undefined);
	}

	const universe = await findAllowedUniverse(group.universeId, playerId, canPlayUniverse);

	if (!universe)
	{
		return(undefined);
	}

	return({ universe, group, tokenHash });
}

/**
 * The hash an invite link's token is stored as
 *
 * @param token The token
 * @return SHA-256 of it, as hex
 */
function hashToken(token: string): string
{
	return(createHash('sha256').update(token).digest('hex'));
}

/**
 * Answers a request whose body couldn't be read with 400, and any other failure with 500
 *
 * @param error What went wrong
 * @param request The request
 * @param response The response
 * @param next Passes the error on when the response has already started
 */
function handleGroupError(error: unknown, request: Request, response: Response, next: NextFunction): void
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

	console.error('Group request %s %s failed:', request.method, requestRoute(request), error);
	sendError(response, 500, errorMessages.somethingWentWrong);
}
