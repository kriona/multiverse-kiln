import assert from 'assert';
import { AUTH_CODE_CHECK_PATH, AUTH_CODE_PATH, AUTH_LOGIN_PATH, AUTH_LOGOUT_PATH, AUTH_PROVIDER_CALLBACK_PATH, AUTH_PROVIDER_LINK_PATH, AUTH_PROVIDER_REGISTER_PATH, AUTH_PROVIDER_START_PATH, AUTH_PROVIDERS_PATH, type AuthErrorPayload, type LoginProvider, type ProviderCallbackPayload, type ProvidersPayload, type ProviderStartPayload } from '@multiverse-kiln/shared';

import { hashPassword } from '../src/auth/passwords.js';
import { ProviderLoginError, setProviderClients, type ProviderClient, type ProviderUser } from '../src/auth/providers.js';
import { pool } from '../src/db/client.js';
import { createPlayer } from '../src/db/playerRepo.js';
import { setEmailSender, type Email } from '../src/email/mailer.js';
import { PROVIDER_LOGIN_COOKIE, PROVIDER_START_COOKIE } from '../src/http/cookies.js';
import { Browser } from './browser.js';
import { getTestServer } from './testServer.js';
import { authenticatorCode, turnOnTwoFactor } from './twoFactorAccounts.js';
import { waitUntil } from './waitUntil.js';

const PASSWORD = 'correct horse battery staple';

/**
 * Codes that make the fake providers fail, as a provider can
 */
const REFUSED_CODE = 'refused';
const UNAVAILABLE_CODE = 'unavailable';

/**
 * Ada as Google knows her
 */
const GOOGLE_ADA: ProviderUser = {
	providerUserId: 'google-ada',
	email: 'ada@example.com',
	emailVerified: true,
	displayName: 'Ada Lovelace'
};

