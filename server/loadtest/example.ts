import { Client, type Room } from '@colyseus/sdk';
import { cli, type Options } from '@colyseus/loadtest';

export async function main(options: Options)
{
	const client = new Client(options.endpoint);
	const room: Room = await client.joinOrCreate(options.roomName, {
		// your join options here...
	});

	console.log('joined successfully!');

	room.onMessage('message-type', (_payload: unknown) =>
	{
		// logic
	});

	room.onStateChange((state: unknown) =>
	{
		console.log('state change:', state);
	});

	room.onLeave((_code: number) =>
	{
		console.log('left');
	});
}

// Default the endpoint from LOADTEST_ENDPOINT (server/.env); an explicit --endpoint argument wins
if (process.env.LOADTEST_ENDPOINT && !process.argv.includes('--endpoint'))
{
	process.argv.push('--endpoint', process.env.LOADTEST_ENDPOINT);
}

cli(main);
