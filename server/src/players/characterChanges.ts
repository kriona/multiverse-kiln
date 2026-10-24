/**
 * A change to which of a player's characters can be played, for the lobby or group they may be playing in
 *
 * - removed: the character was deleted or given their last rites, so they can't be played
 * - restored: a character given their last rites was restored, so they can be played again: in the
 *   lobby, or in their group when inGroup
 */
export type CharacterChange =
	| { kind: 'removed'; playerId: string; universeId: string; characterId: string }
	| { kind: 'restored'; playerId: string; universeId: string; character: { id: string; name: string; raceId: number }; inGroup: boolean };

/**
 * Called after every change
 */
export type CharacterChangeListener = (change: CharacterChange) => void;

/**
 * Tells the lobbies and game rooms about changes to players' characters as they are made, so a player
 * stops playing a character that is deleted
 *
 * Changes are published after they are saved. It lives in memory, so it only reaches rooms in the same
 * server process, like OnlinePlayers
 */
export class CharacterChanges
{
	private readonly listeners = new Set<CharacterChangeListener>();

	/**
	 * Tells every listener about a change that has been saved
	 *
	 * @param change The change
	 */
	publish(change: CharacterChange): void
	{
		for (const listener of [...this.listeners])
		{
			listener(change);
		}
	}

	/**
	 * Listens for changes
	 *
	 * @param listener Called after each change
	 * @return Stops listening
	 */
	onChange(listener: CharacterChangeListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}
}

/**
 * The server's character changes, published by the character routes and followed by every lobby and game room
 */
export const characterChanges = new CharacterChanges();
