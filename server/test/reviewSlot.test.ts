import assert from 'assert';

import { MAX_REVIEW_SLOTS, readReviewSlot } from './reviewSlot.js';
import { reviewDatabaseUrl } from './testDatabase.js';

describe('review slots', () =>
{
	it('has no slot when TEST_REVIEW_SLOT is unset or empty', () =>
	{
		assert.strictEqual(readReviewSlot(undefined, undefined), 0);
		assert.strictEqual(readReviewSlot('', undefined), 0);
		assert.strictEqual(readReviewSlot(undefined, '3'), 0);
	});

	it('reads each slot there is', () =>
	{
		for (let slot = 1; slot <= MAX_REVIEW_SLOTS; slot++)
		{
			assert.strictEqual(readReviewSlot(String(slot), undefined), slot);
		}
	});

	it('refuses a slot that has no database', () =>
	{
		for (const value of ['0', String(MAX_REVIEW_SLOTS + 1), '1.5', '-1', 'one'])
		{
			assert.throws(() => readReviewSlot(value, undefined), /TEST_REVIEW_SLOT/, value);
		}
	});

	it('refuses a slot in a parallel worker, since the workers would share its database', () =>
	{
		assert.throws(() => readReviewSlot('1', '0'), /--parallel/);
	});

	it('names each slot\'s database after the test database', () =>
	{
		assert.strictEqual(reviewDatabaseUrl('postgres://kiln_app:secret@127.0.0.1:5432/kiln_test', 2), 'postgres://kiln_app:secret@127.0.0.1:5432/kiln_review_2_test');
		assert.strictEqual(reviewDatabaseUrl('postgres://kiln_migrator:secret@localhost:5432/other_test?sslmode=disable', 4), 'postgres://kiln_migrator:secret@localhost:5432/other_review_4_test?sslmode=disable');
	});
});
