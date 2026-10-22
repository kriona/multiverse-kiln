/**
 * A logged-in player (server-only)
 */
export interface OnlinePlayerRecord
{
	/**
	 * Public ID of the player (their account's ID), used as their key in synced state. The browser ID never leaves the server
	 */
	readonly playerId: string;

	readonly name: string;
}

/**
 * A change to one browser's player
 */
export interface OnlinePlayerChange
{
	browserId: string;

	/**
	 * The player before the change, or undefined when the browser just logged in
	 */
	before: OnlinePlayerRecord | undefined;

	/**
	 * The player after the change, or undefined when the browser just logged out
	 */
	after: OnlinePlayerRecord | undefined;
}

/**
 * Called after every change to a browser's player
 */
export type OnlinePlayerListener = (change: OnlinePlayerChange) => void;

/**
 * Every logged-in player, keyed by browser ID
 *
 * This is the source of truth for logins: the lobbies and game rooms admit only browsers it says are
 * logged in. Every window of a browser is the same player, and a player is logged in from at most one
 * browser. Which character each window plays, and where, is up to the window. It lives in memory, so it
 * only works with a single server process
 */
export class OnlinePlayers
{
	private readonly players = new Map<string, OnlinePlayerRecord>();
	private readonly listeners = new Set<OnlinePlayerListener>();

	/**
	 * The player a browser is logged in as
	 *
	 * @param browserId The browser's ID
	 * @return The player, or undefined when the browser isn't logged in
	 */
	get(browserId: string): OnlinePlayerRecord | undefined
	{
		return(this.players.get(browserId));
	}

	/**
	 * Every logged-in player
	 *
	 * @return The players, keyed by browser ID
	 */
	all(): ReadonlyMap<string, OnlinePlayerRecord>
	{
		return(this.players);
	}

	/**
	 * Logs a browser in as a player, unless it already is logged in
	 *
	 * @param browserId The browser's ID
	 * @param playerId The player's account ID
	 * @param name The player's name
	 * @return The browser's player, or undefined when the player is logged in from another browser
	 */
	logIn(browserId: string, playerId: string, name: string): OnlinePlayerRecord | undefined
	{
		const existing = this.players.get(browserId);

		if (existing)
		{
			return(existing);
		}

		for (const other of this.players.values())
		{
			if (other.playerId === playerId)
			{
				return(undefined);
			}
		}

		const player: OnlinePlayerRecord = {
			playerId,
			name
		};

		this.update(browserId, player);

		return(player);
	}

	/**
	 * Logs a browser out
	 *
	 * @param browserId The browser's ID
	 */
	logOut(browserId: string): void
	{
		if (this.players.has(browserId))
		{
			this.update(browserId, undefined);
		}
	}

	/**
	 * Listens for changes to any browser's player
	 *
	 * @param listener Called after each change
	 * @return Stops listening
	 */
	onChange(listener: OnlinePlayerListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}

	/**
	 * Replaces or removes a browser's player and tells the listeners
	 *
	 * @param browserId The browser's ID
	 * @param after The new player, or undefined to remove it
	 */
	private update(browserId: string, after: OnlinePlayerRecord | undefined): void
	{
		const before = this.players.get(browserId);

		if (after)
		{
			this.players.set(browserId, after);
		}
		else
		{
			this.players.delete(browserId);
		}

		for (const listener of [...this.listeners])
		{
			listener({ browserId, before, after });
		}
	}
}

/**
 * The server's logged-in players, shared by the session, the lobbies and every game room
 */
export const onlinePlayers = new OnlinePlayers();
