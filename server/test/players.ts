/**
 * Players and logged-in browsers for tests
 */
import { createToken, hashToken } from '../src/auth/tokens.js';
import { createPlayer, findPlayerByHandle, type PlayerProfile } from '../src/db/playerRepo.js';
import { createSession } from '../src/db/sessionRepo.js';
import { SESSION_COOKIE } from '../src/http/cookies.js';

/**
 * A handle made from a name: its letters, digits and underscores, with other characters as
 * underscores, padded or cut to a length handles allow
 *
 * @param name The name
 * @return The handle
 */
export function handleFor(name: string): string
{
	return(name
		.replace(/[^A-Za-z0-9_]/g, '_')
		.padEnd(3, '_')
		.slice(0, 20));
}

/**
 * The player with a name, made if the test hasn't made them yet. The handle comes from the name
 * (handleFor()), and the account has no email or password
 *
 * @param name The player's display name
 * @return The player
 */
export async function addPlayer(name: string): Promise<PlayerProfile>
{
	const handle = handleFor(name);

	return((await findPlayerByHandle(handle)) ?? await createPlayer({
		handle,
		displayName: name,
		email: null,
		passwordHash: null
	}));
}

/**
 * A browser logged in as a player
 */
export interface TestBrowser
{
	playerId: string;
	sessionId: string;

	/**
	 * The Cookie header the browser sends, holding its session cookie
	 */
	cookie: string;
}

/**
 * Logs a new browser in as a player, as logging in would
 *
 * @param playerId The player
 * @param rememberMe Whether the session is a remembered one
 * @return The browser
 */
export async function logInBrowser(playerId: string, rememberMe: boolean = false): Promise<TestBrowser>
{
	const token = createToken();
	const session = await createSession(playerId, hashToken(token), rememberMe);

	return({
		playerId,
		sessionId: session.id,
		cookie: `${SESSION_COOKIE}=${token}`
	});
}

/**
 * Browsers a test refers to by name, such as "A" and "B", each logged in as a player
 */
export class TestBrowsers
{
	private readonly browsers = new Map<string, TestBrowser>();

	/**
	 * Logs a browser in as a player, unless it already is. A browser logged in as another player gets
	 * a new session
	 *
	 * @param name The browser's name in the test
	 * @param playerId The player
	 * @return The browser
	 */
	async logIn(name: string, playerId: string): Promise<TestBrowser>
	{
		const existing = this.browsers.get(name);

		if (existing?.playerId === playerId)
		{
			return(existing);
		}

		const browser = await logInBrowser(playerId);

		this.browsers.set(name, browser);

		return(browser);
	}

	/**
	 * The Cookie header a browser sends
	 *
	 * @param name The browser's name in the test
	 * @return The header, or an empty one for a browser that never logged in
	 */
	cookieOf(name: string): string
	{
		return((this.browsers.get(name)?.cookie ?? ''));
	}

	/**
	 * Forgets every browser, as each test's empty database has no sessions
	 */
	clear(): void
	{
		this.browsers.clear();
	}
}
