import assert from 'assert';

import { isSessionExpired, SESSION_TOUCH_INTERVAL_MS, sessionExpiresAt, shouldTouchSession } from '../../src/logic/sessionLifetimes.js';

const HOUR_MS = (60 * 60 * 1000);
const DAY_MS = (24 * HOUR_MS);
const CREATED = new Date('2026-10-01T00:00:00Z');

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

describe('sessionLifetimes', () =>
{
	describe('without Remember me', () =>
	{
		it('ends after an hour without use', () =>
		{
			const session = {
				createdAt: CREATED,
				lastUsedAt: after(HOUR_MS),
				rememberMe: false
			};

			assert.deepStrictEqual(sessionExpiresAt(session), after(2 * HOUR_MS));
			assert.strictEqual(isSessionExpired(session, after((2 * HOUR_MS) - 1)), false);
			assert.strictEqual(isSessionExpired(session, after(2 * HOUR_MS)), true);
		});

		it('ends after 24 hours however much it is used', () =>
		{
			const session = {
				createdAt: CREATED,
				lastUsedAt: after(DAY_MS - 1000),
				rememberMe: false
			};

			assert.deepStrictEqual(sessionExpiresAt(session), after(DAY_MS));
			assert.strictEqual(isSessionExpired(session, after(DAY_MS)), true);
		});
	});

	describe('with Remember me', () =>
	{
		it('ends after 30 days without use', () =>
		{
			const session = {
				createdAt: CREATED,
				lastUsedAt: after(DAY_MS),
				rememberMe: true
			};

			assert.deepStrictEqual(sessionExpiresAt(session), after(31 * DAY_MS));
		});

		it('ends after 90 days however much it is used', () =>
		{
			const session = {
				createdAt: CREATED,
				lastUsedAt: after(89 * DAY_MS),
				rememberMe: true
			};

			assert.deepStrictEqual(sessionExpiresAt(session), after(90 * DAY_MS));
		});
	});

	describe('shouldTouchSession', () =>
	{
		it('records a use only once the last one is old enough', () =>
		{
			const session = {
				createdAt: CREATED,
				lastUsedAt: CREATED,
				rememberMe: false
			};

			assert.strictEqual(shouldTouchSession(session, after(SESSION_TOUCH_INTERVAL_MS - 1)), false);
			assert.strictEqual(shouldTouchSession(session, after(SESSION_TOUCH_INTERVAL_MS)), true);
		});
	});
});
