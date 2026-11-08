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

	/**
	 * The session each counted window connected with. A window leaving is uncounted only when it was
	 * counted, so a room can uncount every window that leaves, even one turned away before it was counted
	 */
	private readonly sessionOfWindow = new WeakMap<object, string>();

	private readonly listeners = new Set<SessionEndListener>();

	/**
	 * Counts a window connecting with a session; a window already counted stays counted once
	 *
	 * @param window The window, such as its room client
	 * @param sessionId The session
	 */
	connect(window: object, sessionId: string): void
	{
		if (this.sessionOfWindow.has(window))
		{
			return;
		}

		this.sessionOfWindow.set(window, sessionId);
		this.windows.set(sessionId, ((this.windows.get(sessionId) ?? 0) + 1));
	}

	/**
	 * Counts a window leaving. A window that wasn't counted, or whose session has ended and is no longer
	 * counted, changes nothing
	 *
	 * @param window The window, as it was counted
	 */
	disconnect(window: object): void
	{
		const sessionId = this.sessionOfWindow.get(window);

		this.sessionOfWindow.delete(window);

		const count = ((sessionId === undefined) ? undefined : this.windows.get(sessionId));

		if ((sessionId === undefined) || (count === undefined))
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