describe('provider login routes', () =>
{
	let emails: Email[];

	/**
	 * The player each code the fake providers hand out logs in, and the PKCE secret each state started with
	 */
	const users = new Map<string, ProviderUser>();
	const verifiers = new Map<string, string>();
	let codes = 0;

	/**
	 * A provider that sends the browser back with a code for whichever player the test chose
	 *
	 * @param provider The provider
	 * @return Its client
	 */
	function fakeClient(provider: LoginProvider): ProviderClient
	{
		return({
			authorizationUrl: (state, codeVerifier) =>
			{
				verifiers.set(state, codeVerifier);

				const url = new URL(`https://${provider}.example/authorize`);

				url.searchParams.set('state', state);

				return(url);
			},
			fetchUser: (code, codeVerifier) =>
			{
				if (code === REFUSED_CODE)
				{
					return(Promise.reject(new ProviderLoginError('refused', new Error('invalid_grant'))));
				}

				if (code === UNAVAILABLE_CODE)
				{
					return(Promise.reject(new ProviderLoginError('unavailable', new Error('timed out'))));
				}

				const [state, user] = [code.split(':')[0], users.get(code)];

				// The code is only good with the secret its login started with
				if (!user || (verifiers.get(state) !== codeVerifier))
				{
					return(Promise.reject(new ProviderLoginError('refused', new Error('invalid_grant'))));
				}

				return(Promise.resolve(user));
			}
		});
	}

	/**
	 * Starts a login with a provider from a browser
	 *
	 * @param browser The browser
	 * @param provider The provider
	 * @param rememberMe Whether the player checked Remember me
	 * @param link Whether it links the provider login to the account the browser is logged in to
	 * @return The state the provider sends back
	 */
	async function startLogin(browser: Browser, provider: LoginProvider, rememberMe: boolean = false, link: boolean = false): Promise<string>
	{
		const answer = await browser.send<ProviderStartPayload>('POST', AUTH_PROVIDER_START_PATH, { provider, rememberMe, link });

		assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));

		const state = new URL(answer.body.url).searchParams.get('state');

		assert.ok(state);

		return(state);
	}

	/**
	 * Logs in with a provider from a browser, as a player, coming back with a code for them
	 *
	 * @param browser The browser
	 * @param user The player as the provider knows them
	 * @param provider The provider
	 * @param rememberMe Whether the player checked Remember me
	 * @return The callback's answer
	 */
	async function logInWith(browser: Browser, user: ProviderUser, provider: LoginProvider = 'google', rememberMe: boolean = false): Promise<{ status: number; body: ProviderCallbackPayload & AuthErrorPayload }>
	{
		const state = await startLogin(browser, provider, rememberMe);

		return(comeBack(browser, user, state));
	}

	/**
	 * Comes back from a provider to a browser, with a code for a player
	 *
	 * @param browser The browser
	 * @param user The player as the provider knows them
	 * @param state The state the login started with
	 * @return The callback's answer
	 */
	function comeBack(browser: Browser, user: ProviderUser, state: string): Promise<{ status: number; body: ProviderCallbackPayload & AuthErrorPayload }>
	{
		const code = `${state}:${++codes}`;

		users.set(code, user);

		return(browser.send('POST', AUTH_PROVIDER_CALLBACK_PATH, { code, state, locale: 'en' }));
	}

	/**
	 * Links a provider login to the account a browser is logged in to, as the profile does
	 *
	 * @param browser The browser
	 * @param user The player as the provider knows them
	 * @param provider The provider
	 * @return The callback's answer
	 */
	async function linkFromProfile(browser: Browser, user: ProviderUser, provider: LoginProvider = 'google'): Promise<{ status: number; body: ProviderCallbackPayload & AuthErrorPayload }>
	{
		return(comeBack(browser, user, await startLogin(browser, provider, false, true)));
	}

	/**
	 * Logs a browser in to a local account with its password
	 *
	 * @param email The account's address
	 * @return The browser
	 */
	async function logInWithPassword(email: string): Promise<Browser>
	{
		const browser = new Browser();

		assert.strictEqual((await browser.send('POST', AUTH_LOGIN_PATH, { email, password: PASSWORD, rememberMe: false })).status, 200);

		return(browser);
	}

	/**
	 * Makes a local account
	 *
	 * @param email Its address
	 * @param username Its username
	 * @param withPassword Whether it has a password
	 * @return Its ID
	 */
	async function addLocalAccount(email: string, username: string, withPassword: boolean = true): Promise<string>
	{
		return((await createPlayer({
			username,
			displayName: username,
			email,
			passwordHash: (withPassword ? await hashPassword(PASSWORD) : null)
		})).id);
	}

	/**
	 * The kinds of an account's auth events, oldest first, and those at the same time in the order
	 * AUTH_EVENT_KINDS lists them
	 *
	 * @param username The account's username
	 * @return The kinds
	 */
	async function eventKinds(username: string): Promise<string[]>
	{
		const result = await pool.query<{ kind: string }>('SELECT e.kind FROM auth_events e JOIN players p ON p.id = e.player_id WHERE p.username = $1 ORDER BY e.occurred_at, e.kind', [username]);

		return(result.rows.map((row) => row.kind));
	}

	before(async () =>
	{
		await getTestServer();
		setProviderClients({
			google: fakeClient('google'),
			discord: fakeClient('discord')
		});
	});

	after(() =>
	{
		setProviderClients(undefined);
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

	it('lists the providers the site offers, and only starts logins with those', async () =>
	{
		setProviderClients({ discord: fakeClient('discord') });

		try
		{
			const browser = new Browser();

			assert.deepStrictEqual((await browser.send<ProvidersPayload>('GET', AUTH_PROVIDERS_PATH)).body, { providers: ['discord'] });
			assert.strictEqual((await browser.send('POST', AUTH_PROVIDER_START_PATH, { provider: 'google', rememberMe: false, link: false })).status, 404);
			assert.strictEqual((await browser.send('POST', AUTH_PROVIDER_START_PATH, { provider: 'github', rememberMe: false, link: false })).status, 400);
		}
		finally
		{
			setProviderClients({
				google: fakeClient('google'),
				discord: fakeClient('discord')
			});
		}
	});

	it('creates an account for a new login once the player chooses a username, and logs straight in after', async () =>
	{
		const browser = new Browser();
		const callback = await logInWith(browser, GOOGLE_ADA, 'google', true);

		assert.strictEqual(callback.status, 200, JSON.stringify(callback.body));
		assert.deepStrictEqual(callback.body, {
			outcome: 'register',
			provider: 'google',
			email: 'ada@example.com',
			displayName: 'Ada Lovelace'
		});
		assert.ok(!browser.cookies.has(PROVIDER_START_COOKIE));
		assert.ok(browser.cookies.has(PROVIDER_LOGIN_COOKIE));
		assert.strictEqual(await browser.username(), null);

		const registered = await browser.send('POST', AUTH_PROVIDER_REGISTER_PATH, { username: 'ada', displayName: 'Ada', locale: 'en' });

		assert.strictEqual(registered.status, 204, JSON.stringify(registered.body));
		assert.strictEqual(await browser.username(), 'ada');
		assert.ok(!browser.cookies.has(PROVIDER_LOGIN_COOKIE));

		const account = await pool.query('SELECT email, password_hash FROM players WHERE username = $1', ['ada']);

		assert.deepStrictEqual(account.rows, [{ email: 'ada@example.com', password_hash: null }]);
		assert.deepStrictEqual((await pool.query('SELECT remember_me FROM sessions')).rows, [{ remember_me: true }]);
		await waitUntil(() => (emails.length === 1));
		assert.strictEqual(emails[0].to, 'ada@example.com');
		assert.match(emails[0].subject, /Welcome/);

		const other = new Browser();

		assert.deepStrictEqual((await logInWith(other, GOOGLE_ADA)).body, { outcome: 'loggedIn' });
		assert.strictEqual(await other.username(), 'ada');
		assert.ok(!other.cookies.has(PROVIDER_LOGIN_COOKIE));
		assert.deepStrictEqual(await eventKinds('ada'), ['registered', 'loggedIn', 'loggedIn']);
	});

	it('finishes a login only in the browser that started it, once, with the state it was given', async () =>
	{
		const browser = new Browser();
		const state = await startLogin(browser, 'google');
		const code = `${state}:${++codes}`;

		users.set(code, GOOGLE_ADA);

		assert.strictEqual((await new Browser().send('POST', AUTH_PROVIDER_CALLBACK_PATH, { code, state, locale: 'en' })).status, 400);
		assert.strictEqual((await browser.send('POST', AUTH_PROVIDER_CALLBACK_PATH, { code, state: `${state}x`, locale: 'en' })).status, 400);

		// The wrong state used up the start
		assert.strictEqual((await browser.send('POST', AUTH_PROVIDER_CALLBACK_PATH, { code, state, locale: 'en' })).status, 400);
		assert.strictEqual((await pool.query('SELECT * FROM pending_provider_logins')).rowCount, 0);
	});

	it('says why a provider didn\'t log the player in', async () =>
	{
		const browser = new Browser();

		for (const [code, status] of [[REFUSED_CODE, 400], [UNAVAILABLE_CODE, 502]] as const)
		{
			const state = await startLogin(browser, 'discord');
			const answer = await browser.send('POST', AUTH_PROVIDER_CALLBACK_PATH, { code, state, locale: 'en' });

			assert.strictEqual(answer.status, status);
			assert.match(answer.body.error.defaultMessage, /\{provider\}/);
			assert.strictEqual(answer.body.error.values?.provider, 'Discord');
		}

		const unverified = await logInWith(browser, {
			...GOOGLE_ADA,
			emailVerified: false
		});

		assert.strictEqual(unverified.status, 400);
		assert.match(unverified.body.error.defaultMessage, /no verified email/);
		assert.strictEqual((await logInWith(browser, {
			...GOOGLE_ADA,
			email: null
		})).status, 400);
		assert.strictEqual((await pool.query('SELECT * FROM pending_provider_logins')).rowCount, 0);
	});

	it('creates an account only from the browser that came back from the provider, in time', async () =>
	{
		const browser = new Browser();

		await logInWith(browser, GOOGLE_ADA);

		const register = (from: Browser, username: string): Promise<{ status: number; body: AuthErrorPayload }> => from.send('POST', AUTH_PROVIDER_REGISTER_PATH, { username, displayName: 'Ada', locale: 'en' });

		assert.strictEqual((await register(new Browser(), 'ada')).status, 403);

		await addLocalAccount('grace@example.com', 'grace');

		const taken = await register(browser, 'GRACE');

		assert.strictEqual(taken.status, 409);
		assert.strictEqual(taken.body.field, 'username');
		assert.strictEqual((await register(browser, 'a')).body.field, 'username');

		await pool.query('UPDATE pending_provider_logins SET expires_at = now() - interval \'1 minute\'');
		assert.strictEqual((await register(browser, 'ada')).status, 403);
		assert.strictEqual((await pool.query('SELECT * FROM players WHERE username = $1', ['ada'])).rowCount, 0);
	});

	it('links a login to the local account with its address once the player gives its password', async () =>
	{
		await addLocalAccount('ADA@example.com', 'ada');

		const browser = new Browser();
		const callback = await logInWith(browser, GOOGLE_ADA, 'google', true);

		assert.deepStrictEqual(callback.body, {
			outcome: 'link',
			provider: 'google',
			email: 'ada@example.com',
			hasPassword: true,
			twoFactor: false
		});

		// Choosing a username would make a second account with the address
		assert.strictEqual((await browser.send('POST', AUTH_PROVIDER_REGISTER_PATH, { username: 'ada2', displayName: 'Ada', locale: 'en' })).status, 403);

		const wrong = await browser.send('POST', AUTH_PROVIDER_LINK_PATH, { password: 'not the password at all', locale: 'en', twoFactorCode: null });

		assert.strictEqual(wrong.status, 401);
		assert.strictEqual(wrong.body.field, 'password');
		assert.strictEqual(await browser.username(), null);

		assert.strictEqual((await browser.send('POST', AUTH_PROVIDER_LINK_PATH, { password: PASSWORD, locale: 'en', twoFactorCode: null })).status, 204);
		assert.strictEqual(await browser.username(), 'ada');
		assert.deepStrictEqual((await pool.query('SELECT remember_me FROM sessions')).rows, [{ remember_me: true }]);
		await waitUntil(() => (emails.length === 1));
		assert.strictEqual(emails[0].to, 'ADA@example.com');
		assert.match(emails[0].subject, /log in to .* with Google/);
		assert.deepStrictEqual(await eventKinds('ada'), ['loginFailed', 'loggedIn', 'providerLinked']);

		const other = new Browser();

		assert.deepStrictEqual((await logInWith(other, GOOGLE_ADA)).body, { outcome: 'loggedIn' });
		assert.strictEqual(await other.username(), 'ada');
	});

	it('links a login to an account without a password with a code sent to its address', async () =>
	{
		await addLocalAccount('ada@example.com', 'ada', false);

		const browser = new Browser();
		const callback = await logInWith(browser, GOOGLE_ADA, 'discord');

		assert.strictEqual(callback.body.outcome, 'link');
		assert.strictEqual((callback.body.outcome === 'link') && callback.body.hasPassword, false);

		// A code is no use without entering it, and a password never matches an account without one
		assert.strictEqual((await browser.send('POST', AUTH_PROVIDER_LINK_PATH, { password: null, locale: 'en', twoFactorCode: null })).status, 403);
		assert.strictEqual((await browser.send('POST', AUTH_PROVIDER_LINK_PATH, { password: PASSWORD, locale: 'en', twoFactorCode: null })).status, 401);

		assert.strictEqual((await browser.send('POST', AUTH_CODE_PATH, { purpose: 'linkLogin', email: 'ada@example.com', locale: 'en' })).status, 204);
		await waitUntil(() => (emails.length === 1));

		const code = /\r\n\r\n([0-9A-Z]{6})\r\n\r\n/.exec(emails[0].text)?.[1];

		assert.ok(code);
		assert.match(emails[0].subject, /link a login/);
		assert.strictEqual((await browser.send('POST', AUTH_CODE_CHECK_PATH, { purpose: 'linkLogin', email: 'ada@example.com', code })).status, 200);
		assert.strictEqual((await browser.send('POST', AUTH_PROVIDER_LINK_PATH, { password: null, locale: 'en', twoFactorCode: null })).status, 204);
		assert.strictEqual(await browser.username(), 'ada');
		assert.strictEqual((await pool.query('SELECT * FROM email_codes')).rowCount, 0);
		assert.deepStrictEqual((await pool.query('SELECT provider FROM provider_logins')).rows, [{ provider: 'discord' }]);
	});

	it('needs the authenticator code of an account with 2FA to link to it', async () =>
	{
		const authenticator = await turnOnTwoFactor(await addLocalAccount('ada@example.com', 'ada'));
		const browser = new Browser();
		const callback = await logInWith(browser, GOOGLE_ADA);

		assert.strictEqual((callback.body.outcome === 'link') && callback.body.twoFactor, true);

		const missing = await browser.send('POST', AUTH_PROVIDER_LINK_PATH, { password: PASSWORD, locale: 'en', twoFactorCode: null });

		assert.strictEqual(missing.status, 401);
		assert.strictEqual(missing.body.field, 'twoFactorCode');
		assert.strictEqual((await pool.query('SELECT * FROM provider_logins')).rowCount, 0);

		// An emailed code isn't enough either
		assert.strictEqual((await browser.send('POST', AUTH_CODE_PATH, { purpose: 'linkLogin', email: 'ada@example.com', locale: 'en' })).status, 204);
		await waitUntil(() => (emails.length === 1));

		const code = /\r\n\r\n([0-9A-Z]{6})\r\n\r\n/.exec(emails[0].text)?.[1];

		assert.strictEqual((await browser.send('POST', AUTH_CODE_CHECK_PATH, { purpose: 'linkLogin', email: 'ada@example.com', code })).status, 200);
		assert.strictEqual((await browser.send('POST', AUTH_PROVIDER_LINK_PATH, { password: null, locale: 'en', twoFactorCode: null })).status, 401);
		assert.strictEqual((await browser.send('POST', AUTH_PROVIDER_LINK_PATH, { password: null, locale: 'en', twoFactorCode: authenticatorCode(authenticator.secret) })).status, 204);
		assert.strictEqual(await browser.username(), 'ada');
		assert.deepStrictEqual((await pool.query('SELECT provider FROM provider_logins')).rows, [{ provider: 'google' }]);
	});

	it('sends a link code only to the account a browser\'s provider login would link to', async () =>
	{
		await addLocalAccount('ada@example.com', 'ada');
		await addLocalAccount('grace@example.com', 'grace');

		assert.strictEqual((await new Browser().send('POST', AUTH_CODE_PATH, { purpose: 'linkLogin', email: 'ada@example.com', locale: 'en' })).status, 204);

		const browser = new Browser();

		await logInWith(browser, GOOGLE_ADA);
		assert.strictEqual((await browser.send('POST', AUTH_CODE_PATH, { purpose: 'linkLogin', email: 'grace@example.com', locale: 'en' })).status, 204);
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.strictEqual(emails.length, 0);
		assert.strictEqual((await pool.query('SELECT * FROM email_codes')).rowCount, 0);
	});

	it('refuses to link a second login with one provider to an account', async () =>
	{
		await addLocalAccount('ada@example.com', 'ada');

		const first = new Browser();

		await logInWith(first, GOOGLE_ADA);
		assert.strictEqual((await first.send('POST', AUTH_PROVIDER_LINK_PATH, { password: PASSWORD, locale: 'en', twoFactorCode: null })).status, 204);

		const second = new Browser();

		await logInWith(second, {
			...GOOGLE_ADA,
			providerUserId: 'google-ada-work'
		});

		const refused = await second.send('POST', AUTH_PROVIDER_LINK_PATH, { password: PASSWORD, locale: 'en', twoFactorCode: null });

		assert.strictEqual(refused.status, 409);
		assert.strictEqual(refused.body.error.values?.provider, 'Google');
		assert.strictEqual(await second.username(), null);
	});

	it('links a login from the profile to the account the browser is logged in to, whatever its address', async () =>
	{
		await addLocalAccount('ada@example.com', 'ada');

		const browser = await logInWithPassword('ada@example.com');
		const discordAda: ProviderUser = {
			providerUserId: 'discord-ada',
			email: 'countess@example.org',
			emailVerified: true,
			displayName: 'Ada'
		};

		// A login that could never log in isn't linked
		assert.strictEqual((await linkFromProfile(browser, {
			...discordAda,
			emailVerified: false
		}, 'discord')).status, 400);

		const linked = await linkFromProfile(browser, discordAda, 'discord');

		assert.strictEqual(linked.status, 200, JSON.stringify(linked.body));
		assert.deepStrictEqual(linked.body, {
			outcome: 'linked',
			provider: 'discord'
		});
		assert.ok(!browser.cookies.has(PROVIDER_LOGIN_COOKIE));
		assert.strictEqual(await browser.username(), 'ada');
		await waitUntil(() => (emails.length === 1));
		assert.strictEqual(emails[0].to, 'ada@example.com');
		assert.match(emails[0].subject, /log in to .* with Discord/);
		assert.deepStrictEqual(await eventKinds('ada'), ['loggedIn', 'providerLinked']);

		// Linking it again changes nothing, and tells no one
		assert.deepStrictEqual((await linkFromProfile(browser, discordAda, 'discord')).body, {
			outcome: 'linked',
			provider: 'discord'
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.strictEqual(emails.length, 1);

		const other = new Browser();

		assert.deepStrictEqual((await logInWith(other, discordAda, 'discord')).body, { outcome: 'loggedIn' });
		assert.strictEqual(await other.username(), 'ada');
	});

	it('links from the profile only while the browser is logged in to the account it started from', async () =>
	{
		await addLocalAccount('ada@example.com', 'ada');
		await addLocalAccount('grace@example.com', 'grace');

		assert.strictEqual((await new Browser().send('POST', AUTH_PROVIDER_START_PATH, { provider: 'google', rememberMe: false, link: true })).status, 401);

		const loggedOut = await logInWithPassword('ada@example.com');
		const loggedOutState = await startLogin(loggedOut, 'google', false, true);

		assert.strictEqual((await loggedOut.send('POST', AUTH_LOGOUT_PATH)).status, 204);
		assert.strictEqual((await comeBack(loggedOut, GOOGLE_ADA, loggedOutState)).status, 401);

		// Logging in to another account while at the provider doesn't link the login to it
		const switched = await logInWithPassword('ada@example.com');
		const switchedState = await startLogin(switched, 'google', false, true);

		assert.strictEqual((await switched.send('POST', AUTH_LOGIN_PATH, { email: 'grace@example.com', password: PASSWORD, rememberMe: false })).status, 200);
		assert.strictEqual((await comeBack(switched, GOOGLE_ADA, switchedState)).status, 401);
		assert.strictEqual((await pool.query('SELECT * FROM provider_logins')).rowCount, 0);
	});

	it('refuses to link from the profile a login another account has, or a second one with a provider', async () =>
	{
		await addLocalAccount('grace@example.com', 'grace');

		const graceBrowser = await logInWithPassword('grace@example.com');

		assert.strictEqual((await linkFromProfile(graceBrowser, GOOGLE_ADA)).status, 200);

		await addLocalAccount('ada@example.com', 'ada');

		const browser = await logInWithPassword('ada@example.com');
		const taken = await linkFromProfile(browser, GOOGLE_ADA);

		assert.strictEqual(taken.status, 409);
		assert.match(taken.body.error.defaultMessage, /another account/);

		assert.strictEqual((await linkFromProfile(browser, {
			...GOOGLE_ADA,
			providerUserId: 'google-ada-home'
		})).status, 200);

		const second = await linkFromProfile(browser, {
			...GOOGLE_ADA,
			providerUserId: 'google-ada-work'
		});

		assert.strictEqual(second.status, 409);
		assert.strictEqual(second.body.error.id, 'error.auth.providerOtherLoginLinked');
		assert.deepStrictEqual((await pool.query('SELECT provider_user_id FROM provider_logins ORDER BY provider_user_id')).rows, [{ provider_user_id: 'google-ada' }, { provider_user_id: 'google-ada-home' }]);
	});
});
