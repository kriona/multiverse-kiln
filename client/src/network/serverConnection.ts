import { Client, type Room } from '@colyseus/sdk';
import { EDITOR_ROOM_NAME, EditorState, GAME_ROOM_NAME, GameState, LOBBY_ROOM_NAME, LobbyState, ServerMessageType, SESSION_ROOM_NAME, SessionServerMessageType, UNIVERSES_PATH, type AccountPayload, type EditorJoinOptions, type GameJoinOptions, type LobbyJoinOptions, type UniverseDetails, type UniverseListPayload, type UniverseTextPayload, type WelcomePayload, type AreaPayload } from '@multiverse-kiln/shared';

import { wantedLanguages } from '../localization';
import { leaveOnPageHide } from '../pageLifecycle';
import { forgetPlayerValues, rememberPlayerSession } from '../rememberedValues';

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
 * A joined universe editor room, with typed state
 */
export type EditorRoom = Room<unknown, EditorState>;

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
 * A joined universe lobby and the player this window controls. The lobby has a map only while its
 * universe has an enabled lobby area (LobbyState.hasMap): area is undefined when it had none on joining,
 * and the area arrives as ServerMessageType.Area once it has one
 */
export interface LobbyConnection extends Omit<MapConnection<LobbyRoom>, 'area'>
{
	area: AreaPayload | undefined;
}

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
 * A client for the server. Its requests name the languages the player wants in Accept-Language, which
 * the server shows universe text in when the player's profile names none
 *
 * @return The client
 */
export function createClient(): Client
{
	const client = new Client(getServerUrl());

	client.http.options.headers = { 'Accept-Language': wantedLanguages().join(', ') };

	return(client);
}

/**
 * The text a universe's rooms leave to the client to look up by ID, in the player's language. The
 * browser keeps it, and the server answers 304 while it hasn't changed, so asking again after
 * ServerMessageType.UniverseText is cheap
 *
 * @param client Client for the server
 * @param universeId The universe's ID
 * @return The text
 */
export async function getUniverseText(client: Client, universeId: string): Promise<UniverseTextPayload>
{
	const response = await client.http.get(`${UNIVERSES_PATH}/${encodeURIComponent(universeId)}/text`);

	return(response.data as UniverseTextPayload);
}

/**
 * Resolves with the player ID from a room's Welcome message and the area from its first Area message
 *
 * The server sends both right after the join, so this must be called as soon as the room is joined
 *
 * @param room The joined room
 * @return The player this window controls, and their area
 */
function waitForArrival(room: MapRoom): Promise<{ playerId: string; area: AreaPayload }>;

/**
 * Resolves with the player ID from a room's Welcome message and, when the room has a map, the area from
 * its first Area message, as in a lobby that may have no map
 *
 * @param room The joined room
 * @param hasMap Whether the room has a map once Welcome has arrived, so an Area message follows
 * @return The player this window controls, and their area, or undefined without a map
 */
function waitForArrival(room: MapRoom, hasMap: () => boolean): Promise<{ playerId: string; area: AreaPayload | undefined }>;

/**
 * Resolves with the player ID from a room's Welcome message and the area from its first Area message,
 * when the room has a map
 *
 * @param room The joined room
 * @param hasMap Whether the room has a map once Welcome has arrived; always, for a group's room
 * @return The player this window controls, and their area
 */
function waitForArrival(room: MapRoom, hasMap: () => boolean = () => true): Promise<{ playerId: string; area: AreaPayload | undefined }>
{
	let stopListening: (() => void) | undefined;
	const welcome = new Promise<string>((resolve) =>
	{
		room.onMessage(ServerMessageType.Welcome, (payload: WelcomePayload) =>
		{
			resolve(payload.playerId);
		});
	});
	const area = new Promise<AreaPayload>((resolve) =>
	{
		stopListening = room.onMessage(ServerMessageType.Area, (payload: AreaPayload) =>
		{
			stopListening?.();
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
		welcome.then(async (playerId) =>
		{
			if (!hasMap())
			{
				stopListening?.();
				return({ playerId, area: undefined });
			}

			return({ playerId, area: await area });
		}),
		left
	]));
}

/**
 * Readies a room just joined: it is left as the page is left, and it leaves as soon as its connection
 * drops. No room on the server holds a dropped window's place, so the SDK's attempts to reconnect can't
 * succeed, and while they ran the room would look joined, holding what the page sends to it until they
 * gave up and threw it away
 *
 * @param room The room, just joined
 */
function readyJoinedRoom(room: Parameters<typeof leaveOnPageHide>[0] & { reconnection: { enabled: boolean } }): void
{
	room.reconnection.enabled = false;
	leaveOnPageHide(room);
}

/**
 * Connects to the server and joins the session room, which says whether the browser is logged in
 *
 * The browser sends its session cookie, if it has one, when joining a room: every window of this
 * browser sends the same cookie, so they are all the same player. The session room admits windows
 * that aren't logged in too. Whatever the browser remembers for the player (rememberedValues.ts) is
 * kept as long as the session room says the session lasts, and forgotten once it says the browser isn't
 * logged in. Every room joined here is left as the page is left (leaveOnPageHide in pageLifecycle.ts), and
 * leaves as soon as its connection drops (readyJoinedRoom)
 *
 * @return The client and the joined session room
 */
export async function connectToServer(): Promise<ServerConnection>
{
	const client = createClient();
	const session = await client.joinOrCreate(SESSION_ROOM_NAME);

	readyJoinedRoom(session);

	session.onMessage(SessionServerMessageType.Account, (account: AccountPayload) =>
	{
		if (account.player)
		{
			rememberPlayerSession(account.player.playerId, account.player.sessionExpiresInMs);
		}
		else
		{
			forgetPlayerValues();
		}
	});

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

	readyJoinedRoom(room);

	// The room sends its state before Welcome, so hasMap is known by then
	return({ room, ...(await waitForArrival(room, () => room.state.hasMap)) });
}

/**
 * Joins a universe's editor room, which says who has its editor open and carries the editors' chat; the
 * browser must be logged in as a player who may open the universe's editor
 *
 * @param client Client for the server
 * @param universeId The universe's ID
 * @return The joined room
 */
export async function joinEditorRoom(client: Client, universeId: string): Promise<EditorRoom>
{
	const options: EditorJoinOptions = { universeId };
	const room = await client.joinOrCreate<EditorState>(EDITOR_ROOM_NAME, options, EditorState);

	readyJoinedRoom(room);

	return(room);
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

	readyJoinedRoom(room);

	return({ room, ...(await waitForArrival(room)) });
}
