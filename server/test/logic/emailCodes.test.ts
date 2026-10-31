import assert from 'assert';

import { decideEmailCodeSend, decideHourlyLimit, EMAIL_CODE_ALPHABET, EMAIL_CODE_LIFETIME_MS, emailCodeFromBytes, emailCodeState, MAX_EMAIL_CODES_PER_ADDRESS_HOUR, MAX_WRONG_GUESSES_PER_ADDRESS_DAY, MAX_WRONG_GUESSES_PER_CODE, normalizeEmailCode } from '../../src/logic/emailCodes.js';

const NOW = new Date('2026-10-28T12:00:00Z');

/**
 * A time some seconds before NOW
 *
 * @param seconds How many seconds before
 * @return The time
 */
function secondsAgo(seconds: number): Date
{
	return(new Date(NOW.getTime() - (seconds * 1000)));
}

describe('emailCodes', () =>
{
	describe('emailCodeFromBytes', () =>
	{
		it('makes 6 characters from the alphabet', () =>
		{
			const code = emailCodeFromBytes(new Uint8Array([0, 1, 31, 32, 255, 100]));

			assert.strictEqual(code, '01Z0Z4');
		});

		it('never uses I, L, O or U', () =>
		{
			assert.strictEqual(EMAIL_CODE_ALPHABET.length, 32);

			for (let byte = 0; byte < 256; byte++)
			{
				assert.match(emailCodeFromBytes(new Uint8Array(6).fill(byte)), /^[0-9A-HJKMNP-TV-Z]{6}$/);
			}
		});

		it('refuses too few bytes', () =>
		{
			assert.throws(() => emailCodeFromBytes(new Uint8Array(5)));
		});
	});

	describe('normalizeEmailCode', () =>
	{
		it('ignores case, spaces and dashes', () =>
		{
			assert.strictEqual(normalizeEmailCode(' ab3-x 9z '), 'AB3X9Z');
		});

		it('reads O, I and L as 0, 1 and 1', () =>
		{
			assert.strictEqual(normalizeEmailCode('oilOIL'), '011011');
		});

		it('refuses the wrong length', () =>
		{
			assert.strictEqual(normalizeEmailCode('ABC12'), undefined);
			assert.strictEqual(normalizeEmailCode('ABC1234'), undefined);
			assert.strictEqual(normalizeEmailCode(''), undefined);
		});

		it('refuses characters outside the alphabet', () =>
		{
			assert.strictEqual(normalizeEmailCode('ABCDEU'), undefined);
			assert.strictEqual(normalizeEmailCode('ABCD!1'), undefined);
		});
	});

	describe('decideEmailCodeSend', () =>
	{
		it('allows the first code', () =>
		{
			assert.deepStrictEqual(decideEmailCodeSend({ sentAt: [], wrongGuessesAt: [] }, NOW), { allowed: true });
		});

		it('waits 60 seconds between codes', () =>
		{
			assert.deepStrictEqual(decideEmailCodeSend({ sentAt: [secondsAgo(20)], wrongGuessesAt: [] }, NOW), {
				allowed: false,
				retryAt: secondsAgo(-40)
			});
			assert.deepStrictEqual(decideEmailCodeSend({ sentAt: [secondsAgo(60)], wrongGuessesAt: [] }, NOW), { allowed: true });
		});

		it('allows 5 codes an hour', () =>
		{
			const sentAt = [secondsAgo(3000), secondsAgo(2000), secondsAgo(1000), secondsAgo(500), secondsAgo(100)];

			assert.strictEqual(sentAt.length, MAX_EMAIL_CODES_PER_ADDRESS_HOUR);
			assert.deepStrictEqual(decideEmailCodeSend({ sentAt, wrongGuessesAt: [] }, NOW), {
				allowed: false,
				retryAt: secondsAgo(3000 - 3600)
			});
			assert.deepStrictEqual(decideEmailCodeSend({ sentAt: sentAt.slice(1), wrongGuessesAt: [] }, NOW), { allowed: true });
		});

		it('ignores codes sent over an hour ago', () =>
		{
			const sentAt = [secondsAgo(4000), secondsAgo(3900), secondsAgo(3800), secondsAgo(3700), secondsAgo(3601)];

			assert.deepStrictEqual(decideEmailCodeSend({ sentAt, wrongGuessesAt: [] }, NOW), { allowed: true });
		});

		it('stops sending after 15 wrong guesses in a day, until the oldest is a day old', () =>
		{
			const wrongGuessesAt = Array.from({ length: MAX_WRONG_GUESSES_PER_ADDRESS_DAY }, (_value, index) => secondsAgo(80000 - index));

			assert.deepStrictEqual(decideEmailCodeSend({ sentAt: [], wrongGuessesAt }, NOW), {
				allowed: false,
				retryAt: secondsAgo(80000 - 86400)
			});
			assert.deepStrictEqual(decideEmailCodeSend({ sentAt: [], wrongGuessesAt: wrongGuessesAt.slice(1) }, NOW), { allowed: true });
		});

		it('waits for the latest of several limits', () =>
		{
			const wrongGuessesAt = Array.from({ length: MAX_WRONG_GUESSES_PER_ADDRESS_DAY }, () => secondsAgo(1000));

			assert.deepStrictEqual(decideEmailCodeSend({ sentAt: [secondsAgo(10)], wrongGuessesAt }, NOW), {
				allowed: false,
				retryAt: secondsAgo(1000 - 86400)
			});
		});
	});

	describe('emailCodeState', () =>
	{
		it('is open while fresh, unused and with guesses left', () =>
		{
			assert.strictEqual(emailCodeState({ sentAt: secondsAgo(60), usedAt: null, wrongGuesses: (MAX_WRONG_GUESSES_PER_CODE - 1) }, NOW), 'open');
		});

		it('expires after 15 minutes', () =>
		{
			const sentAt = new Date(NOW.getTime() - EMAIL_CODE_LIFETIME_MS);

			assert.strictEqual(emailCodeState({ sentAt, usedAt: null, wrongGuesses: 0 }, NOW), 'expired');
		});

		it('works once', () =>
		{
			assert.strictEqual(emailCodeState({ sentAt: secondsAgo(60), usedAt: secondsAgo(30), wrongGuesses: 0 }, NOW), 'used');
		});

		it('ends after 5 wrong guesses', () =>
		{
			assert.strictEqual(emailCodeState({ sentAt: secondsAgo(60), usedAt: null, wrongGuesses: MAX_WRONG_GUESSES_PER_CODE }, NOW), 'exhausted');
		});
	});

	describe('decideHourlyLimit', () =>
	{
		it('allows attempts under the limit', () =>
		{
			assert.deepStrictEqual(decideHourlyLimit([secondsAgo(10), secondsAgo(20)], 3, NOW), { allowed: true });
		});

		it('refuses at the limit until the oldest counted attempt is an hour old', () =>
		{
			assert.deepStrictEqual(decideHourlyLimit([secondsAgo(10), secondsAgo(30), secondsAgo(20)], 3, NOW), {
				allowed: false,
				retryAt: secondsAgo(30 - 3600)
			});
		});

		it('ignores attempts over an hour old', () =>
		{
			assert.deepStrictEqual(decideHourlyLimit([secondsAgo(10), secondsAgo(3600), secondsAgo(5000)], 2, NOW), { allowed: true });
		});
	});
});
