import { randomUUID } from 'crypto';
import { Client, type Room } from '@colyseus/sdk';
import { cli, type Options } from '@colyseus/loadtest';
import { LOBBY_ROOM_NAME, LobbyMessageType, MessageType, SESSION_ROOM_NAME, SessionMessageType, SessionServerMessageType, UNIVERSES_PATH, type AccountPayload, type Direction, type LobbyJoinOptions, type LoginPayload, type MovePayload, type UniverseListPayload } from '@multiverse-kiln/shared';

import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';

const directions: Direction[] = [-1, 0, 1];

/**
 * How long each simulated player walks around the lobby before creating a group
 */
const LOBBY_SECONDS = 5;

/**
 * Picks a random direction on each axis, like a player pressing arrow keys
 *
 * @return A random Move payload
 */
function randomMove(): MovePayload
{
	return({
		x: directions[Math.floor(Math.random() * directions.length)],
		y: directions[Math.floor(Math.random() * directions.length)]
	});
}

/**
 * Joins a group's room and changes direction every second
 *
 * @param client Client for the server
 * @param groupId The group's ID
 */
async function playInGroup(client: Client, groupId: string): Promise<void>
{
	const room: Room = await client.joinById(groupId, {});

	console.log(room.sessionId, 'joined group', groupId);

	const timer = setInterval(() =>
	{
		room.send(MessageType.Move, randomMove());
	}, 1000);

	room.onLeave((code: number) =>
	{
		clearInterval(timer);
		console.log(room.sessionId, 'left group', code);
	});
}

/**
 * Joins the first universe's lobby, walks around it for a few seconds, then creates a group of its own
 *
 * @param client Client for the server
 * @return The joined lobby, which the caller leaves once the group exists
 */
async function playInLobby(client: Client): Promise<Room>
{
	const response = await client.http.get(UNIVERSES_PATH);
	const universe = (response.data as UniverseListPayload).universes[0];

	if (!universe)
	{
		throw new Error('The server lists no universes. Run npm run db:seed -w server first');
	}

	const options: LobbyJoinOptions = { universeId: universe.id };
	const lobby: Room = await client.joinOrCreate(LOBBY_ROOM_NAME, options);
	const timer = setInterval(() =>
	{
		lobby.send(MessageType.Move, randomMove());
	}, 1000);

	console.log(lobby.sessionId, 'joined the lobby of', universe.name);

	setTimeout(() =>
	{
		clearInterval(timer);
		lobby.send(LobbyMessageType.CreateGroup);
	}, LOBBY_SECONDS * 1000);

	lobby.onLeave((code: number) =>
	{
		clearInterval(timer);
		console.log(lobby.sessionId, 'left the lobby', code);
	});

	return(lobby);
}

/**
 * Runs one simulated player: logs in through the session room, walks around a universe's lobby, then
 * creates a group of its own and moves around in it
 *
 * Each player is a browser of its own, with a random browser ID cookie
 *
 * @param options Load test options from the command line
 */
export async function main(options: Options)
{
	const client = new Client(options.endpoint, { headers: { cookie: `${BROWSER_ID_COOKIE}=${randomUUID()}` } });
	const session: Room = await client.joinOrCreate(SESSION_ROOM_NAME, {});
	let lobby: Promise<Room> | undefined;
	let joinedGroupId: string | undefined;

	session.onMessage(SessionServerMessageType.Account, (account: AccountPayload) =>
	{
		const groupId = account.player?.groupId;

		if (!account.player)
		{
			const login: LoginPayload = { name: `Bot ${session.sessionId}` };

			session.send(SessionMessageType.Login, login);
		}
		else if (!groupId && !lobby)
		{
			lobby = playInLobby(client);
		}
		else if (groupId && (groupId !== joinedGroupId))
		{
			joinedGroupId = groupId;
			void lobby?.then((room) => room.leave());
			void playInGroup(client, groupId);
		}
	});

	session.onLeave((code: number) =>
	{
		console.log(session.sessionId, 'left the session', code);
	});
}

// Default the endpoint from LOADTEST_ENDPOINT (server/.env); an explicit --endpoint argument wins
if (process.env.LOADTEST_ENDPOINT && !process.argv.includes('--endpoint'))
{
	process.argv.push('--endpoint', process.env.LOADTEST_ENDPOINT);
}

cli(main);
