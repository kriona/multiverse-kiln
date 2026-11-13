import assert from 'assert';
import { AUTH_CODE_PATH, AUTH_LOGIN_PATH, AUTH_PASSWORD_CHANGE_PATH, BOT_CHECK_MESSAGES, isBotCheckNeeded, type BotCheckAction } from '@multiverse-kiln/shared';

import { hashAddress } from '../src/auth/keyedHashes.js';
import { hashPassword } from '../src/auth/passwords.js';
import { setPwnedRangeFetch } from '../src/auth/pwnedPasswords.js';
import { setBotCheckVerifier, type BotCheckVerifier, type TokenOutcome } from '../src/auth/turnstile.js';
import { adminDb } from '../src/db/adminClient.js';
import { pool } from '../src/db/client.js';
import { createPlayer } from '../src/db/playerRepo.js';
import { findSiteSettings, saveSiteSettings } from '../src/db/siteSettingsRepo.js';
import { setEmailSender, type Email } from '../src/email/mailer.js';
import { CODE_CHECK_FROM_ADDRESS_SEND, LOGIN_CHECK_FROM_ADDRESS_ATTEMPT, MAX_CHECKED_CODES_PER_ADDRESS_HOUR, MAX_CHECKED_CODES_PER_BLOCKED_ADDRESS_DAY, MAX_CHECKED_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR, MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR } from '../src/logic/botChecks.js';
import { MAX_EMAIL_CODES_PER_ADDRESS_HOUR, MAX_WRONG_GUESSES_PER_ADDRESS_DAY } from '../src/logic/emailCodes.js';
import { Browser } from './browser.js';
import { discardEmail } from './setup.js';
import { getTestServer } from './testServer.js';
import { waitUntil } from './waitUntil.js';

const PASSWORD = 'correct horse battery staple';
const SITE_KEY = 'site-key-for-tests';

/**
 * A stand-in for Cloudflare: a token passes when it is 'pass-' and its action, and Cloudflare can be made
 * unreachable
 */
class StubVerifier implements BotCheckVerifier
{
	siteKey: string | undefined = SITE_KEY;
	reachable = true;
	readonly verified: string[] = [];

	available(): boolean
	{
		return((this.siteKey !== undefined) && this.reachable);
	}

	reachedRecently(): boolean
	{
		return(false);
	}

	confirmAvailable(): Promise<boolean>
	{
		return(Promise.resolve(this.available()));
	}

	verify(token: string, action: BotCheckAction): Promise<TokenOutcome>
	{
		this.verified.push(token);

		if (!this.available())
		{
			return(Promise.resolve('unreachable'));
		}

		return(Promise.resolve(((token === `pass-${action}`) ? 'passed' : 'failed')));
	}
}

