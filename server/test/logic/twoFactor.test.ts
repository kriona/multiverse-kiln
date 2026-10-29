import assert from 'assert';

import { encodeBase32, formatRecoveryCode, matchTotpCode, readTwoFactorCode, RECOVERY_CODE_LENGTH, recoveryCodeFromBytes, totpCode, totpStep, totpUri } from '../../src/logic/twoFactor.js';

/**
 * RFC 6238's test secret for HMAC-SHA1
 */
const RFC_SECRET = Buffer.from('12345678901234567890');

/**
 * A time in seconds since 1970, as a date
 *
 * @param seconds The seconds
 * @return The date
 */
function at(seconds: number): Date
{
	return(new Date(seconds * 1000));
}

describe('twoFactor', () =>
{
	describe('totpCode', () =>
	{
		it('matches RFC 6238\'s test values, cut to 6 digits', () =>
		{
			assert.strictEqual(totpCode(RFC_SECRET, totpStep(at(59))), '287082');
			assert.strictEqual(totpCode(RFC_SECRET, totpStep(at(1111111109))), '081804');
			assert.strictEqual(totpCode(RFC_SECRET, totpStep(at(1234567890))), '005924');
			assert.strictEqual(totpCode(RFC_SECRET, totpStep(at(2000000000))), '279037');
		});
	});

	describe('matchTotpCode', () =>
	{
		const now = at(1234567890);
		const step = totpStep(now);

		it('takes the code for now, and the steps either side of it', () =>
		{
			assert.strictEqual(matchTotpCode(RFC_SECRET, totpCode(RFC_SECRET, step), now, null), step);
			assert.strictEqual(matchTotpCode(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, null), step - 1);
			assert.strictEqual(matchTotpCode(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, null), step + 1);
		});

		it('refuses codes from further away', () =>
		{
			assert.strictEqual(matchTotpCode(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now, null), undefined);
			assert.strictEqual(matchTotpCode(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now, null), undefined);
		});

		it('refuses a code no later than the last one used', () =>
		{
			assert.strictEqual(matchTotpCode(RFC_SECRET, totpCode(RFC_SECRET, step), now, step), undefined);
			assert.strictEqual(matchTotpCode(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, step - 1), undefined);
			assert.strictEqual(matchTotpCode(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, step), step + 1);
		});

		it('refuses a wrong code', () =>
		{
			const right = totpCode(RFC_SECRET, step);
			const wrong = String((Number(right) + 1) % 1000000).padStart(6, '0');

			assert.strictEqual(matchTotpCode(RFC_SECRET, wrong, now, null), undefined);
		});
	});

	describe('encodeBase32', () =>
	{
		it('matches RFC 4648\'s test values, without padding', () =>
		{
			assert.strictEqual(encodeBase32(Buffer.from('')), '');
			assert.strictEqual(encodeBase32(Buffer.from('f')), 'MY');
			assert.strictEqual(encodeBase32(Buffer.from('fooba')), 'MZXW6YTB');
			assert.strictEqual(encodeBase32(Buffer.from('foobar')), 'MZXW6YTBOI');
		});
	});

	describe('recovery codes', () =>
	{
		it('are made of the email code alphabet, and shown in two halves', () =>
		{
			const code = recoveryCodeFromBytes(new Uint8Array([0, 1, 31, 32, 255, 100, 2, 3, 4, 5]));

			assert.strictEqual(code.length, RECOVERY_CODE_LENGTH);
			assert.strictEqual(code, '01Z0Z42345');
			assert.strictEqual(formatRecoveryCode(code), '01Z0Z-42345');
		});

		it('need enough random bytes', () =>
		{
			assert.throws(() => recoveryCodeFromBytes(new Uint8Array(RECOVERY_CODE_LENGTH - 1)));
		});
	});

	describe('readTwoFactorCode', () =>
	{
		it('reads 6 digits as an authenticator code, ignoring spaces and dashes', () =>
		{
			assert.deepStrictEqual(readTwoFactorCode(' 123 456 '), { kind: 'totp', code: '123456' });
			assert.deepStrictEqual(readTwoFactorCode('123-456'), { kind: 'totp', code: '123456' });
		});

		it('reads a recovery code as forgivingly as an email code', () =>
		{
			assert.deepStrictEqual(readTwoFactorCode('o1zoz-42345'), { kind: 'recovery', code: '01Z0Z42345' });
		});

		it('refuses anything else', () =>
		{
			assert.strictEqual(readTwoFactorCode(''), undefined);
			assert.strictEqual(readTwoFactorCode('12345'), undefined);
			assert.strictEqual(readTwoFactorCode('ABCDE-FGHIU'), undefined);
		});
	});

	describe('totpUri', () =>
	{
		it('names the site and account, and holds the secret', () =>
		{
			assert.strictEqual(totpUri('MZXW6YTBOI', 'Multiverse Kiln', 'ada'), 'otpauth://totp/Multiverse%20Kiln:ada?secret=MZXW6YTBOI&issuer=Multiverse+Kiln&algorithm=SHA1&digits=6&period=30');
		});
	});
});
