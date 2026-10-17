import type { Client } from '@colyseus/sdk';
import { charactersPath, type CharacterDraft, type CharacterListPayload, type CreatedPayload, type NewCharacterOptions, type NewCharacterRequest } from '@multiverse-kiln/shared';

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
}
