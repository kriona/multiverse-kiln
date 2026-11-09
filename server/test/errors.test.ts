import assert from 'assert';
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

import { requestRoute } from '../src/http/errors.js';

describe('requestRoute', () =>
{
	let server: http.Server;
	let address: string;
	let routes: string[];

	/**
	 * Fails a request
	 */
	function fail(): never
	{
		throw new Error('failed');
	}

	/**
	 * Notes the route a failed request would be logged with, and answers it with 500
	 *
	 * @param _error What went wrong
	 * @param request The request
	 * @param response The response
	 * @param _next The next error handler
	 */
	function noteRoute(_error: unknown, request: Request, response: Response, _next: NextFunction): void
	{
		routes.push(requestRoute(request));
		response.sendStatus(500);
	}

	before(async () =>
	{
		const app = express();
		const inviteRouter = express.Router();
		const universeRouter = express.Router();

		inviteRouter.get('/:token', fail);
		inviteRouter.use(noteRoute);
		universeRouter.use(fail);
		universeRouter.use(noteRoute);
		app.use('/invites', inviteRouter);
		app.use('/universes/:universeId/characters', universeRouter);
		app.get('/players', fail);
		app.use(noteRoute);

		server = http.createServer(app);
		await new Promise<void>((resolve) =>
		{
			server.listen(0, '127.0.0.1', resolve);
		});
		address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	after(async () =>
	{
		await new Promise((resolve) =>
		{
			server.close(resolve);
		});
	});

	beforeEach(() =>
	{
		routes = [];
	});

	/**
	 * Sends a request that fails, and gives the route its failure would be logged with
	 *
	 * @param path The path and query string
	 * @return The route
	 */
	async function failedRoute(path: string): Promise<string>
	{
		assert.strictEqual((await fetch(`${address}${path}`)).status, 500);
		assert.strictEqual(routes.length, 1);

		return(routes[0]);
	}

	it('gives the route\'s pattern, not the token in the path', async () =>
	{
		assert.strictEqual(await failedRoute('/invites/secret-token?from=chat'), '/invites/:token');
	});

	it('leaves out the query string', async () =>
	{
		assert.strictEqual(await failedRoute('/players?search=ada%40example.com'), '/players');
	});

	it('gives where the router is mounted for an error before any route matched', async () =>
	{
		assert.strictEqual(await failedRoute('/universes/0b6a/characters/secret-token?token=secret'), '/universes/0b6a/characters');
	});
});
