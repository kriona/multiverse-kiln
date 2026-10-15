/**
 * Which player each client in a room controls
 *
 * Every window of a browser is the same player, so several clients can control one player. The player
 * stays in the room until its last client leaves
 */
export class PlayerSessions
{
	private readonly sessionIdsByPlayer = new Map<string, Set<string>>();
	private readonly playerIdsBySession = new Map<string, string>();

	/**
	 * Records a joining client
	 *
	 * @param sessionId The client's session ID
	 * @param playerId The player the client controls
	 * @return Whether the player is new to the room (so the room needs to add it)
	 */
	add(sessionId: string, playerId: string): boolean
	{
		let sessionIds = this.sessionIdsByPlayer.get(playerId);
		const isNewPlayer = !sessionIds;

		if (!sessionIds)
		{
			sessionIds = new Set();
			this.sessionIdsByPlayer.set(playerId, sessionIds);
		}

		sessionIds.add(sessionId);
		this.playerIdsBySession.set(sessionId, playerId);

		return(isNewPlayer);
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

		const sessionIds = this.sessionIdsByPlayer.get(playerId);

		sessionIds?.delete(sessionId);

		const wasLastClient = (!sessionIds || (sessionIds.size === 0));

		if (wasLastClient)
		{
			this.sessionIdsByPlayer.delete(playerId);
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

	/**
	 * The clients controlling a player
	 *
	 * @param playerId The player's ID
	 * @return Their session IDs; empty when the player isn't in the room
	 */
	getSessionIds(playerId: string): string[]
	{
		return([...(this.sessionIdsByPlayer.get(playerId) ?? [])]);
	}
}
