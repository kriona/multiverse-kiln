import assert from 'assert';
import { DORMANT_LOGIN_DAYS } from '@multiverse-kiln/shared';

import { needsLoginEmailCode } from '../../src/logic/dormantLogins.js';

const DAY_MS = (24 * 60 * 60 * 1000);
const CREATED = new Date('2026-01-01T00:00:00Z');

/**
 * A time after CREATED
 *
 * @param ms How many milliseconds after
 * @return The time
 */
function after(ms: number): Date
{
	return(new Date(CREATED.getTime() + ms));
}

describe('dormantLogins', () =>
{
	it('asks for a code once an account without 2FA hasn\'t logged in for DORMANT_LOGIN_DAYS', () =>
	{
		const account = {
			lastLoginAt: after(DAY_MS),
			createdAt: CREATED,
			hasTwoFactor: false
		};

		assert.strictEqual(needsLoginEmailCode(account, after((DORMANT_LOGIN_DAYS + 1) * DAY_MS - 1)), false);
		assert.strictEqual(needsLoginEmailCode(account, after((DORMANT_LOGIN_DAYS + 1) * DAY_MS)), true);
	});

	it('never asks an account with 2FA', () =>
	{
		const account = {
			lastLoginAt: CREATED,
			createdAt: CREATED,
			hasTwoFactor: true
		};

		assert.strictEqual(needsLoginEmailCode(account, after(10 * DORMANT_LOGIN_DAYS * DAY_MS)), false);
	});

	it('counts an account that never logged in from when it was made', () =>
	{
		const account = {
			lastLoginAt: null,
			createdAt: CREATED,
			hasTwoFactor: false
		};

		assert.strictEqual(needsLoginEmailCode(account, after(DAY_MS)), false);
		assert.strictEqual(needsLoginEmailCode(account, after(DORMANT_LOGIN_DAYS * DAY_MS)), true);
	});
});
