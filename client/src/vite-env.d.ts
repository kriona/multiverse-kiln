/**
 * Types for the client's environment variables (client/.env; see .env.example)
 */
interface ImportMetaEnv
{
	/**
	 * WebSocket URL of the Colyseus server
	 */
	readonly VITE_SERVER_URL?: string;

	/**
	 * Where players can get the game's source code (AGPL section 13)
	 */
	readonly VITE_SOURCE_URL?: string;
}
