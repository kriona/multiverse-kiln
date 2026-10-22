/**
 * Which player each client in a room controls
 *
 * A player here is someone on the room's map: in a lobby, a logged-in player, whom every window of the
 * browser controls; in a group's room, a character, whom any window of their player may control. So
 * several clients can control one player, and a client can switch to another
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
	 * Makes a client control another player
	 *
	 * @param sessionId The client's session ID
	 * @param playerId The player it controls now
	 * @return The player it controlled, and whether it was that player's last client; undefined for an unknown session
	 */
	move(sessionId: string, playerId: string): { playerId: string; wasLastClient: boolean } | undefined
	{
		const left = this.remove(sessionId);

		if (left)
		{
			this.add(sessionId, playerId);
		}

		return(left);
	}

	/**
	 * Forgets every client controlling a player
	 *
	 * @param playerId The player's ID
	 * @return The clients' session IDs
	 */
	removePlayer(playerId: string): string[]
	{
		const sessionIds = this.getSessionIds(playerId);

		for (const sessionId of sessionIds)
		{
			this.playerIdsBySession.delete(sessionId);
		}

		this.sessionIdsByPlayer.delete(playerId);

		return(sessionIds);
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
