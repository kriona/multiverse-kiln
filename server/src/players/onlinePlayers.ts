import { generateId } from 'colyseus';

/**
 * A logged-in player (server-only)
 */
export interface OnlinePlayerRecord
{
	/**
	 * Public ID of the player, used as their key in synced state. The browser ID never leaves the server
	 */
	readonly playerId: string;

	readonly name: string;

	/**
	 * ID of the game room the player's group plays in, or undefined when they are in the lobby
	 */
	readonly groupId: string | undefined;
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
 * Every logged-in player, keyed by browser ID, and the group each one is in
 *
 * This is the source of truth for logins and group membership: the lobby changes it, and game rooms
 * admit only the players it says are in their group. Every window of a browser is the same player.
 * It lives in memory until there is a real login system, so it only works with a single server process
 */
export class OnlinePlayers
{
	private readonly players = new Map<string, OnlinePlayerRecord>();
	private readonly listeners = new Set<OnlinePlayerListener>();

	/**
	 * @param createPlayerId Returns a new, unique player ID
	 */
	constructor(private readonly createPlayerId: () => string)
	{
	}

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
	 * Logs a browser in, unless it already is
	 *
	 * @param browserId The browser's ID
	 * @param name The player's name, already validated
	 * @return The browser's player
	 */
	logIn(browserId: string, name: string): OnlinePlayerRecord
	{
		const existing = this.players.get(browserId);

		if (existing)
		{
			return(existing);
		}

		const player: OnlinePlayerRecord = { playerId: this.createPlayerId(), name, groupId: undefined };

		this.update(browserId, player);

		return(player);
	}

	/**
	 * Logs a browser out, taking its player out of their group
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
	 * Moves a browser's player into a group, or back to the lobby; a player is in at most one group
	 *
	 * @param browserId The browser's ID
	 * @param groupId The group's ID, or undefined for the lobby
	 * @return Whether the browser is logged in (nothing happens when it isn't)
	 */
	setGroup(browserId: string, groupId: string | undefined): boolean
	{
		const player = this.players.get(browserId);

		if (!player)
		{
			return(false);
		}

		if (player.groupId !== groupId)
		{
			this.update(browserId, { ...player, groupId });
		}

		return(true);
	}

	/**
	 * How many players are in a group
	 *
	 * @param groupId The group's ID
	 * @return The number of players
	 */
	countInGroup(groupId: string): number
	{
		let count = 0;

		for (const player of this.players.values())
		{
			if (player.groupId === groupId)
			{
				count++;
			}
		}

		return(count);
	}

	/**
	 * Moves every player in a group back to the lobby, for when the group ends
	 *
	 * @param groupId The group's ID
	 */
	disbandGroup(groupId: string): void
	{
		for (const [browserId, player] of [...this.players])
		{
			if (player.groupId === groupId)
			{
				this.update(browserId, { ...player, groupId: undefined });
			}
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
 * The server's logged-in players, shared by the lobby and every game room
 */
export const onlinePlayers = new OnlinePlayers(() => generateId());
