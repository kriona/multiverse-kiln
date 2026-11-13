/**
 * Cloudflare Turnstile, the bot check (see Bot checks in STRUCTURE-OVERVIEW.md): its keys, verifying
 * the tokens browsers send with siteverify, and whether the server can reach Cloudflare
 *
 * Checks are on once TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are both set, and off while both are
 * unset. While Cloudflare can't be reached nothing is checked, so an outage only takes away the extra
 * tries a passed check gives: the server learns whether it can reach it from its own siteverify calls,
 * and, before asking a browser for a check when it hasn't heard from Cloudflare for a while, by sending
 * siteverify a token that can't be valid (a quick refusal means it is up). The widget and siteverify are
 * both on challenges.cloudflare.com, so an outage usually shows in both
 */
import type { BotCheckAction } from '@multiverse-kiln/shared';

import { isDevToolsEnabled } from '../devTools.js';
import { siteUrl } from '../siteUrl.js';

/**
 * Turnstile's server-side check of a token
 */
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * How long a siteverify call may take before Cloudflare is treated as unreachable
 */
export const SITEVERIFY_TIMEOUT_MS = 4000;

/**
 * How long after the server last heard from Cloudflare it checks it can still reach it before asking a
 * browser for a check
 */
export const REACHABLE_FOR_MS = (5 * 60 * 1000);

/**
 * How long Cloudflare is treated as unreachable after a call to it fails, before trying again
 */
export const UNREACHABLE_FOR_MS = (3 * 60 * 1000);

/**
 * The token sent to check Cloudflare can be reached: not one Turnstile ever makes, so it is refused
 */
const PROBE_TOKEN = 'reachability-check';

/**
 * Cloudflare's published test secret keys (https://developers.cloudflare.com/turnstile/troubleshooting/testing/):
 * one always passes, one always fails, and one says the token was already spent. They accept the test
 * tokens the test site keys make on any site, so they are only accepted with dev tools on or in tests
 */
export const TEST_SECRET_KEYS: readonly string[] = [
	'1x0000000000000000000000000000000AA',
	'2x0000000000000000000000000000000AA',
	'3x0000000000000000000000000000000AA'
];

/**
 * The keys of a site with checks configured
 */
export interface TurnstileKeys
{
	siteKey: string;
	secretKey: string;
}

/**
 * Reads Turnstile's keys from the environment
 *
 * @param env Environment variables to read
 * @return The keys, or undefined when both are unset, which turns checks off
 * @throws Error when only one is set, or a test secret key is set without dev tools on or outside tests
 */
export function readTurnstileKeys(env: NodeJS.ProcessEnv = process.env): TurnstileKeys | undefined
{
	const siteKey = (env.TURNSTILE_SITE_KEY ?? '').trim();
	const secretKey = (env.TURNSTILE_SECRET_KEY ?? '').trim();

	if ((siteKey === '') && (secretKey === ''))
	{
		return(undefined);
	}

	if ((siteKey === '') || (secretKey === ''))
	{
		throw new Error('Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither. See server/.env.example');
	}

	if (TEST_SECRET_KEYS.includes(secretKey) && !isDevToolsEnabled(env) && (env.NODE_ENV !== 'test'))
	{
		throw new Error('TURNSTILE_SECRET_KEY is one of Cloudflare\'s test keys, which let every check pass. Use them only with ENABLE_DEV_TOOLS on, on your own computer. See server/.env.example');
	}

	return({
		siteKey,
		secretKey
	});
}

/**
 * What became of a token
 *
 * - 'passed': Cloudflare says it is a passed check, made for the action on this site
 * - 'failed': it isn't, or was already used or too old, which counts as no token
 * - 'unreachable': Cloudflare couldn't be asked, so checks are off for a while
 */
export type TokenOutcome = 'passed' | 'failed' | 'unreachable';

/**
 * Verifies bot check tokens. The routes use botCheckVerifier(), which tests replace with
 * setBotCheckVerifier(), so they never call Cloudflare
 */
export interface BotCheckVerifier
{
	/**
	 * The site key the widget is shown with, or undefined when checks aren't configured
	 */
	readonly siteKey: string | undefined;

	/**
	 * Whether checks are on: configured, and Cloudflare not known to be unreachable
	 *
	 * @param now The time now
	 * @return Whether they are
	 */
	available(now: Date): boolean;

	/**
	 * Whether the server has heard from Cloudflare in the past REACHABLE_FOR_MS, so confirmAvailable()
	 * won't call it
	 *
	 * @param now The time now
	 * @return Whether it has
	 */
	reachedRecently(now: Date): boolean;

	/**
	 * Whether checks are on, finding out whether Cloudflare can be reached first when the server hasn't
	 * heard from it for REACHABLE_FOR_MS. Called before asking a browser for a check
	 *
	 * @param now The time now
	 * @return Whether they are
	 */
	confirmAvailable(now: Date): Promise<boolean>;

	/**
	 * Asks Cloudflare whether a token is a passed check. A token works once
	 *
	 * @param token The token the browser sent
	 * @param action The action the request needs the check to be made for
	 * @param now The time now
	 * @return What became of it
	 */
	verify(token: string, action: BotCheckAction, now: Date): Promise<TokenOutcome>;
}

/**
 * What siteverify answers
 */
interface SiteverifyAnswer
{
	success?: unknown;
	'error-codes'?: unknown;
	action?: unknown;
	hostname?: unknown;
}

