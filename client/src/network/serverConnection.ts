import { Client, type Room } from '@colyseus/sdk';
import { BROWSER_ID_PATH, GameState, LOBBY_ROOM_NAME, LobbyState, ServerMessageType, type WelcomePayload } from '@multiverse-kiln/shared';

/**
 * A joined game room, with typed state
 */
export type GameRoom = Room<unknown, GameState>;

/**
 * The joined lobby room, with typed state
 */
export type LobbyRoom = Room<unknown, LobbyState>;

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
 * The connection to the server, and the lobby it has joined
 */
export interface ServerConnection
{
	client: Client;
	lobby: LobbyRoom;
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
 * Connects to the server and joins the lobby
 *
 * First asks the server for a browser ID cookie, which the browser then sends when joining a room:
 * every window of this browser sends the same cookie, so they are all the same player. The server
 * turns away windows without one
 *
 * @return The client and the joined lobby
 */
export async function connectToServer(): Promise<ServerConnection>
{
	const client = new Client(getServerUrl());

	await client.http.post(BROWSER_ID_PATH);

	const lobby = await client.joinOrCreate<LobbyState>(LOBBY_ROOM_NAME, {}, LobbyState);

	return({ client, lobby });
}

/**
 * Joins a group's game room; the lobby must already have put this browser's player in the group
 *
 * Passing the shared GameState class lets the SDK decode state into typed instances
 *
 * @param client Client for the server
 * @param groupId The group's ID (its game room's ID)
 * @return The joined room and this window's player
 */
export async function joinGroup(client: Client, groupId: string): Promise<GameConnection>
{
	const room = await client.joinById<GameState>(groupId, {}, GameState);
	const playerId = await waitForWelcome(room);

	return({ room, playerId });
}
