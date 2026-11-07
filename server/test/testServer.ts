import { type ColyseusTestServer, boot } from '@colyseus/testing';

import appConfig from '../src/app.config.js';
import { registerTestServer } from './testServerHooks.js';

/**
 * Base URL of the test server for plain HTTP requests (the port @colyseus/testing's boot() uses)
 */
export const testServerUrl = 'http://localhost:2568';

let testServer: ColyseusTestServer<typeof appConfig> | undefined;

/**
 * Returns the shared test server, booting it on first use
 *
 * The app's Server instance can only be bound once, so every test file shares one server
 * instead of booting its own
 *
 * @return Running test server
 */
export async function getTestServer(): Promise<ColyseusTestServer<typeof appConfig>>
{
	if (!testServer)
	{
		// boot() returns ColyseusTestServer<any> when given a Server instance
		const server = (await boot(appConfig)) as ColyseusTestServer<typeof appConfig>;

		testServer = server;
		registerTestServer({
			closeRooms: () => server.cleanup(),
			shutDown: () => server.shutdown()
		});
	}

	return(testServer);
}
