import { Client, type Room } from '@colyseus/sdk';
import { BROWSER_ID_PATH, GAME_ROOM_NAME, GameState, ServerMessageType, type WelcomePayload } from '@multiverse-kiln/shared';

/**
 * A joined game room, with typed state
 */
export type GameRoom = Room<unknown, GameState>;

/**
 * A joined game room and the player this window controls
 */
export interface GameConnection
{
	room: GameRoom;

	/**
	 * Key of this window's player in the room's state.players, shared by every window of this browser
	 */
	playerId: string;
}

/**
 * Reads the server URL from VITE_SERVER_URL
 *
 * @return The server's WebSocket URL
 */
function getServerUrl(): string
{
	const url = import.meta.env.VITE_SERVER_URL;

	if (!url)
	{
		throw new Error('VITE_SERVER_URL is not set. See client/.env.example');
	}

	return(url);
}

/**
 * Asks the server for a browser ID cookie, which the browser then sends when joining a room
 *
 * Every window of this browser sends the same cookie, so they all control the same player. If the
 * request fails the window can still join, as a player of its own
 *
 * @param client Client for the server
 */
async function requestBrowserId(client: Client): Promise<void>
{
	try
	{
		await client.http.post(BROWSER_ID_PATH);
	}
	catch (error)
	{
		console.warn('Could not get a browser ID; this window will join as a separate player:', error);
	}
}

/**
 * Resolves with the player ID from the room's Welcome message
 *
 * The server sends it right after the join, so this must be called as soon as the room is joined
 *
 * @param room The joined room
 * @return The player this window controls
 */
function waitForWelcome(room: GameRoom): Promise<string>
{
	return(new Promise((resolve, reject) =>
	{
		room.onMessage(ServerMessageType.Welcome, (payload: WelcomePayload) =>
		{
			resolve(payload.playerId);
		});

		room.onLeave((code: number) =>
		{
			reject(new Error(`Left the room (code ${code}) before it said which player is ours`));
		});
	}));
}

/**
 * Connects to the server and joins (or creates) the game room
 *
 * Passing the shared GameState class lets the SDK decode state into typed instances
 *
 * @return The joined room and this window's player
 */
export async function joinGameRoom(): Promise<GameConnection>
{
	const client = new Client(getServerUrl());

	await requestBrowserId(client);

	const room = await client.joinOrCreate<GameState>(GAME_ROOM_NAME, {}, GameState);
	const playerId = await waitForWelcome(room);

	return({ room, playerId });
}
