import { Room, type AuthContext, type Client, type CloseCode } from 'colyseus';
import { SessionServerMessageType, type AccountPayload } from '@multiverse-kiln/shared';

import { resolveSession, type SessionIdentity } from '../auth/sessions.js';
import { connectedSessions } from '../players/connectedSessions.js';

/**
 * What onAuth found out about a client, available afterward as client.auth
 */
interface SessionWindow
{
	/**
	 * The window's login session, or null when its browser isn't logged in or the session has ended
	 */
	session: SessionIdentity | null;
}

type SessionClient = Client<{ auth: SessionWindow }>;

/**
 * Who a session client is
 *
 * @param client A client that has passed onAuth
 * @return Its identity
 */
function windowOf(client: SessionClient): SessionWindow
{
	if (!client.auth)
	{
		throw new Error(`Session client ${client.sessionId} has no identity`);
	}

	return(client.auth);
}

/**
 * The session: where windows learn who their player is
 *
 * There is one session room, which every window of every page joins as soon as it loads and stays in
 * until it closes, logged in or not. It tells each window who its player is, from its session cookie,
 * and tells a session's windows when the session ends. Being connected counts as using the session, so
 * an open page keeps it from ending for want of use
 */
export class SessionRoom extends Room<{ client: SessionClient }>
{
	autoDispose = false;

	// Clients send no messages, so an honest client stays far below this
	maxMessagesPerSecond = 10;

	/**
	 * The session room that is open, if any; there is only ever one
	 */
	private static current: SessionRoom | undefined;

	/**
	 * The logged-in clients of each session in the room, by session ID (server-only)
	 */
	private readonly windows = new Map<string, Set<SessionClient>>();

	private stopListening?: () => void;

	messages = {};

	/**
	 * Makes this the one session room
	 */
	onCreate(): void
	{
		if (SessionRoom.current)
		{
			throw new Error('The session room already exists');
		}

		SessionRoom.current = this;

		this.stopListening = connectedSessions.onEnd((sessionIds) =>
		{
			this.onSessionsEnd(sessionIds);
		});
	}

	/**
	 * Admits every window, finding out from its session cookie whether its browser is logged in
	 *
	 * @param _client The joining client
	 * @param _options Join options from the client (unused)
	 * @param context The connection's request headers, which carry the session cookie
	 * @return The window's identity, stored as client.auth
	 */
	async onAuth(_client: Client, _options: unknown, context: AuthContext): Promise<SessionWindow>
	{
		return({ session: ((await resolveSession(context.headers.get('cookie'))) ?? null) });
	}

	/**
	 * Records the window and tells it who its player is
	 *
	 * @param client The joining client
	 */
	onJoin(client: SessionClient): void
	{
		const { session } = windowOf(client);

		if (session)
		{
			let clients = this.windows.get(session.sessionId);

			if (!clients)
			{
				clients = new Set();
				this.windows.set(session.sessionId, clients);
			}

			clients.add(client);
			connectedSessions.connect(session.sessionId);
		}

		this.sendAccount(client, session);
	}

	/**
	 * Forgets the window
	 *
	 * @param client The leaving client
	 * @param code WebSocket close code
	 */
	onLeave(client: SessionClient, code: CloseCode): void
	{
		const { session } = windowOf(client);

		if (session)
		{
			const clients = this.windows.get(session.sessionId);

			clients?.delete(client);

			if (clients?.size === 0)
			{
				this.windows.delete(session.sessionId);
			}

			connectedSessions.disconnect(session.sessionId);
		}

		console.log(client.sessionId, 'left the session', code);
	}

	/**
	 * Stops following the sessions
	 */
	onDispose(): void
	{
		this.stopListening?.();

		if (SessionRoom.current === this)
		{
			SessionRoom.current = undefined;
		}
	}

	/**
	 * Tells the windows of sessions that ended that they are logged out. They stay in the room, as
	 * windows of a browser that isn't logged in
	 *
	 * @param sessionIds The sessions that ended
	 */
	private onSessionsEnd(sessionIds: ReadonlySet<string>): void
	{
		for (const sessionId of sessionIds)
		{
			for (const client of this.windows.get(sessionId) ?? [])
			{
				windowOf(client).session = null;
				this.sendAccount(client, null);
			}

			this.windows.delete(sessionId);
		}
	}

	/**
	 * Tells a window who its player is
	 *
	 * @param client The window
	 * @param session Its session, or null when it isn't logged in
	 */
	private sendAccount(client: SessionClient, session: SessionIdentity | null): void
	{
		const account: AccountPayload = {
			player: (session ? {
				playerId: session.playerId,
				name: session.name,
				sessionExpiresInMs: Math.max(0, (session.expiresAt.getTime() - Date.now()))
			} : null)
		};

		client.send(SessionServerMessageType.Account, account);
	}
}
