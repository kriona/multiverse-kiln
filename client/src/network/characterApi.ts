import type { Client } from '@colyseus/sdk';
import { characterPath, charactersPath, type CharacterDeletionPayload, type CharacterDraft, type CharacterListPayload, type CharacterSheet, type CreatedPayload, type NewCharacterOptions, type NewCharacterRequest } from '@multiverse-kiln/shared';

import { sendRequest } from './editorApi';

/**
 * The routes for the player's characters (see shared/src/characters.ts), for one browser
 *
 * Requests carry the browser ID cookie, so the server knows which player is asking. Every method
 * throws EditorApiError when the server refuses the request
 */
export class CharacterApi
{
	/**
	 * @param client Client for the server
	 */
	constructor(private readonly client: Client)
	{
	}

	/**
	 * The player's characters in a universe
	 *
	 * @param universeId The universe's ID
	 * @return The characters, oldest first
	 */
	async listCharacters(universeId: string): Promise<CharacterListPayload>
	{
		return(sendRequest<CharacterListPayload>(this.client, 'GET', charactersPath(universeId)));
	}

	/**
	 * What Create Character offers in a universe, with the player's rolled ability scores if it rolls them
	 *
	 * @param universeId The universe's ID
	 * @return The options
	 */
	async getNewCharacterOptions(universeId: string): Promise<NewCharacterOptions>
	{
		return(sendRequest<NewCharacterOptions>(this.client, 'GET', `${charactersPath(universeId)}/new`));
	}

	/**
	 * Saves the player's progress in Create Character in a universe
	 *
	 * @param universeId The universe's ID
	 * @param draft The progress
	 */
	async saveDraft(universeId: string, draft: CharacterDraft): Promise<void>
	{
		await sendRequest(this.client, 'PUT', `${charactersPath(universeId)}/draft`, draft);
	}

	/**
	 * Throws away the player's progress in Create Character in a universe, keeping their rolled scores
	 *
	 * @param universeId The universe's ID
	 */
	async deleteDraft(universeId: string): Promise<void>
	{
		await sendRequest(this.client, 'DELETE', `${charactersPath(universeId)}/draft`);
	}

	/**
	 * Makes a character in a universe
	 *
	 * @param universeId The universe's ID
	 * @param character The character
	 * @return The new character's ID
	 */
	async createCharacter(universeId: string, character: NewCharacterRequest): Promise<string>
	{
		return((await sendRequest<CreatedPayload>(this.client, 'POST', charactersPath(universeId), character)).id);
	}

	/**
	 * One of the player's characters, as their character sheet shows them
	 *
	 * @param universeId The universe's ID
	 * @param characterId The character's ID
	 * @return The character
	 */
	async getCharacterSheet(universeId: string, characterId: string): Promise<CharacterSheet>
	{
		return(sendRequest<CharacterSheet>(this.client, 'GET', characterPath(universeId, characterId)));
	}

	/**
	 * Deletes one of the player's characters straight away
	 *
	 * @param universeId The universe's ID
	 * @param characterId The character's ID
	 */
	async deleteCharacter(universeId: string, characterId: string): Promise<void>
	{
		await sendRequest(this.client, 'DELETE', characterPath(universeId, characterId));
	}

	/**
	 * Gives one of the player's characters their last rites, so they are deleted the site's
	 * characterDeletionDays later. Refused while the site sets that to 0
	 *
	 * @param universeId The universe's ID
	 * @param characterId The character's ID
	 * @return When the character is deleted, as an ISO 8601 time
	 */
	async scheduleCharacterDeletion(universeId: string, characterId: string): Promise<string>
	{
		return((await sendRequest<CharacterDeletionPayload>(this.client, 'PUT', `${characterPath(universeId, characterId)}/deletion`)).deleteAt);
	}

	/**
	 * Restores one of the player's characters given their last rites
	 *
	 * @param universeId The universe's ID
	 * @param characterId The character's ID
	 */
	async restoreCharacter(universeId: string, characterId: string): Promise<void>
	{
		await sendRequest(this.client, 'DELETE', `${characterPath(universeId, characterId)}/deletion`);
	}
}
