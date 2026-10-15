import { randomUUID } from 'crypto';
import { Client, type Room } from '@colyseus/sdk';
import { cli, type Options } from '@colyseus/loadtest';
import { LOBBY_ROOM_NAME, LobbyMessageType, LobbyServerMessageType, MessageType, type AccountPayload, type Direction, type LoginPayload, type MovePayload } from '@multiverse-kiln/shared';

import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';

const directions: Direction[] = [-1, 0, 1];

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
 * Runs one simulated player: logs in through the lobby, creates a group of its own and moves around in it
 *
 * Each player is a browser of its own, with a random browser ID cookie
 *
 * @param options Load test options from the command line
 */
export async function main(options: Options)
{
	const client = new Client(options.endpoint, { headers: { cookie: `${BROWSER_ID_COOKIE}=${randomUUID()}` } });
	const lobby: Room = await client.joinOrCreate(LOBBY_ROOM_NAME, {});
	let joinedGroupId: string | undefined;

	lobby.onMessage(LobbyServerMessageType.Account, (account: AccountPayload) =>
	{
		const groupId = account.player?.groupId;

		if (!account.player)
		{
			const login: LoginPayload = { name: `Bot ${lobby.sessionId}` };

			lobby.send(LobbyMessageType.Login, login);
		}
		else if (!groupId)
		{
			lobby.send(LobbyMessageType.CreateGroup);
		}
		else if (groupId !== joinedGroupId)
		{
			joinedGroupId = groupId;
			void playInGroup(client, groupId);
		}
	});

	lobby.onLeave((code: number) =>
	{
		console.log(lobby.sessionId, 'left the lobby', code);
	});
}

// Default the endpoint from LOADTEST_ENDPOINT (server/.env); an explicit --endpoint argument wins
if (process.env.LOADTEST_ENDPOINT && !process.argv.includes('--endpoint'))
{
	process.argv.push('--endpoint', process.env.LOADTEST_ENDPOINT);
}

cli(main);
