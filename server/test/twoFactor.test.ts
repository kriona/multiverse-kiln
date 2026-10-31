import assert from 'assert';
import { AUTH_CODE_CHECK_PATH, AUTH_CODE_PATH, AUTH_LOGIN_PATH, AUTH_LOGOUT_PATH, AUTH_PASSWORD_RESET_PATH, AUTH_RECOVERY_CODES_PATH, AUTH_TRUSTED_BROWSERS_FORGET_PATH, AUTH_TWO_FACTOR_DISABLE_PATH, AUTH_TWO_FACTOR_ENABLE_PATH, AUTH_TWO_FACTOR_LOGIN_PATH, AUTH_TWO_FACTOR_SETUP_PATH, PROFILE_PATH, RECOVERY_CODE_COUNT, type AuthErrorPayload, type EmailCodeCheckPayload, type LoginPayload, type OwnProfilePayload, type RecoveryCodesPayload, type TwoFactorSetupPayload } from '@multiverse-kiln/shared';

import { keyedHash } from '../src/auth/keyedHashes.js';
import { hashPassword } from '../src/auth/passwords.js';
import { decryptTotpSecret } from '../src/auth/totpSecrets.js';
import { pool } from '../src/db/client.js';
import { createPlayer } from '../src/db/playerRepo.js';
import { recordRateLimitEvent } from '../src/db/rateLimitRepo.js';
import { setEmailSender, type Email } from '../src/email/mailer.js';
import { HOUR_MS } from '../src/logic/emailCodes.js';
import { MAX_TWO_FACTOR_ATTEMPTS_PER_ACCOUNT_HOUR, MAX_WRONG_AUTHENTICATOR_CODES_PER_ACCOUNT_DAY, MAX_WRONG_TWO_FACTOR_CODES_PER_LOGIN, WRONG_AUTHENTICATOR_CODES_BEFORE_WARNING } from '../src/logic/twoFactor.js';
import { Browser } from './browser.js';
import { logInBrowser } from './players.js';
import { discardEmail } from './setup.js';
import { getTestServer } from './testServer.js';
import { authenticatorCode, turnOnTwoFactor, type TestAuthenticator } from './twoFactorAccounts.js';
import { waitUntil } from './waitUntil.js';

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'ada@example.com';

