import {
	defineServer,
	defineRoom,
	monitor,
	playground,
} from 'colyseus';

import { GAME_ROOM_NAME, LOBBY_ROOM_NAME, SESSION_ROOM_NAME } from '@multiverse-kiln/shared';
import { GameRoom } from './rooms/GameRoom.js';
import { LobbyRoom } from './rooms/LobbyRoom.js';
import { SessionRoom } from './rooms/SessionRoom.js';
import { createTransport } from './transport.js';
import { startAuthSweep } from './authSweep.js';
import { startCharacterSweep } from './characterSweep.js';
import { isDevToolsEnabled } from './devTools.js';
import { addAdminRoutes } from './http/admin.js';
import { addAuthRoutes } from './http/auth.js';
import { addCharacterRoutes } from './http/characters.js';
import { addDevBotLoginRoute } from './http/devLogin.js';
import { addEditorRoutes } from './http/editor.js';
import { addGroupRoutes } from './http/groups.js';
import { addHealthRoute } from './http/health.js';
import { addTileGraphicRoute } from './http/tileGraphics.js';
import { addUniversesRoutes } from './http/universes.js';
import { createOriginCheck, parseAllowedOrigins } from './http/origins.js';
import { configureResponseHeaders } from './http/responseHeaders.js';
import { siteUrl } from './siteUrl.js';

// Origins allowed to use the server from a browser; startup fails if ALLOWED_ORIGINS is missing
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

configureResponseHeaders(allowedOrigins);

// The client's address, which emails link to; startup fails if SITE_URL is missing or isn't an https:// origin
siteUrl();

const server = defineServer({

	/**
	 * HTTPS/WSS; refuses to start without a certificate except on Colyseus Cloud and in tests (see transport.ts)
	 * WebSocket connections from browsers on origins outside ALLOWED_ORIGINS are rejected
	 */
	transport: createTransport({ beforeUpgrade: createOriginCheck(allowedOrigins) }),

	/**
	 * Deletes characters whose last rites are over, now and every hour, and tidies the login records
	 * (expired sessions, old email codes and rate limit records) now and every few minutes
	 */
	beforeListen: () =>
	{
		startCharacterSweep();
		startAuthSweep();
	},

	/**
	 * Room types clients can join
	 */
	rooms: {
		[SESSION_ROOM_NAME]: defineRoom(SessionRoom),

		// One lobby per universe: clients asking for the same universeId share a room
		[LOBBY_ROOM_NAME]: defineRoom(LobbyRoom).filterBy(['universeId']),

		// One game room per group: clients asking for the same groupId share a room
		[GAME_ROOM_NAME]: defineRoom(GameRoom).filterBy(['groupId']),
	},

	/**
	 * Express routes and middleware
	 */
	express: (app) =>
	{
		// Don't advertise the server software: Express adds X-Powered-By to every response
		app.disable('x-powered-by');

		addHealthRoute(app);
		addAuthRoutes(app, allowedOrigins);
		addUniversesRoutes(app);
		addCharacterRoutes(app, allowedOrigins);
		addGroupRoutes(app, allowedOrigins);
		addEditorRoutes(app, allowedOrigins);
		addTileGraphicRoute(app);
		addAdminRoutes(app, allowedOrigins);

		if (isDevToolsEnabled())
		{
			// @colyseus/monitor can inspect and dispose rooms; never expose it unauthenticated
			app.use('/monitor', monitor());

			// Bots, such as the load test's, log in without email
			addDevBotLoginRoute(app);

			// @colyseus/playground lets anyone join rooms with arbitrary options
			app.use('/', playground());
		}
		else
		{
			// Colyseus serves its version number at / unless another route claims it
			app.get('/', (_request, response) =>
			{
				response.sendStatus(404);
			});
		}
	}
});

export default server;

