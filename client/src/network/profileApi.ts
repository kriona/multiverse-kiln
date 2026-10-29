import type { Client } from '@colyseus/sdk';
import { playerProfilePath, PROFILE_PATH, profileCharacterPath, type OwnProfilePayload, type PlayerProfilePayload, type ProfileField, type ProfileUpdateRequest } from '@multiverse-kiln/shared';

import { EditorApiError, sendRequest } from './editorApi';

/**
 * The profile routes (see shared/src/profiles.ts). Every method throws EditorApiError when the server
 * refuses the request; its message says why, in the player's language, and profileFieldOf() which
 * field it is about
 */
export class ProfileApi
{
	/**
	 * @param client Client for the server
	 */
	constructor(private readonly client: Client)
	{
	}

	/**
	 * The logged-in player's own profile
	 *
	 * @return The profile
	 */
	async getOwnProfile(): Promise<OwnProfilePayload>
	{
		return(await sendRequest<OwnProfilePayload>(this.client, 'GET', PROFILE_PATH));
	}

	/**
	 * Saves the logged-in player's profile
	 *
	 * @param profile The whole profile, with null for each field left blank
	 */
	async saveProfile(profile: ProfileUpdateRequest): Promise<void>
	{
		await sendRequest(this.client, 'PUT', PROFILE_PATH, profile);
	}

	/**
	 * Sets whether the profile lists one of the player's characters when it doesn't list them all
	 *
	 * @param characterId The character's ID
	 * @param visibleOnProfile Whether it lists them
	 */
	async setCharacterVisibility(characterId: string, visibleOnProfile: boolean): Promise<void>
	{
		await sendRequest(this.client, 'PUT', profileCharacterPath(characterId), { visibleOnProfile });
	}

	/**
	 * A player's profile, as others see it
	 *
	 * @param username The player's username
	 * @return The profile
	 */
	async getPlayerProfile(username: string): Promise<PlayerProfilePayload>
	{
		return(await sendRequest<PlayerProfilePayload>(this.client, 'GET', playerProfilePath(username)));
	}
}

/**
 * The profile field a refused save is about
 *
 * @param error What ProfileApi.saveProfile() threw
 * @return The field, or undefined when the refusal isn't about one
 */
export function profileFieldOf(error: unknown): ProfileField | undefined
{
	if (!(error instanceof EditorApiError) || (typeof error.data !== 'object') || (error.data === null) || !('field' in error.data) || (typeof error.data.field !== 'string'))
	{
		return(undefined);
	}

	return(error.data.field as ProfileField);
}