describe('2FA routes', () =>
{
	let emails: Email[];

	/**
	 * Makes Ada's local account
	 *
	 * @return Its ID
	 */
	async function addAda(): Promise<string>
	{
		return((await createPlayer({
			username: 'ada',
			displayName: 'Ada',
			email: EMAIL,
			passwordHash: await hashPassword(PASSWORD)
		})).id);
	}

	/**
	 * Logs a browser in with Ada's password
	 *
	 * @param browser The browser
	 * @return What the login answered
	 */
	async function logIn(browser: Browser): Promise<LoginPayload>
	{
		const answer = await browser.send<LoginPayload>('POST', AUTH_LOGIN_PATH, { email: EMAIL, password: PASSWORD, rememberMe: false });

		assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));

		return(answer.body);
	}

	/**
	 * Gives the code a login waits for
	 *
	 * @param browser The browser
	 * @param code The code
	 * @param trustBrowser Whether to trust the browser
	 * @return The answer
	 */
	function sendCode(browser: Browser, code: string, trustBrowser: boolean = false): Promise<{ status: number; body: AuthErrorPayload }>
	{
		return(browser.send('POST', AUTH_TWO_FACTOR_LOGIN_PATH, { code, trustBrowser, locale: 'en' }));
	}

	/**
	 * A code that isn't right now
	 *
	 * @param authenticator The authenticator
	 * @return The code
	 */
	function wrongCode(authenticator: TestAuthenticator): string
	{
		return(String((Number(authenticatorCode(authenticator.secret)) + 500000) % 1000000).padStart(6, '0'));
	}

	/**
	 * Records wrong authenticator codes for an account, as if typed a couple of hours ago, so the
	 * hourly limits don't count them
	 *
	 * @param playerId The account
	 * @param count How many
	 */
	async function addEarlierWrongCodes(playerId: string, count: number): Promise<void>
	{
		const earlier = new Date(Date.now() - (2 * HOUR_MS));

		for (let i = 0; i < count; i++)
		{
			await recordRateLimitEvent('accountWrongAuthenticatorCode', keyedHash('account', playerId), earlier);
		}
	}

	/**
	 * The kinds of Ada's auth events, oldest first
	 *
	 * @return The kinds
	 */
	async function eventKinds(): Promise<string[]>
	{
		const result = await pool.query<{ kind: string }>('SELECT e.kind FROM auth_events e JOIN players p ON p.id = e.player_id WHERE p.username = \'ada\' ORDER BY e.occurred_at, e.kind');

		return(result.rows.map((row) => row.kind));
	}

	before(async () =>
	{
		await getTestServer();
	});

	after(() =>
	{
		setEmailSender(discardEmail);
	});

	beforeEach(() =>
	{
		emails = [];
		setEmailSender((email) =>
		{
			emails.push(email);
			return(Promise.resolve());
		});
	});

	describe('turning on', () =>
	{
		it('needs a login', async () =>
		{
			assert.strictEqual((await new Browser().send('POST', AUTH_TWO_FACTOR_SETUP_PATH, { password: PASSWORD })).status, 401);
		});

		it('takes the password, then a code from the app, and gives recovery codes', async () =>
		{
			const playerId = await addAda();
			const browser = new Browser();

			await logIn(browser);

			const wrongPassword = await browser.send('POST', AUTH_TWO_FACTOR_SETUP_PATH, { password: 'not the password at all' });

			assert.strictEqual(wrongPassword.status, 401);
			assert.strictEqual(wrongPassword.body.field, 'password');

			const setup = await browser.send<TwoFactorSetupPayload>('POST', AUTH_TWO_FACTOR_SETUP_PATH, { password: PASSWORD });

			assert.strictEqual(setup.status, 200);
			assert.match(setup.body.secret, /^[A-Z2-7]{32}$/);
			assert.strictEqual(setup.body.uri, `otpauth://totp/Multiverse%20Kiln:ada?secret=${setup.body.secret}&issuer=Multiverse+Kiln&algorithm=SHA1&digits=6&period=30`);

			// Stored only encrypted
			const stored = await pool.query<{ encrypted_secret: Buffer }>('SELECT encrypted_secret FROM authenticators');
			const secret = decryptTotpSecret(stored.rows[0].encrypted_secret, playerId);

			assert.strictEqual(stored.rows[0].encrypted_secret.includes(secret), false);

			// Set up but not on yet, so logging in doesn't ask for a code
			const other = new Browser();

			assert.deepStrictEqual(await logIn(other), { outcome: 'loggedIn' });

			const wrong = await browser.send('POST', AUTH_TWO_FACTOR_ENABLE_PATH, { code: wrongCode({ secret, recoveryCodes: [] }), locale: 'en' });

			assert.strictEqual(wrong.status, 400);
			assert.strictEqual(wrong.body.field, 'code');

			const enabled = await browser.send<RecoveryCodesPayload>('POST', AUTH_TWO_FACTOR_ENABLE_PATH, { code: authenticatorCode(secret), locale: 'en' });

			assert.strictEqual(enabled.status, 200);
			assert.strictEqual(enabled.body.recoveryCodes.length, RECOVERY_CODE_COUNT);
			assert.ok(enabled.body.recoveryCodes.every((code) => /^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(code)));

			// Every other browser is logged out
			assert.strictEqual(await browser.username(), 'ada');
			assert.strictEqual(await other.username(), null);
			await waitUntil(() => emails.some((email) => /Two-factor authentication is on/.test(email.subject)));

			const profile = await browser.send<OwnProfilePayload>('GET', PROFILE_PATH);

			assert.deepStrictEqual(profile.body.twoFactor, { recoveryCodesLeft: RECOVERY_CODE_COUNT, trustedBrowsers: 0 });
			assert.strictEqual((await browser.send('POST', AUTH_TWO_FACTOR_SETUP_PATH, { password: PASSWORD })).status, 409);
			assert.deepStrictEqual(await logIn(new Browser()), { outcome: 'twoFactor' });
		});

		it('needs the app\'s code within a few minutes of starting', async () =>
		{
			await addAda();

			const browser = new Browser();

			await logIn(browser);
			assert.strictEqual((await browser.send('POST', AUTH_TWO_FACTOR_ENABLE_PATH, { code: '123456', locale: 'en' })).status, 403);
			assert.strictEqual((await browser.send('POST', AUTH_TWO_FACTOR_SETUP_PATH, { password: PASSWORD })).status, 200);
			await pool.query('UPDATE authenticators SET created_at = now() - interval \'1 hour\'');
			assert.strictEqual((await browser.send('POST', AUTH_TWO_FACTOR_ENABLE_PATH, { code: '123456', locale: 'en' })).status, 403);
		});

		it('isn\'t offered to an account without a password', async () =>
		{
			const player = await createPlayer({
				username: 'grace',
				displayName: 'Grace',
				email: 'grace@example.com',
				passwordHash: null
			});
			const browser = new Browser();

			browser.cookies.set('__Host-kiln-session', (await logInBrowser(player.id)).cookie.split('=')[1]);
			assert.strictEqual((await browser.send('POST', AUTH_TWO_FACTOR_SETUP_PATH, { password: PASSWORD })).status, 400);
		});
	});

	describe('logging in', () =>
	{
		it('asks for a code once the password is right, and logs in once the code is', async () =>
		{
			const authenticator = await turnOnTwoFactor(await addAda());
			const browser = new Browser();

			assert.deepStrictEqual(await logIn(browser), { outcome: 'twoFactor' });
			assert.strictEqual(await browser.username(), null);

			const wrong = await sendCode(browser, wrongCode(authenticator));

			assert.strictEqual(wrong.status, 401);
			assert.strictEqual(wrong.body.field, 'twoFactorCode');
			assert.strictEqual(await browser.username(), null);

			const code = authenticatorCode(authenticator.secret);

			assert.strictEqual((await sendCode(browser, code)).status, 204);
			assert.strictEqual(await browser.username(), 'ada');
			assert.strictEqual(browser.cookies.has('__Host-kiln-two-factor'), false);
			assert.deepStrictEqual(await eventKinds(), ['twoFactorFailed', 'loggedIn']);

			// A code works once
			const other = new Browser();

			await logIn(other);
			assert.strictEqual((await sendCode(other, code)).status, 401);
			assert.strictEqual((await sendCode(other, authenticatorCode(authenticator.secret, 1))).status, 204);
		});

		it('needs the browser that gave the password', async () =>
		{
			const authenticator = await turnOnTwoFactor(await addAda());

			await logIn(new Browser());
			assert.strictEqual((await sendCode(new Browser(), authenticatorCode(authenticator.secret))).status, 403);
		});

		it('ends the login after too many wrong codes', async () =>
		{
			const authenticator = await turnOnTwoFactor(await addAda());
			const browser = new Browser();

			await logIn(browser);

			for (let i = 1; i < MAX_WRONG_TWO_FACTOR_CODES_PER_LOGIN; i++)
			{
				assert.strictEqual((await sendCode(browser, wrongCode(authenticator))).status, 401);
			}

			assert.strictEqual((await sendCode(browser, wrongCode(authenticator))).status, 403);
			assert.strictEqual((await sendCode(browser, authenticatorCode(authenticator.secret))).status, 403);
			assert.strictEqual(await browser.username(), null);
		});

		it('limits the codes tried for an account, across logins', async () =>
		{
			const authenticator = await turnOnTwoFactor(await addAda());
			let tried = 0;

			while (tried < MAX_TWO_FACTOR_ATTEMPTS_PER_ACCOUNT_HOUR)
			{
				const browser = new Browser();

				await logIn(browser);

				for (let i = 1; (i < MAX_WRONG_TWO_FACTOR_CODES_PER_LOGIN) && (tried < MAX_TWO_FACTOR_ATTEMPTS_PER_ACCOUNT_HOUR); i++, tried++)
				{
					assert.strictEqual((await sendCode(browser, wrongCode(authenticator))).status, 401);
				}
			}

			const browser = new Browser();

			await logIn(browser);
			assert.strictEqual((await sendCode(browser, authenticatorCode(authenticator.secret))).status, 429);
		});

		it('takes only recovery codes after too many wrong authenticator codes in a day', async () =>
		{
			const playerId = await addAda();
			const authenticator = await turnOnTwoFactor(playerId);
			const browser = new Browser();

			await addEarlierWrongCodes(playerId, MAX_WRONG_AUTHENTICATOR_CODES_PER_ACCOUNT_DAY);
			await logIn(browser);

			const refused = await sendCode(browser, authenticatorCode(authenticator.secret));

			assert.strictEqual(refused.status, 429);
			assert.strictEqual(refused.body.field, 'twoFactorCode');
			assert.strictEqual(refused.body.error.id, 'error.auth.tooManyWrongAuthenticatorCodes');
			assert.strictEqual((await sendCode(browser, authenticator.recoveryCodes[0])).status, 204);
			assert.strictEqual(await browser.username(), 'ada');
		});

		it('emails the account once it has had several wrong authenticator codes in a day', async () =>
		{
			const playerId = await addAda();
			const authenticator = await turnOnTwoFactor(playerId);
			const browser = new Browser();

			await addEarlierWrongCodes(playerId, WRONG_AUTHENTICATOR_CODES_BEFORE_WARNING - 1);
			await logIn(browser);
			assert.strictEqual((await sendCode(browser, wrongCode(authenticator))).status, 401);
			await waitUntil(() => (emails.length === 1));
			assert.strictEqual(emails[0].to, EMAIL);
			assert.match(emails[0].text, new RegExp(`${WRONG_AUTHENTICATOR_CODES_BEFORE_WARNING} wrong codes`));
			assert.match(emails[0].text, /change your password/);

			// Only the code that reaches the count sends it
			assert.strictEqual((await sendCode(browser, wrongCode(authenticator))).status, 401);
			assert.strictEqual((await sendCode(browser, authenticatorCode(authenticator.secret))).status, 204);
			assert.strictEqual(emails.length, 1);
		});

		it('takes each recovery code once, emailing the account how many are left', async () =>
		{
			const authenticator = await turnOnTwoFactor(await addAda());
			const [code] = authenticator.recoveryCodes;
			const browser = new Browser();

			await logIn(browser);
			assert.strictEqual((await sendCode(browser, code.toLowerCase())).status, 204);
			assert.strictEqual(await browser.username(), 'ada');
			await waitUntil(() => (emails.length === 1));
			assert.strictEqual(emails[0].to, EMAIL);
			assert.match(emails[0].text, /You have 2 left/);

			const other = new Browser();

			await logIn(other);
			assert.strictEqual((await sendCode(other, code)).status, 401);
			assert.deepStrictEqual(await eventKinds(), ['loggedIn', 'recoveryCodeUsed', 'twoFactorFailed']);
		});

		it('skips the code on a browser the player trusts, until they stop trusting it', async () =>
		{
			const playerId = await addAda();
			const authenticator = await turnOnTwoFactor(playerId);
			const browser = new Browser();

			await logIn(browser);
			assert.strictEqual((await sendCode(browser, authenticatorCode(authenticator.secret), true)).status, 204);
			assert.ok(browser.cookies.has('__Host-kiln-trusted'));
			assert.strictEqual((await browser.send('POST', AUTH_LOGOUT_PATH)).status, 204);
			assert.deepStrictEqual(await logIn(browser), { outcome: 'loggedIn' });

			// Only that browser
			assert.deepStrictEqual(await logIn(new Browser()), { outcome: 'twoFactor' });
			assert.deepStrictEqual((await browser.send<OwnProfilePayload>('GET', PROFILE_PATH)).body.twoFactor, { recoveryCodesLeft: 3, trustedBrowsers: 1 });

			// Only that account: the token in the cookie means nothing for another
			const grace = await createPlayer({
				username: 'grace',
				displayName: 'Grace',
				email: 'grace@example.com',
				passwordHash: await hashPassword(PASSWORD)
			});

			await turnOnTwoFactor(grace.id);
			assert.deepStrictEqual((await browser.send('POST', AUTH_LOGIN_PATH, { email: 'grace@example.com', password: PASSWORD, rememberMe: false })).body, { outcome: 'twoFactor' });

			// Expired
			await pool.query('UPDATE trusted_browsers SET expires_at = now() - interval \'1 minute\'');
			assert.deepStrictEqual(await logIn(browser), { outcome: 'twoFactor' });
			await pool.query('UPDATE trusted_browsers SET expires_at = now() + interval \'1 day\'');
			assert.deepStrictEqual(await logIn(browser), { outcome: 'loggedIn' });

			assert.strictEqual((await browser.send('POST', AUTH_TRUSTED_BROWSERS_FORGET_PATH)).status, 204);
			assert.deepStrictEqual(await logIn(browser), { outcome: 'twoFactor' });
		});
	});

	describe('resetting a password', () =>
	{
		/**
		 * Asks for a reset code and enters it
		 *
		 * @param browser The browser
		 * @return What the check answered
		 */
		async function enterResetCode(browser: Browser): Promise<EmailCodeCheckPayload>
		{
			assert.strictEqual((await browser.send('POST', AUTH_CODE_PATH, { purpose: 'resetPassword', email: EMAIL, locale: 'en' })).status, 204);
			await waitUntil(() => (emails.length === 1));

			const code = /\r\n\r\n([0-9A-Z]{6})\r\n\r\n/.exec(emails[0].text)?.[1];
			const answer = await browser.send<EmailCodeCheckPayload>('POST', AUTH_CODE_CHECK_PATH, { purpose: 'resetPassword', email: EMAIL, code });

			assert.strictEqual(answer.status, 200);

			return(answer.body);
		}

		it('needs the authenticator code as well as the email code', async () =>
		{
			const authenticator = await turnOnTwoFactor(await addAda());
			const browser = new Browser();

			assert.deepStrictEqual(await enterResetCode(browser), { twoFactor: true });

			const request = { password: 'a new passphrase', rememberMe: false, locale: 'en' };
			const missing = await browser.send('POST', AUTH_PASSWORD_RESET_PATH, { ...request, twoFactorCode: null });

			assert.strictEqual(missing.status, 401);
			assert.strictEqual(missing.body.field, 'twoFactorCode');
			assert.strictEqual((await browser.send('POST', AUTH_PASSWORD_RESET_PATH, { ...request, twoFactorCode: wrongCode(authenticator) })).status, 401);
			assert.deepStrictEqual(await logIn(new Browser()), { outcome: 'twoFactor' });

			// The email code's next step waits through wrong authenticator codes
			assert.strictEqual((await browser.send('POST', AUTH_PASSWORD_RESET_PATH, { ...request, twoFactorCode: authenticatorCode(authenticator.secret) })).status, 204);
			assert.strictEqual(await browser.username(), 'ada');
		});

		it('stops trusting every browser the account trusted', async () =>
		{
			const authenticator = await turnOnTwoFactor(await addAda());
			const trusted = new Browser();

			await logIn(trusted);
			assert.strictEqual((await sendCode(trusted, authenticatorCode(authenticator.secret), true)).status, 204);

			const browser = new Browser();

			await enterResetCode(browser);
			assert.strictEqual((await browser.send('POST', AUTH_PASSWORD_RESET_PATH, { password: 'a new passphrase', rememberMe: false, locale: 'en', twoFactorCode: authenticator.recoveryCodes[0] })).status, 204);
			assert.deepStrictEqual((await trusted.send('POST', AUTH_LOGIN_PATH, { email: EMAIL, password: 'a new passphrase', rememberMe: false })).body, { outcome: 'twoFactor' });
		});

		it('needs no authenticator code for an account without 2FA', async () =>
		{
			await addAda();
			assert.deepStrictEqual(await enterResetCode(new Browser()), { twoFactor: false });
		});
	});

	describe('turning off', () =>
	{
		it('needs the password and a code, and emails the account', async () =>
		{
			const authenticator = await turnOnTwoFactor(await addAda());
			const browser = new Browser();

			await logIn(browser);
			assert.strictEqual((await sendCode(browser, authenticatorCode(authenticator.secret), true)).status, 204);

			const code = authenticatorCode(authenticator.secret, 1);

			assert.strictEqual((await browser.send('POST', AUTH_TWO_FACTOR_DISABLE_PATH, { password: 'not the password at all', code, locale: 'en' })).body.field, 'password');
			assert.strictEqual((await browser.send('POST', AUTH_TWO_FACTOR_DISABLE_PATH, { password: PASSWORD, code: wrongCode(authenticator), locale: 'en' })).body.field, 'twoFactorCode');
			assert.strictEqual((await browser.send('POST', AUTH_TWO_FACTOR_DISABLE_PATH, { password: PASSWORD, code, locale: 'en' })).status, 204);
			await waitUntil(() => emails.some((email) => /Two-factor authentication is off/.test(email.subject)));
			assert.deepStrictEqual(await logIn(new Browser()), { outcome: 'loggedIn' });

			for (const table of ['authenticators', 'recovery_codes', 'trusted_browsers'])
			{
				assert.strictEqual((await pool.query(`SELECT * FROM ${table}`)).rowCount, 0, table);
			}

			assert.strictEqual((await browser.send('POST', AUTH_TWO_FACTOR_DISABLE_PATH, { password: PASSWORD, code, locale: 'en' })).status, 409);
		});
	});

	describe('replacing recovery codes', () =>
	{
		it('needs the password and a code, and the old codes stop working', async () =>
		{
			const authenticator = await turnOnTwoFactor(await addAda());
			const browser = new Browser();

			await logIn(browser);
			assert.strictEqual((await sendCode(browser, authenticatorCode(authenticator.secret))).status, 204);

			const replaced = await browser.send<RecoveryCodesPayload>('POST', AUTH_RECOVERY_CODES_PATH, { password: PASSWORD, code: authenticator.recoveryCodes[0], locale: 'en' });

			assert.strictEqual(replaced.status, 200);
			assert.strictEqual(replaced.body.recoveryCodes.length, RECOVERY_CODE_COUNT);

			const other = new Browser();

			await logIn(other);
			assert.strictEqual((await sendCode(other, authenticator.recoveryCodes[1])).status, 401);
			assert.strictEqual((await sendCode(other, replaced.body.recoveryCodes[0])).status, 204);
		});
	});
});
