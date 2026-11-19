import type { ItemsReceivedPayload } from '@multiverse-kiln/shared';

/**
 * A change to a character's items or equipment, for their player's windows
 *
 * - changed: the character's items, equipment or look changed, so a sheet showing them loads them again,
 *   and a list showing their avatar shows it again
 * - received: another character gave the character items, for a toast saying who gave them what, with
 *   the item named in each window's language: received() gives the toast for the languages a window
 *   wants universe text in, most wanted first (windowLanguages())
 */
export type CharacterItemChange =
	| { kind: 'changed'; playerId: string; universeId: string; characterId: string }
	| { kind: 'received'; playerId: string; received: (languages: readonly string[]) => ItemsReceivedPayload };

/**
 * Called after every change
 */
export type CharacterItemChangeListener = (change: CharacterItemChange) => void;

/**
 * Tells the session room about changes to characters' items and equipment as they are made, so every
 * window of the character's player showing their sheet shows the change, wherever it was made: the
 * character's sheet in another window, a gift from another character, the universe's creators, or a save
 * of the world editor unequipping items
 *
 * Changes are published after they are saved. It lives in memory, so it only reaches windows connected to
 * the same server process, like CharacterChanges
 */
export class CharacterItemChanges
{
	private readonly listeners = new Set<CharacterItemChangeListener>();

	/**
	 * Tells every listener about a change that has been saved
	 *
	 * @param change The change
	 */
	publish(change: CharacterItemChange): void
	{
		for (const listener of [...this.listeners])
		{
			listener(change);
		}
	}

	/**
	 * Tells every listener that some characters' items or equipment changed
	 *
	 * @param universeId The characters' universe
	 * @param characters The characters, with their players
	 */
	publishChanged(universeId: string, characters: readonly { characterId: string; playerId: string }[]): void
	{
		for (const { characterId, playerId } of characters)
		{
			this.publish({
				kind: 'changed',
				playerId,
				universeId,
				characterId
			});
		}
	}

	/**
	 * Listens for changes
	 *
	 * @param listener Called after each change
	 * @return Stops listening
	 */
	onChange(listener: CharacterItemChangeListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}
}

/**
 * The server's character item changes, published by the character and editor routes and followed by the
 * session room
 */
export const characterItemChanges = new CharacterItemChanges();