describe('bot checks', () =>
{
	let verifier: StubVerifier;
	let emails: Email[];

	/**
	 * Tries logging in to Ada's account
	 *
	 * @param browser The browser
	 * @param password The password typed
	 * @param botCheckToken The check's token, if any
	 * @return The answer
	 */
	function logIn(browser: Browser, password: string, botCheckToken?: string): Promise<{ status: number; body: unknown }>
	{
		return(browser.send<unknown>('POST', AUTH_LOGIN_PATH, {
			email: 'ada@example.com',
			password,
			rememberMe: false,
			locale: 'en',
			botCheckToken
		}));
	}

	/**
	 * Asks for a code to reset the password of an address
	 *
	 * @param email The address
	 * @param botCheckToken The check's token, if any
	 * @return The answer
	 */
	function sendCode(email: string, botCheckToken?: string): Promise<{ status: number; body: unknown }>
	{
		return(new Browser().send<unknown>('POST', AUTH_CODE_PATH, {
			purpose: 'resetPassword',
			email,
			locale: 'en',
			botCheckToken
		}));
	}

	/**
	 * Records attempts against a limit as if they were made some minutes ago
	 *
	 * @param kind The rate limit's kind
	 * @param email The address they were for
	 * @param count How many
	 * @param minutesAgo How long ago
	 */
	async function pastAttempts(kind: string, email: string, count: number, minutesAgo = 10): Promise<void>
	{
		for (let attempt = 0; attempt < count; attempt++)
		{
			await pool.query('INSERT INTO rate_limit_events (kind, subject_hash, occurred_at) VALUES ($1, $2, $3)', [kind, hashAddress(email), new Date(Date.now() - (minutesAgo * 60000) - attempt)]);
		}
	}

	/**
	 * The kinds of the bot check auth events, oldest first, and whether each names an account
	 *
	 * @return The events
	 */
	async function checkEvents(): Promise<string[]>
	{
		const result = await pool.query<{ kind: string; named: boolean }>('SELECT kind, (player_id IS NOT NULL) AS named FROM auth_events WHERE kind::text LIKE \'botCheck%\' ORDER BY occurred_at, kind');

		return(result.rows.map((row) => `${row.kind}${row.named ? '' : ' (no account)'}`));
	}

	/**
	 * Asserts an answer asks for a check
	 *
	 * @param answer The answer
	 * @param action The action it should name
	 */
	function assertCheckNeeded(answer: { status: number; body: unknown }, action: BotCheckAction): void
	{
		assert.strictEqual(answer.status, 403, JSON.stringify(answer.body));
		assert.ok(isBotCheckNeeded(answer.body));

		const { error, botCheck } = answer.body;

		assert.strictEqual(error.id, BOT_CHECK_MESSAGES.needed.id);
		assert.deepStrictEqual(botCheck, {
			siteKey: SITE_KEY,
			action
		});
	}

	before(async () =>
	{
		await getTestServer();

		// No password is breached
		setPwnedRangeFetch(() => Promise.resolve(new Response('')));
	});

	beforeEach(async () =>
	{
		verifier = new StubVerifier();
		setBotCheckVerifier(verifier);
		emails = [];
		setEmailSender((email) =>
		{
			emails.push(email);
			return(Promise.resolve());
		});
		await createPlayer({
			username: 'ada',
			displayName: 'Ada',
			email: 'ada@example.com',
			passwordHash: await hashPassword(PASSWORD)
		});
	});

	afterEach(() =>
	{
		setBotCheckVerifier(undefined);
	});

	after(() =>
	{
		setPwnedRangeFetch(undefined);
		setEmailSender(discardEmail);
	});

	describe('logging in', () =>
	{
		it('asks for a check from the address\'s soft limit, and takes the try with one', async () =>
		{
			for (let attempt = 1; attempt < LOGIN_CHECK_FROM_ADDRESS_ATTEMPT; attempt++)
			{
				assert.strictEqual((await logIn(new Browser(), 'guess')).status, 401);
			}

			assertCheckNeeded(await logIn(new Browser(), PASSWORD), 'login');
			assertCheckNeeded(await logIn(new Browser(), PASSWORD, 'pass-email-code'), 'login');
			assert.strictEqual((await logIn(new Browser(), PASSWORD, 'pass-login')).status, 200);
			assert.deepStrictEqual(await checkEvents(), ['botCheckAsked', 'botCheckAsked', 'botCheckFailed', 'botCheckPassed']);
		});

		it('doesn\'t count tries refused for want of a check against the address, so a bot can\'t use up its tries', async () =>
		{
			for (let attempt = 1; attempt < LOGIN_CHECK_FROM_ADDRESS_ATTEMPT; attempt++)
			{
				await logIn(new Browser(), 'guess');
			}

			for (let attempt = 0; attempt < 20; attempt++)
			{
				assertCheckNeeded(await logIn(new Browser(), 'guess'), 'login');
			}

			for (let attempt = LOGIN_CHECK_FROM_ADDRESS_ATTEMPT; attempt <= MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR; attempt++)
			{
				assert.strictEqual((await logIn(new Browser(), 'guess', 'pass-login')).status, 401);
			}

			// Each refused try counted against the network, which now asks for a check too
			assert.strictEqual((await pool.query('SELECT 1 FROM rate_limit_events WHERE kind = \'networkLoginAttempt\'')).rowCount, 30);
		});

		it('lets tries with a check through past the address\'s hard limit, up to their own limit', async () =>
		{
			await pastAttempts('addressLoginAttempt', 'ada@example.com', MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR);
			assertCheckNeeded(await logIn(new Browser(), PASSWORD), 'login');
			assert.strictEqual((await logIn(new Browser(), PASSWORD, 'pass-login')).status, 200);

			for (let attempt = 1; attempt < MAX_CHECKED_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR; attempt++)
			{
				assert.strictEqual((await logIn(new Browser(), 'guess', 'pass-login')).status, 401);
			}

			assert.strictEqual((await logIn(new Browser(), PASSWORD, 'pass-login')).status, 429);
		});

		it('never asks a browser that has logged in to the account', async () =>
		{
			const ada = new Browser();

			assert.strictEqual((await logIn(ada, PASSWORD)).status, 200);
			await pastAttempts('addressLoginAttempt', 'ada@example.com', MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR);
			assert.strictEqual((await logIn(ada, PASSWORD)).status, 200);
		});

		it('answers the same for an address without an account, naming no account in its events', async () =>
		{
			await pastAttempts('addressLoginAttempt', 'nobody@example.com', LOGIN_CHECK_FROM_ADDRESS_ATTEMPT - 1);

			const answer = await new Browser().send<unknown>('POST', AUTH_LOGIN_PATH, {
				email: 'nobody@example.com',
				password: PASSWORD,
				rememberMe: false,
				locale: 'en',
				botCheckToken: 'wrong'
			});

			assertCheckNeeded(answer, 'login');
			assert.deepStrictEqual(await checkEvents(), ['botCheckAsked (no account)', 'botCheckFailed (no account)']);
		});

		it('checks nothing while checks aren\'t configured or Cloudflare can\'t be reached, refusing at the hard limit as before', async () =>
		{
			for (const turnOff of [() => (verifier.siteKey = undefined), () => (verifier.reachable = false)])
			{
				await pool.query('DELETE FROM rate_limit_events');
				turnOff();

				for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS_PER_ADDRESS_HOUR; attempt++)
				{
					assert.strictEqual((await logIn(new Browser(), 'guess', 'pass-login')).status, 401);
				}

				assert.strictEqual((await logIn(new Browser(), PASSWORD, 'pass-login')).status, 429);
			}

			assert.deepStrictEqual(await checkEvents(), []);
		});

		it('asks for a check at every login while the admin setting is on, except from a browser that has logged in', async () =>
		{
			const ada = new Browser();

			assert.strictEqual((await logIn(ada, PASSWORD)).status, 200);
			await saveSiteSettings({
				...await findSiteSettings(),
				botCheckEveryRequest: true
			}, adminDb);

			assertCheckNeeded(await logIn(new Browser(), PASSWORD), 'login');
			assert.strictEqual((await logIn(ada, PASSWORD)).status, 200);
			assertCheckNeeded(await sendCode('ada@example.com'), 'email-code');

			// Nothing is checked while checks are off, whatever the setting says
			verifier.reachable = false;
			assert.strictEqual((await logIn(new Browser(), PASSWORD)).status, 200);
		});
	});

	describe('a logged-in player\'s password', () =>
	{
		it('asks for a check once others\' guesses pass the address\'s soft limit, but not for the admin setting', async () =>
		{
			const ada = new Browser();
			const change = (botCheckToken?: string): Promise<{ status: number; body: unknown }> => ada.send<unknown>('POST', AUTH_PASSWORD_CHANGE_PATH, {
				currentPassword: PASSWORD,
				newPassword: 'a new passphrase for ada',
				locale: 'en',
				botCheckToken
			});

			assert.strictEqual((await logIn(ada, PASSWORD)).status, 200);
			await saveSiteSettings({
				...await findSiteSettings(),
				botCheckEveryRequest: true
			}, adminDb);
			await pool.query('DELETE FROM rate_limit_events');
			await pastAttempts('addressLoginAttempt', 'ada@example.com', LOGIN_CHECK_FROM_ADDRESS_ATTEMPT - 1);

			assertCheckNeeded(await change(), 'password');
			assertCheckNeeded(await change('pass-login'), 'password');
			assert.strictEqual((await change('pass-password')).status, 204);
		});
	});

	describe('sending email codes', () =>
	{
		it('asks for a check from the address\'s soft limit, and sends the code with one', async () =>
		{
			await pastAttempts('addressCodeSent', 'ada@example.com', CODE_CHECK_FROM_ADDRESS_SEND - 1);
			assertCheckNeeded(await sendCode('ada@example.com'), 'email-code');
			assert.deepStrictEqual(emails, []);
			assert.strictEqual((await sendCode('ada@example.com', 'pass-email-code')).status, 204);
			await waitUntil(() => (emails.length === 1));
		});

		it('sends a few more codes past the address\'s hourly limit with a check each', async () =>
		{
			await pastAttempts('addressCodeSent', 'nobody@example.com', MAX_EMAIL_CODES_PER_ADDRESS_HOUR);
			assertCheckNeeded(await sendCode('nobody@example.com'), 'email-code');
			assert.strictEqual((await sendCode('nobody@example.com', 'pass-email-code')).status, 204);

			// Still one a minute
			assert.strictEqual((await sendCode('nobody@example.com', 'pass-email-code')).status, 429);

			await pool.query('UPDATE rate_limit_events SET occurred_at = occurred_at - interval \'2 minutes\' WHERE kind = \'addressCheckedCodeSent\'');
			await pastAttempts('addressCheckedCodeSent', 'nobody@example.com', MAX_CHECKED_CODES_PER_ADDRESS_HOUR - 1);
			assert.strictEqual((await sendCode('nobody@example.com', 'pass-email-code')).status, 429);
		});

		it('sends a player whose codes others\' wrong guesses blocked a few more codes with a check each', async () =>
		{
			await pastAttempts('addressWrongGuess', 'ada@example.com', MAX_WRONG_GUESSES_PER_ADDRESS_DAY);
			verifier.reachable = false;
			assert.strictEqual((await sendCode('ada@example.com', 'pass-email-code')).status, 429);

			verifier.reachable = true;
			assertCheckNeeded(await sendCode('ada@example.com'), 'email-code');
			assert.strictEqual((await sendCode('ada@example.com', 'pass-email-code')).status, 204);
			await waitUntil(() => (emails.length === 1));

			await pastAttempts('addressCheckedCodeWhileBlocked', 'ada@example.com', MAX_CHECKED_CODES_PER_BLOCKED_ADDRESS_DAY - 1, 120);
			await pool.query('UPDATE rate_limit_events SET occurred_at = occurred_at - interval \'2 minutes\'');
			assert.strictEqual((await sendCode('ada@example.com', 'pass-email-code')).status, 429);
		});
	});
});
