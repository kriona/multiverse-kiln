import {
	defineServer,
	defineRoom,
	monitor,
	playground,
	createRouter,
	createEndpoint,
} from 'colyseus';

/**
 * Import your Room files
 */
import { GAME_ROOM_NAME } from '@multiverse-kiln/shared';
import { MyRoom } from './rooms/MyRoom.js';
import { createTransport } from './transport.js';
import { isDevToolsEnabled } from './devTools.js';
import { createOriginCheck, parseAllowedOrigins } from './http/origins.js';
import { configureResponseHeaders } from './http/responseHeaders.js';

// Origins allowed to use the server from a browser; startup fails if ALLOWED_ORIGINS is missing
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

configureResponseHeaders(allowedOrigins);

const server = defineServer({

	/**
	 * HTTPS/WSS; refuses to start without a certificate except on Colyseus Cloud and in tests (see transport.ts)
	 * WebSocket connections from browsers on origins outside ALLOWED_ORIGINS are rejected
	 */
	transport: createTransport({ beforeUpgrade: createOriginCheck(allowedOrigins) }),

	/**
	 * Define your room handlers
	 */
	rooms: {
		[GAME_ROOM_NAME]: defineRoom(MyRoom),
	},

	/**
	 * Experimental: Define API routes. Built-in integration with the "playground" and SDK
	 *
	 * Usage from SDK:
	 *   client.http.get('/api/hello').then((response) => {})
	 */
	routes: createRouter({
		api_hello: createEndpoint('/api/hello', { method: 'GET' }, () =>
		{
			return(Promise.resolve({ message: 'Hello World' }));
		}),
	}),

	/**
	 * Bind your custom express routes here
	 * Read more: https://expressjs.com/en/starter/basic-routing.html
	 */
	express: (app) =>
	{
		// Don't advertise the server software: Express adds X-Powered-By to every response
		app.disable('x-powered-by');

		app.get('/hi', (req, res) =>
		{
			res.send('It\'s time to kick ass and chew bubblegum!');
		});

		if (isDevToolsEnabled())
		{
			// @colyseus/monitor can inspect and dispose rooms; never expose it unauthenticated
			app.use('/monitor', monitor());

			// @colyseus/playground lets anyone join rooms with arbitrary options
			app.use('/', playground());
		}
		else
		{
			// Colyseus serves its version number at / unless another route claims it
			app.get('/', (_req, res) =>
			{
				res.sendStatus(404);
			});
		}
	}
});

export default server;

