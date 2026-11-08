/**
 * What setup.ts's root hooks do to the shared test server, once a test has booted it. testServer.ts
 * registers them as it boots, so a run that never boots the server never loads it
 */
export interface TestServerHooks
{
	/**
	 * Closes every room, waiting for each to write what it keeps (such as its chat) as it closes
	 */
	closeRooms(): Promise<void>;

	/**
	 * Shuts the server down
	 */
	shutDown(): Promise<void>;
}

let hooks: TestServerHooks | undefined;

/**
 * Registers the booted test server's hooks
 *
 * @param registered The hooks
 */
export function registerTestServer(registered: TestServerHooks): void
{
	hooks = registered;
}

/**
 * The booted test server's hooks
 *
 * @return The hooks, or undefined when no test has booted the server
 */
export function testServerHooks(): TestServerHooks | undefined
{
	return(hooks);
}