/**
 * Sends siteverify a token
 *
 * @param secretKey The site's secret key
 * @param token The token
 * @param fetcher Sends the request
 * @return Cloudflare's answer, or undefined when it couldn't be reached or failed on its side
 */
async function askSiteverify(secretKey: string, token: string, fetcher: typeof fetch): Promise<SiteverifyAnswer | undefined>
{
	let response: Response;

	try
	{
		response = await fetcher(SITEVERIFY_URL, {
			method: 'POST',
			body: new URLSearchParams({
				secret: secretKey,
				response: token
			}),
			signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS)
		});
	}
	catch (error)
	{
		console.warn('Could not reach Cloudflare Turnstile; bot checks are off for a few minutes:', error);
		return(undefined);
	}

	if (response.status >= 500)
	{
		console.warn(`Cloudflare Turnstile answered ${response.status}; bot checks are off for a few minutes`);
		return(undefined);
	}

	let answer: unknown;

	try
	{
		answer = await response.json();
	}
	catch (error)
	{
		console.warn('Cloudflare Turnstile\'s answer could not be read; bot checks are off for a few minutes:', error);
		return(undefined);
	}

	if ((typeof answer !== 'object') || (answer === null))
	{
		return(undefined);
	}

	const parsed: SiteverifyAnswer = answer;
	const codes = parsed['error-codes'];
	const errorCodes = (Array.isArray(codes) ? codes : []);

	if (errorCodes.includes('internal-error'))
	{
		console.warn('Cloudflare Turnstile had an internal error; bot checks are off for a few minutes');
		return(undefined);
	}

	if (errorCodes.includes('invalid-input-secret') || errorCodes.includes('missing-input-secret'))
	{
		// Every check would fail, so no browser could get past a soft limit: better to check nothing
		console.error('Cloudflare Turnstile refused TURNSTILE_SECRET_KEY; bot checks are off for a few minutes');
		return(undefined);
	}

	return(parsed);
}

/**
 * Makes the verifier for a site's keys
 *
 * @param keys The keys, or undefined when checks aren't configured
 * @param expectedHostname The hostname a check must have been made on: the host of SITE_URL
 * @param fetcher Sends requests to Cloudflare: fetch, or a stand-in in tests
 * @return The verifier
 */
export function createBotCheckVerifier(keys: TurnstileKeys | undefined, expectedHostname: string, fetcher: typeof fetch = fetch): BotCheckVerifier
{
	const testKey = ((keys !== undefined) && TEST_SECRET_KEYS.includes(keys.secretKey));
	let reachedAt = -Infinity;
	let unreachableUntil = -Infinity;
	let probe: Promise<void> | undefined;

	/**
	 * Remembers how a call to Cloudflare went
	 *
	 * @param answer Its answer, or undefined when it failed
	 * @param now When the call was made
	 * @return The answer
	 */
	function remember(answer: SiteverifyAnswer | undefined, now: Date): SiteverifyAnswer | undefined
	{
		if (answer === undefined)
		{
			unreachableUntil = (now.getTime() + UNREACHABLE_FOR_MS);
		}
		else
		{
			reachedAt = now.getTime();
			unreachableUntil = -Infinity;
		}

		return(answer);
	}

	const verifier: BotCheckVerifier = {
		siteKey: keys?.siteKey,

		available(now: Date): boolean
		{
			return((keys !== undefined) && (now.getTime() >= unreachableUntil));
		},

		reachedRecently(now: Date): boolean
		{
			return((now.getTime() - reachedAt) < REACHABLE_FOR_MS);
		},

		async confirmAvailable(now: Date): Promise<boolean>
		{
			if (!verifier.available(now))
			{
				return(false);
			}

			if (!verifier.reachedRecently(now))
			{
				// Requests at the same time share one call
				probe ??= askSiteverify(keys!.secretKey, PROBE_TOKEN, fetcher)
					.then((answer) =>
					{
						remember(answer, now);
					})
					.finally(() =>
					{
						probe = undefined;
					});

				await probe;
			}

			return(verifier.available(now));
		},

		async verify(token: string, action: BotCheckAction, now: Date): Promise<TokenOutcome>
		{
			if (!verifier.available(now))
			{
				return('unreachable');
			}

			const answer = remember(await askSiteverify(keys!.secretKey, token, fetcher), now);

			if (answer === undefined)
			{
				return('unreachable');
			}

			if (answer.success !== true)
			{
				return('failed');
			}

			// A test key's tokens weren't made on this site, or for an action
			if (!testKey && ((answer.action !== action) || (answer.hostname !== expectedHostname)))
			{
				return('failed');
			}

			return('passed');
		}
	};

	return(verifier);
}

let verifierInUse: BotCheckVerifier | undefined;
let replacement: BotCheckVerifier | undefined;

/**
 * The verifier the routes use, made from the environment's keys the first time it is asked for
 *
 * @return The verifier
 */
export function botCheckVerifier(): BotCheckVerifier
{
	if (replacement)
	{
		return(replacement);
	}

	verifierInUse ??= createBotCheckVerifier(readTurnstileKeys(), new URL(siteUrl()).hostname);

	return(verifierInUse);
}

/**
 * Replaces the verifier, for tests
 *
 * @param verifier The verifier, or undefined to use the real one again
 */
export function setBotCheckVerifier(verifier: BotCheckVerifier | undefined): void
{
	replacement = verifier;
}
