import assert from 'assert';
import { createHash } from 'crypto';
import { AUTH_CODE_CHECK_PATH, AUTH_CODE_PATH, AUTH_EMAIL_CHANGE_PATH, AUTH_LOGIN_PATH, AUTH_LOGOUT_PATH, AUTH_PASSWORD_RESET_PATH, AUTH_REGISTER_PATH, AUTH_SESSION_PATH, type AuthErrorPayload, type EmailCodePurpose, type SessionPayload } from '@multiverse-kiln/shared';

import { hashPassword } from '../src/auth/passwords.js';
import { setPwnedRangeFetch } from '../src/auth/pwnedPasswords.js';
import { MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR } from '../src/auth/rateLimits.js';
import { pool } from '../src/db/client.js';
import { createPlayer } from '../src/db/playerRepo.js';
import { setEmailSender, type Email } from '../src/email/mailer.js';
import { MAX_WRONG_GUESSES_PER_CODE } from '../src/logic/emailCodes.js';
import { logInBrowser } from './players.js';
import { getTestServer, testServerUrl } from './testServer.js';
import { waitUntil } from './waitUntil.js';

const PASSWORD = 'correct horse battery staple';

/**
 * A breached password, which the stand-in for HaveIBeenPwned lists
 */
const BREACHED_PASSWORD = 'password1234567890';

/**
 * A browser's cookies, kept between requests like a browser keeps them
 */
class Browser
{
	readonly cookies = new Map<string, string>();

	/**
	 * Sends a JSON request, sending the browser's cookies and keeping the ones the answer sets
	 *
	 * @param method The HTTP method
	 * @param path The path
	 * @param body The JSON body, if any
	 * @return The status and the parsed body
	 */
	async send<T = AuthErrorPayload>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>
	{
		const headers: Record<string, string> = {};

		if (this.cookies.size > 0)
		{
			headers['Cookie'] = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
		}

		if (body !== undefined)
		{
			headers['Content-Type'] = 'application/json';
		}

		const response = await fetch(`${testServerUrl}${path}`, {
			method,
			headers,
			body: ((body === undefined) ? undefined : JSON.stringify(body))
		});

		for (const cookie of response.headers.getSetCookie())
		{
			const [pair] = cookie.split(';');
			const separator = pair.indexOf('=');
			const name = pair.slice(0, separator);
			const value = pair.slice(separator + 1);

			if ((value === '') || /Expires=Thu, 01 Jan 1970/i.test(cookie))
			{
				this.cookies.delete(name);
			}
			else
			{
				this.cookies.set(name, value);
			}
		}

		const text = await response.text();

		return({
			status: response.status,
			body: ((text === '') ? undefined : JSON.parse(text)) as T
		});
	}

	/**
	 * Who the browser is logged in as
	 *
	 * @return The player's handle, or null when it isn't logged in
	 */
	async handle(): Promise<string | null>
	{
		return((await this.send<SessionPayload>('GET', AUTH_SESSION_PATH)).body.player?.handle ?? null);
	}
}

