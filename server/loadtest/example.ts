import { Client, type Room } from '@colyseus/sdk';
import { cli, type Options } from '@colyseus/loadtest';
import { MessageType, type Direction, type MovePayload } from '@multiverse-kiln/shared';

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
 * Runs one simulated client: joins the room and changes direction every second
 *
 * @param options Load test options from the command line
 */
export async function main(options: Options)
{
	const client = new Client(options.endpoint);
	const room: Room = await client.joinOrCreate(options.roomName, {});

	console.log(room.sessionId, 'joined');

	const timer = setInterval(() =>
	{
		room.send(MessageType.Move, randomMove());
	}, 1000);

	room.onLeave((code: number) =>
	{
		clearInterval(timer);
		console.log(room.sessionId, 'left', code);
	});
}

// Default the endpoint from LOADTEST_ENDPOINT (server/.env); an explicit --endpoint argument wins
if (process.env.LOADTEST_ENDPOINT && !process.argv.includes('--endpoint'))
{
	process.argv.push('--endpoint', process.env.LOADTEST_ENDPOINT);
}

cli(main);
