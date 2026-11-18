import type { Client } from '@colyseus/sdk';
import { characterPath, charactersPath, type CharacterDeletionPayload, type CharacterDraft, type CharacterItemsRequest, type CharacterListPayload, type CharacterSheet, type CreatedPayload, type EquipHand, type EquipRequest, type EquipRing, type GiveItemsRequest, type ItemQuantity, type UnequipRequest, type NewCharacterOptions, type NewCharacterRequest } from '@multiverse-kiln/shared';

import { sendRequest } from './editorApi';

/**
 * The routes for the player's characters (see shared/src/characters.ts), for one browser
 *
 * Requests carry the session cookie, so the server knows which player is asking. Every method
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
	 * Deletes one of the player's characters immediately
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

	/**
	 * Discards items one of the player's characters carries
	 *
	 * @param universeId The universe's ID
	 * @param characterId The character's ID
	 * @param items The items, each listed once, with how many of each to discard; all of an item when it
	 * is as many as they carry or more
	 */
	async discardItems(universeId: string, characterId: string, items: ItemQuantity[]): Promise<void>
	{
		const request: CharacterItemsRequest = { items };

		await sendRequest(this.client, 'POST', `${characterPath(universeId, characterId)}/items/discard`, request);
	}

	/**
	 * Equips an item one of the player's characters carries, unequipping what was in its slots
	 *
	 * @param universeId The universe's ID
	 * @param characterId The character's ID
	 * @param itemId The item
	 * @param hand The hands to hold it in, or null for an item that is worn
	 * @param ring The ring slot to put a ring in, or null for a free one
	 */
	async equipItem(universeId: string, characterId: string, itemId: number, hand: EquipHand | null, ring: EquipRing | null): Promise<void>
	{
		const request: EquipRequest = {
			itemId,
			hand,
			ring
		};

		await sendRequest(this.client, 'POST', `${characterPath(universeId, characterId)}/items/equip`, request);
	}

	/**
	 * Unequips an item one of the player's characters has equipped
	 *
	 * @param universeId The universe's ID
	 * @param characterId The character's ID
	 * @param itemId The item
	 * @param slot The slot to unequip it from, or null for everywhere it is equipped
	 */
	async unequipItem(universeId: string, characterId: string, itemId: number, slot: string | null): Promise<void>
	{
		const request: UnequipRequest = {
			itemId,
			slot
		};

		await sendRequest(this.client, 'POST', `${characterPath(universeId, characterId)}/items/unequip`, request);
	}

	/**
	 * Gives items one of the player's characters carries to another character in their group
	 *
	 * @param universeId The universe's ID
	 * @param characterId The character giving them
	 * @param receiverId The character given them
	 * @param items The items, each listed once, with how many of each to give
	 */
	async giveItemsTo(universeId: string, characterId: string, receiverId: string, items: ItemQuantity[]): Promise<void>
	{
		const request: GiveItemsRequest = {
			characterId: receiverId,
			items
		};

		await sendRequest(this.client, 'POST', `${characterPath(universeId, characterId)}/items/give`, request);
	}
}
