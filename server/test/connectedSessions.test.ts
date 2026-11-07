import assert from 'assert';

import { ConnectedSessions } from '../src/players/connectedSessions.js';

describe('ConnectedSessions', () =>
{
	it('counts a session until its last window leaves', () =>
	{
		const sessions = new ConnectedSessions();
		const first = {};
		const second = {};

		sessions.connect(first, 's1');
		sessions.connect(second, 's1');
		sessions.connect({}, 's2');
		assert.deepStrictEqual(sessions.ids().sort(), ['s1', 's2']);

		sessions.disconnect(first);
		assert.deepStrictEqual(sessions.ids().sort(), ['s1', 's2']);

		sessions.disconnect(second);
		assert.deepStrictEqual(sessions.ids(), ['s2']);
	});

	it('uncounts only windows it counted, once each', () =>
	{
		const sessions = new ConnectedSessions();
		const counted = {};

		sessions.connect(counted, 's1');
		sessions.connect(counted, 's1');

		// A window turned away before it was counted leaves without uncounting the session's other window
		sessions.disconnect({});
		assert.deepStrictEqual(sessions.ids(), ['s1']);

		sessions.disconnect(counted);
		assert.deepStrictEqual(sessions.ids(), []);
		sessions.disconnect(counted);
		assert.deepStrictEqual(sessions.ids(), []);
	});

	it('tells listeners which sessions ended, and stops counting them', () =>
	{
		const sessions = new ConnectedSessions();
		const heard: string[][] = [];
		const ended = {};
		const stop = sessions.onEnd((sessionIds) =>
		{
			heard.push([...sessionIds].sort());
		});

		sessions.connect(ended, 's1');
		sessions.connect({}, 's2');
		sessions.end(['s1', 's3']);

		assert.deepStrictEqual(heard, [['s1', 's3']]);
		assert.deepStrictEqual(sessions.ids(), ['s2']);

		// A window of the ended session leaving later changes nothing
		sessions.disconnect(ended);
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
