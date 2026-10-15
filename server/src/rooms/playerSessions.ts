/**
 * A player and the clients controlling it
 */
interface PlayerEntry
{
	browserId: string | undefined;
	sessionIds: Set<string>;
}

/**
 * Which player each client in a room controls
 *
 * Clients with the same browser ID (windows of the same browser) share one player; a client without
 * one (a non-browser client, or a browser whose cookie request failed) gets a player of its own.
 * Player IDs are public, since they key GameState.players; browser IDs never leave the server
 */
export class PlayerSessions
{
	private readonly players = new Map<string, PlayerEntry>();
	private readonly playerIdsByBrowser = new Map<string, string>();
	private readonly playerIdsBySession = new Map<string, string>();

	/**
	 * @param createPlayerId Returns a new, unique player ID
	 */
	constructor(private readonly createPlayerId: () => string)
	{
	}

	/**
	 * Records a joining client, finding or creating the player it controls
	 *
	 * @param sessionId The client's session ID
	 * @param browserId The client's browser ID, or undefined when it has none
	 * @return The player's ID, and whether the player is new (so the room needs to add it)
	 */
	add(sessionId: string, browserId: string | undefined): { playerId: string; isNewPlayer: boolean }
	{
		const existingPlayerId = ((browserId !== undefined) ? this.playerIdsByBrowser.get(browserId) : undefined);
		const playerId = existingPlayerId ?? this.createPlayerId();
		let entry = this.players.get(playerId);

		if (!entry)
		{
			entry = { browserId, sessionIds: new Set() };
			this.players.set(playerId, entry);

			if (browserId !== undefined)
			{
				this.playerIdsByBrowser.set(browserId, playerId);
			}
		}

		entry.sessionIds.add(sessionId);
		this.playerIdsBySession.set(sessionId, playerId);

		return({ playerId, isNewPlayer: (existingPlayerId === undefined) });
	}

	/**
	 * Forgets a leaving client, and its player once no clients control it
	 *
	 * @param sessionId The client's session ID
	 * @return The player's ID, and whether that was its last client (so the room needs to remove it); undefined for an unknown session
	 */
	remove(sessionId: string): { playerId: string; wasLastClient: boolean } | undefined
	{
		const playerId = this.playerIdsBySession.get(sessionId);

		if (playerId === undefined)
		{
			return(undefined);
		}

		this.playerIdsBySession.delete(sessionId);

		const entry = this.players.get(playerId);

		entry?.sessionIds.delete(sessionId);

		const wasLastClient = (!entry || (entry.sessionIds.size === 0));

		if (wasLastClient)
		{
			this.players.delete(playerId);

			if (entry?.browserId !== undefined)
			{
				this.playerIdsByBrowser.delete(entry.browserId);
			}
		}

		return({ playerId, wasLastClient });
	}

	/**
	 * The player a client controls
	 *
	 * @param sessionId The client's session ID
	 * @return The player's ID, or undefined for an unknown session
	 */
	getPlayerId(sessionId: string): string | undefined
	{
		return(this.playerIdsBySession.get(sessionId));
	}
}
