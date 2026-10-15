import { Client, type Room } from '@colyseus/sdk';
import { GAME_ROOM_NAME, GameState } from '@multiverse-kiln/shared';

/**
 * A joined game room, with typed state
 */
export type GameRoom = Room<unknown, GameState>;

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
 * Connects to the server and joins (or creates) the game room
 *
 * Passing the shared GameState class lets the SDK decode state into typed instances
 *
 * @return The joined room
 */
export async function joinGameRoom(): Promise<GameRoom>
{
	const client = new Client(getServerUrl());

	return(await client.joinOrCreate(GAME_ROOM_NAME, {}, GameState));
}
