import type { Client } from '@colyseus/sdk';
import { difficultyLevelsPath, groupPath, groupsPath, invitePath, type DifficultyLevel, type DifficultyLevelListPayload, type GroupCharacterRequest, type GroupCreatedPayload, type GroupJoinedPayload, type InviteCreatedPayload, type InviteDetails, type NewGroupRequest, type NewInviteRequest } from '@multiverse-kiln/shared';

import { sendRequest } from './editorApi';

/**
 * The routes that make groups, invite characters to them and take characters out of them (see
 * shared/src/groups.ts), for one browser
 *
 * Requests carry the browser ID cookie, so the server knows which player is asking. Every method
 * throws EditorApiError when the server refuses the request
 */
export class GroupApi
{
	/**
	 * @param client Client for the server
	 */
	constructor(private readonly client: Client)
	{
	}

	/**
	 * Makes a group around one of the player's characters, its anchor being
	 *
	 * @param universeId The universe's ID
	 * @param request The anchor being and the group's name
	 * @return The new group's ID
	 */
	async createGroup(universeId: string, request: NewGroupRequest): Promise<string>
	{
		return((await sendRequest<GroupCreatedPayload>(this.client, 'POST', groupsPath(universeId), request)).groupId);
	}

	/**
	 * A universe's difficulty levels, which a new group chooses from
	 *
	 * @param universeId The universe's ID
	 * @return The levels, easiest first
	 */
	async listDifficultyLevels(universeId: string): Promise<DifficultyLevel[]>
	{
		return((await sendRequest<DifficultyLevelListPayload>(this.client, 'GET', difficultyLevelsPath(universeId))).difficultyLevels);
	}

	/**
	 * Takes one of the player's characters out of their group; the anchor being leaving disbands it
	 *
	 * @param universeId The universe's ID
	 * @param groupId The group's ID
	 * @param characterId The character's ID
	 */
	async leaveGroup(universeId: string, groupId: string, characterId: string): Promise<void>
	{
		const request: GroupCharacterRequest = { characterId };

		await sendRequest(this.client, 'POST', `${groupPath(universeId, groupId)}/leave`, request);
	}

	/**
	 * Makes an invite link to a group, which only the anchor being's player may
	 *
	 * @param universeId The universe's ID
	 * @param groupId The group's ID
	 * @param request How the link may be used, and for how long
	 * @return The link's token and when it expires
	 */
	async createInvite(universeId: string, groupId: string, request: NewInviteRequest): Promise<InviteCreatedPayload>
	{
		return(sendRequest<InviteCreatedPayload>(this.client, 'POST', `${groupPath(universeId, groupId)}/invites`, request));
	}

	/**
	 * The group an invite link leads to
	 *
	 * @param token The link's token
	 * @return The group, its universe and how full it is
	 */
	async getInvite(token: string): Promise<InviteDetails>
	{
		return(sendRequest<InviteDetails>(this.client, 'GET', invitePath(token)));
	}

	/**
	 * Puts one of the player's characters in an invite link's group
	 *
	 * @param token The link's token
	 * @param characterId The character's ID
	 * @return The group's ID
	 */
	async acceptInvite(token: string, characterId: string): Promise<string>
	{
		const request: GroupCharacterRequest = { characterId };

		return((await sendRequest<GroupJoinedPayload>(this.client, 'POST', invitePath(token), request)).groupId);
	}
}
