import assert from 'assert';

import { ConnectedSessions } from '../src/players/connectedSessions.js';

describe('ConnectedSessions', () =>
{
	it('counts a session until its last window leaves', () =>
	{
		const sessions = new ConnectedSessions();

		sessions.connect('s1');
		sessions.connect('s1');
		sessions.connect('s2');
		assert.deepStrictEqual(sessions.ids().sort(), ['s1', 's2']);

		sessions.disconnect('s1');
		assert.deepStrictEqual(sessions.ids().sort(), ['s1', 's2']);

		sessions.disconnect('s1');
		assert.deepStrictEqual(sessions.ids(), ['s2']);
	});

	it('tells listeners which sessions ended, and stops counting them', () =>
	{
		const sessions = new ConnectedSessions();
		const heard: string[][] = [];
		const stop = sessions.onEnd((ended) =>
		{
			heard.push([...ended].sort());
		});

		sessions.connect('s1');
		sessions.connect('s2');
		sessions.end(['s1', 's3']);

		assert.deepStrictEqual(heard, [['s1', 's3']]);
		assert.deepStrictEqual(sessions.ids(), ['s2']);

		// A window of the ended session leaving later changes nothing
		sessions.disconnect('s1');
		assert.deepStrictEqual(sessions.ids(), ['s2']);

		stop();
		sessions.end(['s2']);
		assert.strictEqual(heard.length, 1);
	});

	it('tells nobody when no sessions ended', () =>
	{
		const sessions = new ConnectedSessions();
		let calls = 0;

		sessions.onEnd(() =>
		{
			calls++;
		});
		sessions.end([]);

		assert.strictEqual(calls, 0);
	});
});
