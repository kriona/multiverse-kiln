/**
 * A change to who may play a universe: players whose role in it was changed or taken away so that they
 * may no longer play it in its stage
 */
export interface AccessLost
{
	universeId: string;
	playerIds: ReadonlySet<string>;
}

/**
 * Called after every change
 */
export type AccessLostListener = (change: AccessLost) => void;

/**
 * Tells the rooms when players lose the right to play a universe, so its lobby and groups turn them
 * out at once (ServerCloseCode.AccessLost)
 *
 * Changes are published after they are saved. It lives in memory, so it only reaches rooms in the same
 * server process, like GroupChanges
 */
export class UniverseAccessChanges
{
	private readonly listeners = new Set<AccessLostListener>();

	/**
	 * Tells every listener about players who lost the right to play a universe
	 *
	 * @param change The universe and the players
	 */
	publish(change: AccessLost): void
	{
		if (change.playerIds.size === 0)
		{
			return;
		}

		for (const listener of [...this.listeners])
		{
			listener(change);
		}
	}

	/**
	 * Listens for players losing the right to play a universe
	 *
	 * @param listener Called after each change
	 * @return Stops listening
	 */
	onLost(listener: AccessLostListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}
}

/**
 * The server's access changes, published by the editor's save and followed by the lobbies and game rooms
 */
export const universeAccessChanges = new UniverseAccessChanges();
