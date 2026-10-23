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
import { canPlayUniverse, defineMessages, DISALLOWED_TEXT_CHARACTERS, INVITE_DURATION_MS, INVITE_DURATIONS, INVITES_PATH, MAX_GROUP_NAME_LENGTH, UNIVERSES_PATH, type DifficultyLevelListPayload, type GroupCharacterRequest, type GroupCreatedPayload, type GroupJoinedPayload, type InviteCreatedPayload, type InviteDetails, type NewGroupRequest, type NewInviteRequest } from '@multiverse-kiln/shared';

import { findOwnCharacter } from '../db/characterRepo.js';
import { findDifficultyLevel, listDifficultyLevels } from '../db/difficultyRepo.js';
import { addGroupMember, countGroupMembers, createGroup, createInvite, deleteInvite, findGroup, findInvite, findMembership, leaveGroup, listGroupMembers, lockGroup, type GroupCharacter, type GroupRecord } from '../db/groupRepo.js';
import { lockPlayer } from '../db/playerRepo.js';
import { inTransaction } from '../db/transactions.js';
import { findUniverseRole } from '../db/universeEditorRepo.js';
import { findEditableUniverse, lockUniverse } from '../db/universeRepo.js';
import { groupChanges } from '../players/groupChanges.js';
import { loadPlayableUniverse, universeOf, type PlayableUniverse } from './characters.js';
import { playerIdOf, refuseWritesFromOtherOrigins, requireLogin } from './editorAccess.js';
import { errorMessages, sendError, sendInvalidRequest, type Refusal } from './errors.js';

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
	const payload: DifficultyLevelListPayload = { difficultyLevels: await listDifficultyLevels(universeOf(request).id) };

	response.json(payload);
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
		// Deleting a difficulty level waits for the universe's lock too, so the level can't go as the group takes it
		await lockUniverse(universe.id, transaction);

		const character = await findOwnCharacter(playerId, universe.id, anchorId, transaction);

		if (!character?.playable)
		{
			return({ status: 404, message: messages.characterUnavailable });
		}

		if (await findMembership(anchorId, transaction))
		{
			return({ status: 409, message: messages.alreadyInGroup });
		}

		if (!(await findDifficultyLevel(universe.id, difficultyLevelId, transaction)))
		{
			return({ status: 404, message: messages.noSuchDifficulty });
		}

		const groupId = await createGroup({
			universeId: universe.id,
			anchorCharacterId: anchorId,
			name,
			startingAreaId: (character.areaId ?? universe.startingAreaId),
			difficultyLevelId
		}, transaction);

		return({
			groupId,
			anchor: {
				characterId: anchorId,
				playerId,
				name: character.name,
				raceId: character.raceId,
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
		character: result.anchor
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

	const result = await inTransaction(async (transaction) =>
	{
		if (!await findOwnCharacter(playerId, universe.id, body.data.characterId, transaction))
		{
			return(undefined);
		}

		return(leaveGroup(groupId.data, body.data.characterId, transaction));
	});

	if (!result)
	{
		sendError(response, 404, messages.noSuchGroup);
		return;
	}

	if (result.kind === 'disbanded')
	{
		groupChanges.publish({
			kind: 'disbanded',
			groupId: groupId.data,
			universeId: universe.id,
			members: result.members
		});
	}
	else
	{
		groupChanges.publish({
			kind: 'left',
			groupId: groupId.data,
			universeId: universe.id,
			character: result.character
		});
	}

	response.sendStatus(204);
}

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
	const found = await findInviteGroup(request);

	if (!found)
	{
		sendError(response, 404, messages.inviteGone);
		return;
	}

	const { universe, group } = found;
	const members = await listGroupMembers(group.id);
	const difficulty = await findDifficultyLevel(universe.id, group.difficultyLevelId);

	// A group's level is moved to the default before the level is deleted, so it is always there
	if (!difficulty)
	{
		throw new Error(`Group ${group.id} plays at difficulty level ${group.difficultyLevelId}, which its universe doesn't have`);
	}

	const payload: InviteDetails = {
		universeId: universe.id,
		universeSlug: universe.slug,
		universeName: universe.name,
		groupId: group.id,
		groupName: group.name,
		anchorName: (members.find((member) => (member.characterId === group.anchorCharacterId))?.name ?? ''),
		memberCount: members.length,
		groupSize: universe.groupSize,
		difficulty: {
			key: difficulty.key,
			name: difficulty.name,
			mobScale: difficulty.mobScale,
			permadeath: difficulty.permadeath
		}
	};

	response.json(payload);
}

/**
 * POST INVITES_PATH/:token: puts one of the player's characters in the invite's group, unless it is
 * full. A single-use link is used up. A character already in the group just stays in it
 *
 * @param request The request
 * @param response The response
 */
async function acceptInviteRoute(request: Request, response: Response): Promise<void>
{
	const body = groupCharacterRequest.safeParse(request.body);
	const playerId = playerIdOf(request);

	if (!body.success)
	{
		sendInvalidRequest(response, body.error);
		return;
	}

	const found = await findInviteGroup(request);

	if (!found)
	{
		sendError(response, 404, messages.inviteGone);
		return;
	}

	const { universe, tokenHash } = found;
	const joiningId = body.data.characterId;
	const result = await inTransaction(async (transaction): Promise<Refusal | { groupId: string; joined?: GroupCharacter }> =>
	{
		// The invite is read again under the group's lock, so a single-use link lets in only one character
		const invite = await findInvite(tokenHash, transaction);
		const group = (invite ? await lockGroup(invite.groupId, transaction) : undefined);

		if (!invite || !group)
		{
			return({ status: 404, message: messages.inviteGone });
		}

		await lockPlayer(playerId, transaction);

		const character = await findOwnCharacter(playerId, universe.id, joiningId, transaction);

		if (!character?.playable)
		{
			return({ status: 404, message: messages.characterUnavailable });
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

		if (await countGroupMembers(group.id, transaction) >= universe.groupSize)
		{
			return({
				status: 409,
				message: messages.groupFull,
				values: {
					max: universe.groupSize
				}
			});
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
				playable: true
			}
		});
	});

	if ('status' in result)
	{
		sendError(response, result.status, result.message, result.values);
		return;
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

	const payload: GroupJoinedPayload = { groupId: result.groupId };

	response.json(payload);
}

/**
 * The group and universe a request's invite link leads to, when the link still works and the player
 * may play the universe
 *
 * @param request The request, with the token in its path
 * @return The universe, the group and the token's hash, or undefined
 */
async function findInviteGroup(request: Request): Promise<{ universe: PlayableUniverse; group: GroupRecord; tokenHash: string } | undefined>
{
	const token = inviteToken.safeParse(request.params.token);

	if (!token.success)
	{
		return(undefined);
	}

	const tokenHash = hashToken(token.data);
	const invite = await findInvite(tokenHash);
	const group = (invite ? await findGroup(invite.groupId) : undefined);

	if (!group)
	{
		return(undefined);
	}

	const [universe, role] = await Promise.all([
		findEditableUniverse(group.universeId),
		findUniverseRole(group.universeId, playerIdOf(request))
	]);

	if (!universe || !canPlayUniverse(universe.stage, role))
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

	console.error(`Group request ${request.method} ${request.originalUrl} failed:`, error);
	sendError(response, 500, errorMessages.somethingWentWrong);
}
