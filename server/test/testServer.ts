import { ColyseusTestServer } from '@colyseus/testing';

import appConfig from '../src/app.config.js';
import { reviewSlot } from './reviewSlot.js';
import { registerTestServer } from './testServerHooks.js';
import { MAX_TEST_WORKERS, testWorker } from './testWorker.js';

/**
 * The test server's port: 2568, the port @colyseus/testing uses, when the tests run in one process,
 * the ports after it for parallel workers, so each worker's server has a port of its own, and the ports
 * after the workers' for review slots (2577 to 2580)
 */
const testServerPort = ((reviewSlot > 0) ? (2568 + MAX_TEST_WORKERS + reviewSlot) : (2568 + testWorker));

/**
 * Base URL of the test server for plain HTTP requests
 */
export const testServerUrl = `http://localhost:${testServerPort}`;

let testServer: ColyseusTestServer<typeof appConfig> | undefined;

/**
 * Returns the shared test server, booting it on first use
 *
 * The app's Server instance can only be bound once, so every test file a process runs shares one
 * server instead of booting its own
 *
 * @return Running test server
 */
export async function getTestServer(): Promise<ColyseusTestServer<typeof appConfig>>
{
	if (!testServer)
	{
		// What @colyseus/testing's boot() does with a Server instance, on this process's own port: boot()
		// always listens on 2568 when given one
		await appConfig.listen(testServerPort);

		const server = new ColyseusTestServer<typeof appConfig>(appConfig);

		testServer = server;
		registerTestServer({
			closeRooms: () => server.cleanup(),
			shutDown: () => server.shutdown()
		});
	}

	return(testServer);
}
