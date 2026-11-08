import assert from 'assert';

import { OneRoomPerKey } from '../src/rooms/oneRoomPerKey.js';

describe('OneRoomPerKey', () =>
{
	it('refuses a second room for a key', () =>
	{
		const rooms = new OneRoomPerKey<object>('group');

		rooms.claim('a', {});

		assert.throws(() => rooms.claim('a', {}), /The group a already has a room/);
	});

	it('keeps each key separately', () =>
	{
		const rooms = new OneRoomPerKey<object>('group');

		rooms.claim('a', {});
		rooms.claim('b', {});
	});

	it('allows a room for the key once the first is released', () =>
	{
		const rooms = new OneRoomPerKey<object>('group');
		const first = {};

		rooms.claim('a', first);
		rooms.release(first);
		rooms.claim('a', {});
	});

	it('keeps the key when a refused room is released', () =>
	{
		const rooms = new OneRoomPerKey<object>('group');
		const refused = {};

		rooms.claim('a', {});
		assert.throws(() => rooms.claim('a', refused));
		rooms.release(refused);

		assert.throws(() => rooms.claim('a', {}));
	});

	it('ignores releasing a room that never claimed a key', () =>
	{
		const rooms = new OneRoomPerKey<object>('group');

		rooms.release({});
		rooms.claim('a', {});
	});
});
