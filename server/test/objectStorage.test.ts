import assert from 'assert';
import { randomUUID } from 'crypto';

import { deleteObjects, getObject, putObject } from '../src/storage/objectStorage.js';

describe('Object storage', () =>
{
	it('deletes several files at once, passing over a key with nothing stored under it', async () =>
	{
		const prefix = `test-delete-objects/${randomUUID()}`;
		const stored = [`${prefix}/a.png`, `${prefix}/b.png`, `${prefix}/c.png`];
		const kept = `${prefix}/kept.png`;

		await Promise.all([...stored, kept].map((key) => putObject(key, Buffer.from('x'), 'image/png')));
		await deleteObjects([...stored, `${prefix}/missing.png`]);

		assert.deepStrictEqual(await Promise.all(stored.map((key) => getObject(key))), [undefined, undefined, undefined]);
		assert.deepStrictEqual(await getObject(kept), Buffer.from('x'));

		await deleteObjects([kept]);
	});
});
