import { Client, type Room } from '@colyseus/sdk';
import { cli, type Options } from '@colyseus/loadtest';
import { LOBBY_ROOM_NAME, MessageType, SESSION_ROOM_NAME, UNIVERSES_PATH, type Direction, type LobbyJoinOptions, type MovePayload, type UniverseListPayload } from '@multiverse-kiln/shared';

import { SESSION_COOKIE } from '../src/http/cookies.js';
import { DEV_BOT_LOGIN_PATH, type BotLoginPayload } from '../src/http/devLogin.js';

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
 * Joins the first universe's lobby and changes direction every second
 *
 * Bots have no characters, so they walk the lobby as ghosts: groups need a character to play
 *
 * @param client Client for the server
 */
async function playInLobby(client: Client): Promise<void>
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

	lobby.onLeave((code: number) =>
	{
		clearInterval(timer);
		console.log(lobby.sessionId, 'left the lobby', code);
	});
}

/**
 * Runs one simulated player: logs in as a new bot account, joins the session room like a page does,
 * then walks around a universe's lobby
 *
 * Bots log in through the dev tools' bot login, since they can't read email, so the server must have
 * ENABLE_DEV_TOOLS=true. Each bot is an account and a browser of its own
 *
 * @param options Load test options from the command line
 */
export async function main(options: Options)
{
	const login = await new Client(options.endpoint).http.post(DEV_BOT_LOGIN_PATH);
	const { token } = login.data as BotLoginPayload;
	const client = new Client(options.endpoint, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
	const session: Room = await client.joinOrCreate(SESSION_ROOM_NAME, {});

	session.onLeave((code: number) =>
	{
		console.log(session.sessionId, 'left the session', code);
	});

	await playInLobby(client);
}

// Default the endpoint from LOADTEST_ENDPOINT (server/.env); an explicit --endpoint argument wins
if (process.env.LOADTEST_ENDPOINT && !process.argv.includes('--endpoint'))
{
	process.argv.push('--endpoint', process.env.LOADTEST_ENDPOINT);
}

cli(main);