describe('auth routes', () =>
{
	let emails: Email[];

	/**
	 * The code in the latest email sent to an address
	 *
	 * @param address The address
	 * @return The code
	 */
	async function codeSentTo(address: string): Promise<string>
	{
		await waitUntil(() => emails.some((email) => (email.to === address)));

		const email = emails.filter((each) => (each.to === address)).at(-1);
		const code = /\r\n\r\n([0-9A-Z]{6})\r\n\r\n/.exec(email?.text ?? '')?.[1];

		assert.ok(code, `no code in the email to ${address}`);

		return(code);
	}

	/**
	 * Asks for a code and enters it, from a browser
	 *
	 * @param browser The browser
	 * @param purpose What the code is for
	 * @param email The address
	 */
	async function enterCode(browser: Browser, purpose: EmailCodePurpose, email: string): Promise<void>
	{
		assert.strictEqual((await browser.send('POST', AUTH_CODE_PATH, { purpose, email, locale: 'en' })).status, 204);

		const code = await codeSentTo(email);

		assert.strictEqual((await browser.send('POST', AUTH_CODE_CHECK_PATH, { purpose, email, code })).status, 204);
	}

	/**
	 * Registers an account from a new browser
	 *
	 * @param email Its address
	 * @param handle Its handle
	 * @return The browser, logged in
	 */
	async function register(email: string, handle: string): Promise<Browser>
	{
		const browser = new Browser();

		await enterCode(browser, 'register', email);

		const answer = await browser.send('POST', AUTH_REGISTER_PATH, {
			email,
			password: PASSWORD,
			handle,
			displayName: 'Ada',
			rememberMe: false,
			locale: 'en'
		});

		assert.strictEqual(answer.status, 204, JSON.stringify(answer.body));

		return(browser);
	}

	/**
	 * The kinds of an account's auth events, oldest first, and those at the same time in the order
	 * AUTH_EVENT_KINDS lists them
	 *
	 * @param handle The account's handle
	 * @return The kinds
	 */
	async function eventKinds(handle: string): Promise<string[]>
	{
		const result = await pool.query<{ kind: string }>('SELECT e.kind FROM auth_events e JOIN players p ON p.id = e.player_id WHERE p.handle = $1 ORDER BY e.occurred_at, e.kind', [handle]);

		return(result.rows.map((row) => row.kind));
	}

	/**
	 * Forgets every attempt the rate limits count, as an hour passing would, so a test can send another
	 * code to an address straight away
	 */
	async function forgetRateLimits(): Promise<void>
	{
		await pool.query('DELETE FROM rate_limit_events');
	}

	before(async () =>
	{
		await getTestServer();

		const breachedSha1 = createHash('sha1')
			.update(BREACHED_PASSWORD)
			.digest('hex')
			.toUpperCase();

		setPwnedRangeFetch(((url: string) => Promise.resolve(new Response(url.endsWith(breachedSha1.slice(0, 5)) ? `${breachedSha1.slice(5)}:42` : ''))) as typeof fetch);
	});

	after(() =>
	{
		setPwnedRangeFetch(undefined);
		setEmailSender(undefined);
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

	describe('registering', () =>
	{
		it('creates an account once the emailed code is entered, logging the browser in', async () =>
		{
			const browser = await register('ada@example.com', 'ada');

			assert.strictEqual(await browser.handle(), 'ada');
			assert.ok(!browser.cookies.has('__Host-kiln-continue'));
			await waitUntil(() => emails.some((email) => /^Welcome/.test(email.subject)));
			assert.deepStrictEqual(await eventKinds('ada'), ['registered', 'loggedIn']);
		});

		it('stores neither the address waiting on a code nor the code', async () =>
		{
			const browser = new Browser();

			await browser.send('POST', AUTH_CODE_PATH, { purpose: 'register', email: 'ada@example.com', locale: 'en' });

			const code = await codeSentTo('ada@example.com');
			const rows = await pool.query('SELECT * FROM email_codes');
			const stored = JSON.stringify(rows.rows);

			assert.strictEqual(rows.rowCount, 1);
			assert.ok(!stored.includes('ada@example.com'));
			assert.ok(!stored.includes(code));
		});

		it('emails the owner of an address that has an account instead, answering the same', async () =>
		{
			await register('ada@example.com', 'ada');
			await forgetRateLimits();
			emails = [];

			const answer = await new Browser().send('POST', AUTH_CODE_PATH, { purpose: 'register', email: 'ADA@example.com', locale: 'en' });

			assert.strictEqual(answer.status, 204);
			await waitUntil(() => (emails.length === 1));
			assert.match(emails[0].subject, /already have an account/);
			assert.strictEqual((await pool.query('SELECT * FROM email_codes')).rowCount, 0);
		});

		it('needs the code to have been entered in the same browser', async () =>
		{
			const browser = new Browser();

			await enterCode(browser, 'register', 'ada@example.com');

			const other = await new Browser().send('POST', AUTH_REGISTER_PATH, {
				email: 'ada@example.com',
				password: PASSWORD,
				handle: 'ada',
				displayName: 'Ada',
				rememberMe: false,
				locale: 'en'
			});

			assert.strictEqual(other.status, 403);
		});

		it('needs the address the code was sent to', async () =>
		{
			const browser = new Browser();

			await enterCode(browser, 'register', 'ada@example.com');

			const answer = await browser.send('POST', AUTH_REGISTER_PATH, {
				email: 'grace@example.com',
				password: PASSWORD,
				handle: 'ada',
				displayName: 'Ada',
				rememberMe: false,
				locale: 'en'
			});

			assert.strictEqual(answer.status, 400);
			assert.strictEqual(answer.body.field, 'email');
		});

		it('refuses short and breached passwords, bad and taken handles, and reserved names', async () =>
		{
			await register('grace@example.com', 'grace');

			const browser = new Browser();

			await enterCode(browser, 'register', 'ada@example.com');

			const attempt = (changes: object): Promise<{ status: number; body: AuthErrorPayload }> => browser.send('POST', AUTH_REGISTER_PATH, {
				email: 'ada@example.com',
				password: PASSWORD,
				handle: 'ada',
				displayName: 'Ada',
				rememberMe: false,
				locale: 'en',
				...changes
			});

			assert.strictEqual((await attempt({ password: 'fourteen chars' })).body.field, 'password');
			assert.strictEqual((await attempt({ password: BREACHED_PASSWORD })).body.field, 'password');
			assert.strictEqual((await attempt({ handle: 'a b' })).body.field, 'handle');
			assert.strictEqual((await attempt({ handle: 'Admin_1' })).body.field, 'handle');
			assert.strictEqual((await attempt({ displayName: 'The Admin' })).body.field, 'displayName');

			const taken = await attempt({ handle: 'GRACE' });

			assert.strictEqual(taken.status, 409);
			assert.strictEqual(taken.body.field, 'handle');

			// The code still lets the browser register, once what was wrong is put right
			assert.strictEqual((await attempt({})).status, 204);
		});
	});

	describe('email codes', () =>
	{
		it('refuse a wrong code, and work once', async () =>
		{
			const browser = new Browser();

			await browser.send('POST', AUTH_CODE_PATH, { purpose: 'register', email: 'ada@example.com', locale: 'en' });

			const code = await codeSentTo('ada@example.com');
			const wrong = await browser.send('POST', AUTH_CODE_CHECK_PATH, { purpose: 'register', email: 'ada@example.com', code: (code === 'AAAAAA') ? 'BBBBBB' : 'AAAAAA' });

			assert.strictEqual(wrong.status, 400);
			assert.strictEqual(wrong.body.field, 'code');
			assert.strictEqual((await browser.send('POST', AUTH_CODE_CHECK_PATH, { purpose: 'register', email: 'ada@example.com', code: code.toLowerCase() })).status, 204);
			assert.strictEqual((await browser.send('POST', AUTH_CODE_CHECK_PATH, { purpose: 'register', email: 'ada@example.com', code })).status, 400);
		});

		it('end after 5 wrong guesses', async () =>
		{
			const browser = new Browser();

			await browser.send('POST', AUTH_CODE_PATH, { purpose: 'register', email: 'ada@example.com', locale: 'en' });

			const code = await codeSentTo('ada@example.com');
			const wrong = ((code === 'AAAAAA') ? 'BBBBBB' : 'AAAAAA');

			for (let guess = 0; guess < MAX_WRONG_GUESSES_PER_CODE; guess++)
			{
				await browser.send('POST', AUTH_CODE_CHECK_PATH, { purpose: 'register', email: 'ada@example.com', code: wrong });
			}

			assert.strictEqual((await browser.send('POST', AUTH_CODE_CHECK_PATH, { purpose: 'register', email: 'ada@example.com', code })).status, 400);
		});

		it('can\'t be sent again within a minute', async () =>
		{
			const browser = new Browser();

			assert.strictEqual((await browser.send('POST', AUTH_CODE_PATH, { purpose: 'register', email: 'ada@example.com', locale: 'en' })).status, 204);

			const again = await browser.send('POST', AUTH_CODE_PATH, { purpose: 'register', email: 'ada@example.com', locale: 'en' });

			assert.strictEqual(again.status, 429);
			assert.strictEqual(again.body.error.id, 'error.auth.tooManyAttempts');
		});

		it('answer the same for a reset of an address without an account, sending nothing', async () =>
		{
			const answer = await new Browser().send('POST', AUTH_CODE_PATH, { purpose: 'resetPassword', email: 'nobody@example.com', locale: 'en' });

			assert.strictEqual(answer.status, 204);
			assert.strictEqual(emails.length, 0);
		});

		it('are written in the language asked for', async () =>
		{
			await new Browser().send('POST', AUTH_CODE_PATH, { purpose: 'register', email: 'ada@example.com', locale: 'en-x-pirate' });
			await codeSentTo('ada@example.com');

			assert.match(emails[0].html, /<html lang="en-x-pirate">/);
		});
	});

	describe('logging in and out', () =>
	{
		it('logs in with the address and password, ignoring the address\'s capitals', async () =>
		{
			await register('ada@example.com', 'ada');

			const browser = new Browser();
			const answer = await browser.send('POST', AUTH_LOGIN_PATH, { email: 'Ada@Example.com', password: PASSWORD, rememberMe: true });

			assert.strictEqual(answer.status, 204);
			assert.strictEqual(await browser.handle(), 'ada');
		});

		it('answers a wrong password and an unknown address the same way', async () =>
		{
			await register('ada@example.com', 'ada');

			const wrongPassword = await new Browser().send('POST', AUTH_LOGIN_PATH, { email: 'ada@example.com', password: 'not the password', rememberMe: false });
			const unknown = await new Browser().send('POST', AUTH_LOGIN_PATH, { email: 'nobody@example.com', password: PASSWORD, rememberMe: false });

			assert.strictEqual(wrongPassword.status, 401);
			assert.deepStrictEqual(unknown, wrongPassword);
			assert.deepStrictEqual(await eventKinds('ada'), ['registered', 'loggedIn', 'loginFailed']);
		});

		it('limits the tries for one address', async () =>
		{
			for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR; attempt++)
			{
				await new Browser().send('POST', AUTH_LOGIN_PATH, { email: 'ada@example.com', password: 'guess', rememberMe: false });
			}

			const answer = await new Browser().send('POST', AUTH_LOGIN_PATH, { email: 'ada@example.com', password: 'guess', rememberMe: false });

			assert.strictEqual(answer.status, 429);
		});

		it('replaces a password hash made with older settings at login', async () =>
		{
			const argon2 = (await import('argon2')).default;
			const oldHash = await argon2.hash(PASSWORD, {
				type: argon2.argon2id,
				memoryCost: 8192,
				timeCost: 1,
				parallelism: 1
			});
			const player = await createPlayer({
				handle: 'ada',
				displayName: 'Ada',
				email: 'ada@example.com',
				passwordHash: oldHash
			});

			assert.strictEqual((await new Browser().send('POST', AUTH_LOGIN_PATH, { email: 'ada@example.com', password: PASSWORD, rememberMe: false })).status, 204);

			const stored = (await pool.query<{ password_hash: string }>('SELECT password_hash FROM players WHERE id = $1', [player.id])).rows[0].password_hash;

			assert.notStrictEqual(stored, oldHash);
			assert.match(stored, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
			assert.deepStrictEqual(await eventKinds('ada'), ['loggedIn', 'passwordRehashed']);
		});

		it('logs out, ending only that browser\'s session', async () =>
		{
			const browser = await register('ada@example.com', 'ada');
			const other = new Browser();

			await other.send('POST', AUTH_LOGIN_PATH, { email: 'ada@example.com', password: PASSWORD, rememberMe: false });

			const sessionCookie = browser.cookies.get('__Host-kiln-session');

			assert.strictEqual((await browser.send('POST', AUTH_LOGOUT_PATH)).status, 204);
			assert.strictEqual(await browser.handle(), null);
			assert.ok(!browser.cookies.has('__Host-kiln-session'));
			assert.strictEqual(await other.handle(), 'ada');

			// The old cookie no longer works, even if a browser kept it
			browser.cookies.set('__Host-kiln-session', sessionCookie ?? '');
			assert.strictEqual(await browser.handle(), null);
		});

		it('doesn\'t know the session of an account that was deleted', async () =>
		{
			const player = await createPlayer({
				handle: 'ada',
				displayName: 'Ada',
				email: 'ada@example.com',
				passwordHash: await hashPassword(PASSWORD)
			});
			const { cookie } = await logInBrowser(player.id);
			const browser = new Browser();

			browser.cookies.set('__Host-kiln-session', cookie.split('=')[1]);
			assert.strictEqual(await browser.handle(), 'ada');

			await pool.query('DELETE FROM players WHERE id = $1', [player.id]);
			assert.strictEqual(await browser.handle(), null);
		});
	});

	describe('resetting a password', () =>
	{
		it('sets the new password, logs out every other browser, and emails the account', async () =>
		{
			const first = await register('ada@example.com', 'ada');
			const browser = new Browser();

			await forgetRateLimits();
			emails = [];
			await enterCode(browser, 'resetPassword', 'ada@example.com');

			const answer = await browser.send('POST', AUTH_PASSWORD_RESET_PATH, { password: 'a new passphrase', rememberMe: false, locale: 'en' });

			assert.strictEqual(answer.status, 204);
			assert.strictEqual(await browser.handle(), 'ada');
			assert.strictEqual(await first.handle(), null);
			await waitUntil(() => emails.some((email) => /password .* was changed/.test(email.subject)));
			assert.strictEqual((await new Browser().send('POST', AUTH_LOGIN_PATH, { email: 'ada@example.com', password: PASSWORD, rememberMe: false })).status, 401);
			assert.strictEqual((await new Browser().send('POST', AUTH_LOGIN_PATH, { email: 'ada@example.com', password: 'a new passphrase', rememberMe: false })).status, 204);
		});

		it('can\'t replay the code\'s next step', async () =>
		{
			await register('ada@example.com', 'ada');
			await forgetRateLimits();

			const browser = new Browser();

			await enterCode(browser, 'resetPassword', 'ada@example.com');

			const continuation = browser.cookies.get('__Host-kiln-continue');

			assert.strictEqual((await browser.send('POST', AUTH_PASSWORD_RESET_PATH, { password: 'a new passphrase', rememberMe: false, locale: 'en' })).status, 204);

			browser.cookies.set('__Host-kiln-continue', continuation ?? '');
			assert.strictEqual((await browser.send('POST', AUTH_PASSWORD_RESET_PATH, { password: 'another passphrase', rememberMe: false, locale: 'en' })).status, 403);
		});
	});

	describe('changing the email address', () =>
	{
		it('needs a login', async () =>
		{
			const answer = await new Browser().send('POST', AUTH_CODE_PATH, { purpose: 'changeEmail', email: 'new@example.com', locale: 'en' });

			assert.strictEqual(answer.status, 401);
		});

		it('changes it once the code sent to the new address is entered, telling both addresses', async () =>
		{
			const browser = await register('ada@example.com', 'ada');

			emails = [];
			await enterCode(browser, 'changeEmail', 'lovelace@example.com');

			const answer = await browser.send('POST', AUTH_EMAIL_CHANGE_PATH, { email: 'lovelace@example.com', locale: 'en' });

			assert.strictEqual(answer.status, 204);
			await waitUntil(() => (emails.filter((email) => /address .* was changed/.test(email.subject)).length === 2));
			assert.deepStrictEqual(emails.filter((email) => /address .* was changed/.test(email.subject)).map((email) => email.to).sort(), ['ada@example.com', 'lovelace@example.com']);
			assert.strictEqual((await new Browser().send('POST', AUTH_LOGIN_PATH, { email: 'lovelace@example.com', password: PASSWORD, rememberMe: false })).status, 204);
		});

		it('sends nothing to an address another account has', async () =>
		{
			const browser = await register('ada@example.com', 'ada');

			await register('grace@example.com', 'grace');
			await forgetRateLimits();
			emails = [];

			assert.strictEqual((await browser.send('POST', AUTH_CODE_PATH, { purpose: 'changeEmail', email: 'grace@example.com', locale: 'en' })).status, 204);
			assert.strictEqual(emails.length, 0);
		});

		it('doesn\'t let another account use the code', async () =>
		{
			const browser = await register('ada@example.com', 'ada');
			const grace = await register('grace@example.com', 'grace');

			await browser.send('POST', AUTH_CODE_PATH, { purpose: 'changeEmail', email: 'lovelace@example.com', locale: 'en' });

			const code = await codeSentTo('lovelace@example.com');

			assert.strictEqual((await grace.send('POST', AUTH_CODE_CHECK_PATH, { purpose: 'changeEmail', email: 'lovelace@example.com', code })).status, 400);
		});
	});

	it('refuses requests from browsers on other origins', async () =>
	{
		const response = await fetch(`${testServerUrl}${AUTH_LOGIN_PATH}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Origin': 'https://evil.example'
			},
			body: JSON.stringify({ email: 'ada@example.com', password: PASSWORD, rememberMe: false })
		});

		assert.strictEqual(response.status, 403);
		assert.strictEqual(response.headers.get('cache-control'), 'no-store');
	});
});
