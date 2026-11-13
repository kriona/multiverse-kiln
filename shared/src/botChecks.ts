/**
 * Bot checks (see Bot checks in STRUCTURE-OVERVIEW.md): a browser that looks suspicious, such as one
 * guessing passwords for an address, is asked to pass a Cloudflare Turnstile check before the server
 * takes its request, rather than being refused
 */
import { defineMessages, type LocalizedMessage } from './localization.js';

/**
 * The Turnstile actions, one for each kind of request a check is asked for: logging in with a
 * password, giving a logged-in account's password again (changing it or 2FA, deleting the account),
 * and sending an email code. The server checks a passed check was made for the request's action
 */
export const BOT_CHECK_ACTIONS = ['login', 'password', 'email-code'] as const;

export type BotCheckAction = (typeof BOT_CHECK_ACTIONS)[number];

/**
 * The longest token Turnstile makes
 */
export const MAX_BOT_CHECK_TOKEN_LENGTH = 2048;

/**
 * The error a request needing a check is refused with (BotCheckNeededPayload)
 */
export const BOT_CHECK_MESSAGES = defineMessages({
	needed: {
		id: 'error.auth.botCheckNeeded',
		defaultMessage: 'Show that you aren\'t a bot to continue.',
		description: 'Why logging in, giving the account\'s password again or sending an email code was paused: there were many tries for this address or from this network, so the site asks the browser to pass a bot check (Cloudflare Turnstile) first. The page shows the check with this message and sends the request again once it is passed'
	}
});

/**
 * What a request that can need a check carries: the token of a check the browser passed, made for the
 * request's action, left out until the server asks for one. A token works once, so every try needs its own
 */
export interface BotCheckRequest
{
	botCheckToken?: string;
}

/**
 * What the server asks a browser to show it isn't a bot with
 */
export interface BotCheckChallenge
{
	/**
	 * Turnstile's site key, for the widget
	 */
	siteKey: string;

	/**
	 * The action the check must be made for
	 */
	action: BotCheckAction;
}

/**
 * The answer (403) to a request that needs a passed check and didn't send one: the error message, and
 * how to show the check. The client shows the check and sends the request again with its token
 */
export interface BotCheckNeededPayload
{
	error: LocalizedMessage;
	botCheck: BotCheckChallenge;
}

/**
 * Whether an error answer asks for a check
 *
 * @param data The answer's body
 * @return Whether it is a BotCheckNeededPayload
 */
export function isBotCheckNeeded(data: unknown): data is BotCheckNeededPayload
{
	if ((typeof data !== 'object') || (data === null) || !('botCheck' in data))
	{
		return(false);
	}

	const botCheck: unknown = data.botCheck;

	return((typeof botCheck === 'object')
		&& (botCheck !== null)
		&& ('siteKey' in botCheck)
		&& (typeof botCheck.siteKey === 'string')
		&& ('action' in botCheck)
		&& (BOT_CHECK_ACTIONS as readonly unknown[]).includes(botCheck.action));
}
