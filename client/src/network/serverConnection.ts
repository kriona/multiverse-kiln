import { Client, type Room } from '@colyseus/sdk';
import { BROWSER_ID_PATH, GAME_ROOM_NAME, GameState, LOBBY_ROOM_NAME, LobbyState, ServerMessageType, SESSION_ROOM_NAME, UNIVERSES_PATH, type GameJoinOptions, type LobbyJoinOptions, type UniverseDetails, type UniverseListPayload, type WelcomePayload, type AreaPayload } from '@multiverse-kiln/shared';

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
 * A joined room with a map, the player this window controls in it, and the area the player started in
 */
export interface MapConnection<R extends MapRoom>
{
	room: R;

	/**
	 * Key of this window's player in the room's state.players: in a lobby the player's ID, shared by every
	 * window of this browser; in a group's room the character the window controls
	 */
	playerId: string;

	/**
	 * The area the player was in on joining; later areas arrive as ServerMessageType.Area
	 */
	area: AreaPayload;
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
 * The address of one of the server's HTTP routes, for loading from it directly, such as an uploaded tile graphic
 *
 * @param path The route's path, starting with /
 * @return The address, on the server VITE_SERVER_URL names
 */
export function serverHttpUrl(path: string): string
{
	// wss://host:port becomes https://host:port, and ws:// http://
	return(`${getServerUrl().replace(/^ws/, 'http').replace(/\/$/, '')}${path}`);
}

/**
 * A client for the server, for a page that only uses its HTTP routes
 *
 * @return The client
 */
export function createClient(): Client
{
	return(new Client(getServerUrl()));
}

/**
 * Resolves with the player ID from a room's Welcome message and the area from its first Area message
 *
 * The server sends both right after the join, so this must be called as soon as the room is joined
 *
 * @param room The joined room
 * @return The player this window controls, and their area
 */
function waitForArrival(room: MapRoom): Promise<{ playerId: string; area: AreaPayload }>
{
	const welcome = new Promise<string>((resolve) =>
	{
		room.onMessage(ServerMessageType.Welcome, (payload: WelcomePayload) =>
		{
			resolve(payload.playerId);
		});
	});
	const area = new Promise<AreaPayload>((resolve) =>
	{
		const stopListening = room.onMessage(ServerMessageType.Area, (payload: AreaPayload) =>
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
			.all([welcome, area])
			.then(([playerId, firstArea]) => ({ playerId, area: firstArea })),
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
	const client = createClient();

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
 * @param key The universe's ID or slug
 * @return The universe
 */
export async function getUniverseDetails(client: Client, key: string): Promise<UniverseDetails>
{
	const response = await client.http.get(`${UNIVERSES_PATH}/${encodeURIComponent(key)}`);

	return(response.data as UniverseDetails);
}

/**
 * Joins a universe's lobby; the browser must already be logged in
 *
 * @param client Client for the server
 * @param universeId The universe's ID
 * @return The joined lobby, this window's player and their area
 */
export async function joinLobby(client: Client, universeId: string): Promise<LobbyConnection>
{
	const options: LobbyJoinOptions = { universeId };
	const room = await client.joinOrCreate<LobbyState>(LOBBY_ROOM_NAME, options, LobbyState);

	return({ room, ...(await waitForArrival(room)) });
}

/**
 * Joins a group's game room to play one of the player's characters in it; the server makes the room
 * from the database when nobody is playing the group
 *
 * Passing the shared GameState class lets the SDK decode state into typed instances
 *
 * @param client Client for the server
 * @param groupId The group's ID
 * @param characterId The character to play: one of the player's characters in the group
 * @return The joined room, the character this window controls and their area
 */
export async function joinGroup(client: Client, groupId: string, characterId: string): Promise<GameConnection>
{
	const options: GameJoinOptions = { groupId, characterId };
	const room = await client.joinOrCreate<GameState>(GAME_ROOM_NAME, options, GameState);
	return({ room, ...(await waitForArrival(room)) });
}
