/**
 * Called with the IDs of sessions that just ended
 */
export type SessionEndListener = (sessionIds: ReadonlySet<string>) => void;

/**
 * The login sessions with windows connected to a room, and who to tell when sessions end
 *
 * Sessions themselves are in the database (server/src/db/sessionRepo.ts). This counts each session's
 * connected windows, so the auth sweep can record that those sessions are in use: an open connection
 * counts as use. And when sessions end (logging out, changing the password, expiring), the rooms hear
 * of it here and turn their windows away. It lives in memory, so it only works with a single server
 * process
 */
export class ConnectedSessions
{
	private readonly windows = new Map<string, number>();
	private readonly listeners = new Set<SessionEndListener>();

	/**
	 * Counts a window connecting with a session
	 *
	 * @param sessionId The session
	 */
	connect(sessionId: string): void
	{
		this.windows.set(sessionId, ((this.windows.get(sessionId) ?? 0) + 1));
	}

	/**
	 * Counts a window leaving. A session that has ended is no longer counted, so this does nothing for it
	 *
	 * @param sessionId The session
	 */
	disconnect(sessionId: string): void
	{
		const count = this.windows.get(sessionId);

		if (count === undefined)
		{
			return;
		}

		if (count <= 1)
		{
			this.windows.delete(sessionId);
		}
		else
		{
			this.windows.set(sessionId, (count - 1));
		}
	}

	/**
	 * The sessions with at least one window connected
	 *
	 * @return Their IDs
	 */
	ids(): string[]
	{
		return([...this.windows.keys()]);
	}

	/**
	 * Tells the rooms that sessions have ended, and stops counting them
	 *
	 * @param sessionIds The sessions, already deleted from the database
	 */
	end(sessionIds: Iterable<string>): void
	{
		const ended = new Set(sessionIds);

		if (ended.size === 0)
		{
			return;
		}

		for (const sessionId of ended)
		{
			this.windows.delete(sessionId);
		}

		for (const listener of [...this.listeners])
		{
			listener(ended);
		}
	}

	/**
	 * Listens for sessions ending
	 *
	 * @param listener Called with the ended sessions' IDs
	 * @return Stops listening
	 */
	onEnd(listener: SessionEndListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}
}

/**
 * The server's connected sessions, shared by the session room, the lobbies, every game room and the auth routes
 */
export const connectedSessions = new ConnectedSessions();
