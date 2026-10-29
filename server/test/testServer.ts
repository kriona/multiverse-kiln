import { type ColyseusTestServer, boot } from '@colyseus/testing';

import appConfig from '../src/app.config.js';

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
	// boot() returns ColyseusTestServer<any> when given a Server instance
	testServer ??= (await boot(appConfig)) as ColyseusTestServer<typeof appConfig>;

	return(testServer);
}

// Root-level hook: registered once (this module is only evaluated once) and runs after all tests
after(async () =>
{
	await testServer?.shutdown();
});
