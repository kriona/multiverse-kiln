import assert from 'assert';

import { ChangesWhileCreating } from '../src/rooms/changesWhileCreating.js';

describe('ChangesWhileCreating', () =>
{
	it('holds changes until the room is created, then applies them in order', () =>
	{
		const changes = new ChangesWhileCreating();
		const applied: string[] = [];

		changes.apply(() => applied.push('first'));
		changes.apply(() => applied.push('second'));
		assert.deepStrictEqual(applied, []);

		changes.created();
		assert.deepStrictEqual(applied, ['first', 'second']);
	});

	it('applies changes at once after the room is created', () =>
	{
		const changes = new ChangesWhileCreating();
		const applied: string[] = [];

		changes.created();
		changes.apply(() => applied.push('later'));
		assert.deepStrictEqual(applied, ['later']);
	});

	it('applies a change heard while those held are applied after them', () =>
	{
		const changes = new ChangesWhileCreating();
		const applied: string[] = [];

		changes.apply(() =>
		{
			applied.push('first');
			changes.apply(() => applied.push('heard meanwhile'));
		});
		changes.apply(() => applied.push('second'));
		changes.created();

		assert.deepStrictEqual(applied, ['first', 'second', 'heard meanwhile']);
	});
});
