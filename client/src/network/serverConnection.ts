import { Client, type Room } from '@colyseus/sdk';
import { BROWSER_ID_PATH, GameState, LOBBY_ROOM_NAME, LobbyState, ServerMessageType, SESSION_ROOM_NAME, UNIVERSES_PATH, type LobbyJoinOptions, type UniverseDetails, type UniverseListPayload, type WelcomePayload, type ZonePayload } from '@multiverse-kiln/shared';

/**
 * How many universes Home asks for at a time
 */
const UNIVERSES_PER_PAGE = 20;

/**
 * A joined game room, with typed state
 */
export type GameRoom = Room<unknown, GameState>;

/**
 * A joined universe lobby, with typed state
 */
export type LobbyRoom = Room<unknown, LobbyState>;

/**
 * A joined room with a map: a universe's lobby or a group's game room
 */
export type MapRoom = GameRoom | LobbyRoom;

/**
 * A joined room with a map, the player this window controls in it, and the zone the player started in
 */
export interface MapConnection<R extends MapRoom>
{
	room: R;

	/**
	 * Key of this window's player in the room's state.players, shared by every window of this browser
	 */
	playerId: string;

	/**
	 * The zone the player was in on joining; later zones arrive as ServerMessageType.Zone
	 */
	zone: ZonePayload;
}

/**
 * A joined game room and the player this window controls
 */
export type GameConnection = MapConnection<GameRoom>;

/**
 * A joined universe lobby and the player this window controls
 */
export type LobbyConnection = MapConnection<LobbyRoom>;

/**
 * The connection to the server, and the session room it has joined
 */
export interface ServerConnection
{
	client: Client;
	session: Room;
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
 * Resolves with the player ID from a room's Welcome message and the zone from its first Zone message
 *
 * The server sends both right after the join, so this must be called as soon as the room is joined
 *
 * @param room The joined room
 * @return The player this window controls, and their zone
 */
function waitForArrival(room: MapRoom): Promise<{ playerId: string; zone: ZonePayload }>
{
	const welcome = new Promise<string>((resolve) =>
	{
		room.onMessage(ServerMessageType.Welcome, (payload: WelcomePayload) =>
		{
			resolve(payload.playerId);
		});
	});
	const zone = new Promise<ZonePayload>((resolve) =>
	{
		const stopListening = room.onMessage(ServerMessageType.Zone, (payload: ZonePayload) =>
		{
			stopListening();
			resolve(payload);
		});
	});
	const left = new Promise<never>((_resolve, reject) =>
	{
		room.onLeave((code: number) =>
		{
			reject(new Error(`Left the room (code ${code}) before it said which player is ours`));
		});
	});

	return(Promise.race([
		Promise
			.all([welcome, zone])
			.then(([playerId, firstZone]) => ({ playerId, zone: firstZone })),
		left
	]));
}

/**
 * Connects to the server and joins the session room
 *
 * First asks the server for a browser ID cookie, which the browser then sends when joining a room:
 * every window of this browser sends the same cookie, so they are all the same player. The server
 * turns away windows without one
 *
 * @return The client and the joined session room
 */
export async function connectToServer(): Promise<ServerConnection>
{
	const client = new Client(getServerUrl());

	await client.http.post(BROWSER_ID_PATH);

	const session = await client.joinOrCreate(SESSION_ROOM_NAME);

	return({ client, session });
}

/**
 * A page of the universes Home lists
 *
 * @param client Client for the server
 * @param offset How many universes to skip
 * @return The page
 */
export async function listUniverses(client: Client, offset: number): Promise<UniverseListPayload>
{
	const response = await client.http.get(`${UNIVERSES_PATH}?offset=${offset}&limit=${UNIVERSES_PER_PAGE}`);

	return(response.data as UniverseListPayload);
}

/**
 * One of the universes Home lists, in full
 *
 * @param client Client for the server
 * @param universeId The universe's ID
 * @return The universe
 */
export async function getUniverseDetails(client: Client, universeId: string): Promise<UniverseDetails>
{
	const response = await client.http.get(`${UNIVERSES_PATH}/${encodeURIComponent(universeId)}`);

	return(response.data as UniverseDetails);
}

/**
 * Joins a universe's lobby; the browser must already be logged in
 *
 * @param client Client for the server
 * @param universeId The universe's ID
 * @return The joined lobby, this window's player and their zone
 */
export async function joinLobby(client: Client, universeId: string): Promise<LobbyConnection>
{
	const options: LobbyJoinOptions = { universeId };
	const room = await client.joinOrCreate<LobbyState>(LOBBY_ROOM_NAME, options, LobbyState);

	return({ room, ...(await waitForArrival(room)) });
}

/**
 * Joins a group's game room; the session must already have put this browser's player in the group
 *
 * Passing the shared GameState class lets the SDK decode state into typed instances
 *
 * @param client Client for the server
 * @param groupId The group's ID (its game room's ID)
 * @return The joined room, this window's player and their zone
 */
export async function joinGroup(client: Client, groupId: string): Promise<GameConnection>
{
	const room = await client.joinById<GameState>(groupId, {}, GameState);

	return({ room, ...(await waitForArrival(room)) });
}
