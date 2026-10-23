/**
 * Groups: the routes that make, join and leave them, and what they send and receive (see
 * STRUCTURE-OVERVIEW.md, Create Group)
 *
 * Every route needs a logged-in browser:
 * - POST groupsPath(universeId): makes a group around one of the player's characters, its anchor being
 *   (NewGroupRequest), answering GroupCreatedPayload. The difficulty levels it offers are at
 *   difficultyLevelsPath(universeId) (shared/src/difficulty.ts)
 * - POST groupPath(universeId, groupId)/leave: takes one of the player's characters out of the group
 *   (GroupCharacterRequest). The anchor being leaving disbands the group
 * - POST groupPath(universeId, groupId)/invites: makes an invite link (NewInviteRequest), answering
 *   InviteCreatedPayload. Only the anchor being's player may
 * - GET invitePath(token): what an invite link leads to (InviteDetails)
 * - POST invitePath(token): puts one of the player's characters in the invite's group
 *   (GroupCharacterRequest), answering GroupJoinedPayload, or 409 when the group is full
 */
import { UNIVERSES_PATH } from './constants.js';
import type { DifficultyLevel } from './difficulty.js';

/**
 * Longest group name, after trimming
 */
export const MAX_GROUP_NAME_LENGTH = 40;

/**
 * Query string parameter of an invite link that holds its token
 */
export const INVITE_QUERY_PARAMETER = 'invite';

/**
 * Server route of invite links; invitePath() adds the token
 */
export const INVITES_PATH = '/invites';

/**
 * How long an invite link works
 */
export const INVITE_DURATIONS = ['day', 'week', 'indefinite'] as const;
export type InviteDuration = typeof INVITE_DURATIONS[number];

/**
 * How long each InviteDuration lasts in milliseconds; null for a link that never expires
 */
export const INVITE_DURATION_MS: Readonly<Record<InviteDuration, number | null>> = {
	day: 24 * 60 * 60 * 1000,
	week: 7 * 24 * 60 * 60 * 1000,
	indefinite: null
};

/**
 * The path of a universe's group routes
 *
 * @param universeId The universe's ID
 * @return The path
 */
export function groupsPath(universeId: string): string
{
	return(`${UNIVERSES_PATH}/${encodeURIComponent(universeId)}/groups`);
}

/**
 * The path of one group
 *
 * @param universeId The universe's ID
 * @param groupId The group's ID
 * @return The path
 */
export function groupPath(universeId: string, groupId: string): string
{
	return(`${groupsPath(universeId)}/${encodeURIComponent(groupId)}`);
}

/**
 * The path of an invite link's route
 *
 * @param token The link's token
 * @return The path
 */
export function invitePath(token: string): string
{
	return(`${INVITES_PATH}/${encodeURIComponent(token)}`);
}

/**
 * Body of POST groupsPath(universeId)
 */
export interface NewGroupRequest
{
	/**
	 * The anchor being: one of the player's characters in the universe who isn't in a group
	 */
	characterId: string;

	/**
	 * The group's name; may be empty
	 */
	name: string;

	/**
	 * One of the universe's difficulty levels (see shared/src/difficulty.ts)
	 */
	difficultyLevelId: number;
}

/**
 * Response of POST groupsPath(universeId)
 */
export interface GroupCreatedPayload
{
	groupId: string;
}

/**
 * Body of POST groupPath(universeId, groupId)/leave and POST invitePath(token)
 */
export interface GroupCharacterRequest
{
	/**
	 * One of the player's characters
	 */
	characterId: string;
}

/**
 * Body of POST groupPath(universeId, groupId)/invites
 */
export interface NewInviteRequest
{
	/**
	 * Whether the link can be used by more than one character
	 */
	multiUse: boolean;

	duration: InviteDuration;
}

/**
 * Response of POST groupPath(universeId, groupId)/invites
 */
export interface InviteCreatedPayload
{
	/**
	 * The link's token. The server keeps only a hash of it, so this is the only time it is sent
	 */
	token: string;

	/**
	 * When the link stops working (an ISO 8601 time), or null when it never does
	 */
	expiresAt: string | null;
}

/**
 * Response of GET invitePath(token): the group an invite link leads to
 */
export interface InviteDetails
{
	universeId: string;

	/**
	 * The universe's name in the form its pages' addresses use (universeSlug)
	 */
	universeSlug: string;

	universeName: string;
	groupId: string;

	/**
	 * The group's name; empty when it has none
	 */
	groupName: string;

	/**
	 * The anchor being's name
	 */
	anchorName: string;

	/**
	 * How many characters are in the group
	 */
	memberCount: number;

	/**
	 * Most characters the group may have: the universe's group size
	 */
	groupSize: number;

	/**
	 * The difficulty level the group plays at
	 */
	difficulty: Pick<DifficultyLevel, 'key' | 'name' | 'mobScale' | 'permadeath'>;
}

/**
 * Response of POST invitePath(token)
 */
export interface GroupJoinedPayload
{
	groupId: string;
}
