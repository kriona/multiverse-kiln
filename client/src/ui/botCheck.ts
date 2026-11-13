import arrowClockwiseIcon from 'virtual:icon/ph:arrow-clockwise';
import { defineMessages, isBotCheckNeeded, type BotCheckChallenge } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { EditorApiError } from '../network/editorApi';
import { announce } from './announcer';
import { setButtonLabel } from './dom';

/**
 * Cloudflare Turnstile's script, loaded only once the server asks for a check, so a browser that never
 * needs one never contacts Cloudflare. render=explicit: the page says where each widget goes
 */
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * How long the script may take to load before the page says it couldn't
 */
const SCRIPT_TIMEOUT_MS = 20000;

/**
 * The languages Turnstile's widget is written in (https://developers.cloudflare.com/turnstile/reference/supported-languages/)
 */
const TURNSTILE_LANGUAGES: ReadonlySet<string> = new Set(['ar', 'ar-eg', 'bg', 'bg-bg', 'cs', 'cs-cz', 'da', 'da-dk', 'de', 'de-de', 'el', 'el-gr', 'en', 'en-us', 'es', 'es-es', 'fa', 'fa-ir', 'fi', 'fi-fi', 'fr', 'fr-fr', 'he', 'he-il', 'hi', 'hi-in', 'hr', 'hr-hr', 'hu', 'hu-hu', 'id', 'id-id', 'it', 'it-it', 'ja', 'ja-jp', 'ko', 'ko-kr', 'lt', 'lt-lt', 'ms', 'ms-my', 'nb', 'nb-no', 'nl', 'nl-nl', 'pl', 'pl-pl', 'pt', 'pt-br', 'ro', 'ro-ro', 'ru', 'ru-ru', 'sk', 'sk-sk', 'sl', 'sl-si', 'sr', 'sr-ba', 'sv', 'sv-se', 'th', 'th-th', 'tl', 'tl-ph', 'tr', 'tr-tr', 'uk', 'uk-ua', 'vi', 'vi-vn', 'zh', 'zh-cn', 'zh-tw']);

/**
 * What a widget is shown with (https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)
 */
interface TurnstileOptions
{
	'sitekey': string;
	'action': string;
	'language': string;
	'theme': 'dark';
	'refresh-expired': 'manual';
	'refresh-timeout': 'manual';
	'callback': (token: string) => void;
	'error-callback': () => boolean;
	'expired-callback': () => void;
	'timeout-callback': () => void;
	'before-interactive-callback': () => void;
	'after-interactive-callback': () => void;
}

/**
 * The part of Turnstile's script the page uses
 */
interface Turnstile
{
	render(container: HTMLElement, options: TurnstileOptions): string | undefined;
	reset(widgetId: string): void;
	remove(widgetId: string): void;
}

declare global
{
	interface Window
	{
		turnstile?: Turnstile;
	}
}

/**
 * Text shown in more than one place (see src/localization.ts)
 */
const botCheckMessages = defineMessages({
	checking: {
		id: 'botCheck.checking',
		defaultMessage: 'Checking that you aren\'t a bot. This usually takes a few seconds and needs nothing from you.',
		description: 'Shown above a form\'s button while a bot check (Cloudflare Turnstile) runs, after many tries for an address or from a network, and again once the player has done what it asked; read out to screen readers. Most checks finish on their own'
	}
});

let loading: Promise<Turnstile> | undefined;

/**
 * Loads Turnstile's script, once
 *
 * @return Turnstile
 * @throws Error when it couldn't load, such as when an ad blocker or firewall blocks it
 */
function loadTurnstile(): Promise<Turnstile>
{
	if (window.turnstile)
	{
		return(Promise.resolve(window.turnstile));
	}

	loading ??= new Promise<Turnstile>((resolve, reject) =>
	{
		const script = document.createElement('script');
		const fail = (): void =>
		{
			window.clearTimeout(timer);
			script.remove();

			// Tried again the next time a check is asked for
			loading = undefined;
			reject(new Error('Turnstile\'s script could not be loaded'));
		};
		const timer = window.setTimeout(fail, SCRIPT_TIMEOUT_MS);

		script.src = TURNSTILE_SCRIPT_URL;
		script.async = true;
		script.addEventListener('load', () =>
		{
			window.clearTimeout(timer);

			if (window.turnstile)
			{
				resolve(window.turnstile);
			}
			else
			{
				fail();
			}
		});
		script.addEventListener('error', fail);
		document.head.append(script);
	});

	return(loading);
}

/**
 * The language to show the widget in: the player's when Turnstile has it, or its language without the
 * region, or else 'auto', which lets Turnstile choose from the browser's. Private-use languages, such as
 * Pirate, and the pseudo-language are left to Turnstile too
 *
 * @param locale The player's language
 * @return The widget's language
 */
export function turnstileLanguage(locale: string): string
{
	const lowered = locale.toLowerCase();
	const [language, region] = lowered.split('-');

	if (lowered.includes('-x-') || (region === 'xa'))
	{
		return('auto');
	}

	if (TURNSTILE_LANGUAGES.has(lowered))
	{
		return(lowered);
	}

	return((TURNSTILE_LANGUAGES.has(language) ? language : 'auto'));
}

/**
 * A form's bot check (see Bot checks in STRUCTURE-OVERVIEW.md). Requests the server may refuse for want
 * of a check go through send(): when the server asks for one, the check shows where the form put it,
 * above its submit button, and the request is sent again with its token once it is passed, which most
 * people do without doing anything. Each try needs a token of its own, so the widget is reset after
 * every answer. A check in a dialog stops when the dialog closes
 */
export class BotCheck
{
	private readonly box = document.createElement('div');
	private readonly status = document.createElement('p');
	private readonly widget = document.createElement('div');
	private readonly problem = document.createElement('p');
	private readonly retry = document.createElement('button');

	/**
	 * The widget shown, and what it was made for
	 */
	private shown: { id: string; challenge: BotCheckChallenge } | undefined;

	/**
	 * A token the widget made that no request has used yet
	 */
	private token: string | undefined;

	/**
	 * The request waiting for a token, and the answer that asked for it, which it fails with if the check stops
	 */
	private waiting: { resolve: (token: string) => void; reject: (error: unknown) => void; refusal: EditorApiError } | undefined;

	/**
	 * @param anchor Where the check goes: before this element, such as the line above the form's submit button
	 */
	constructor(anchor: HTMLElement)
	{
		this.box.className = 'bot-check';
		this.box.hidden = true;
		this.status.className = 'bot-check-status';
		this.problem.className = 'field-error';
		this.problem.id = `bot-check-problem-${Math.random().toString(36).slice(2)}`;
		this.problem.hidden = true;
		this.retry.type = 'button';
		this.retry.className = 'secondary';
		this.retry.hidden = true;
		this.retry.setAttribute('aria-describedby', this.problem.id);
		setButtonLabel(this.retry, arrowClockwiseIcon, t({
			id: 'botCheck.tryAgain',
			defaultMessage: 'Try the check again',
			description: 'Button under a bot check (Cloudflare Turnstile) that failed or expired, which starts a new check'
		}));
		this.retry.addEventListener('click', () =>
		{
			this.restart();
		});
		this.box.append(this.status, this.widget, this.problem, this.retry);
		anchor.before(this.box);
		anchor.closest('dialog')?.addEventListener('close', () =>
		{
			this.cancel();
		});
	}

	/**
	 * Sends a request, showing the check and sending it again with the check's token whenever the
	 * server asks for one
	 *
	 * @param request Sends the request with a check's token, or none
	 * @return What the request answered
	 * @throws What the request threw when it isn't asking for a check; EditorApiError saying so when the
	 * check couldn't load; and the server's answer asking for a check when the check stops, such as when
	 * its dialog closes
	 */
	async send<T>(request: (botCheckToken: string | undefined) => Promise<T>): Promise<T>
	{
		let token = this.takeToken();

		for (;;)
		{
			try
			{
				const answer = await request(token);

				this.stop();

				return(answer);
			}
			catch (error)
			{
				if (!(error instanceof EditorApiError) || !isBotCheckNeeded(error.data))
				{
					this.renew();
					throw error;
				}

				token = await this.waitForToken(error.data.botCheck, error);
			}
		}
	}

	/**
	 * Stops the check, such as when its form is left: a request waiting for it fails with the server's
	 * answer that asked for it
	 */
	cancel(): void
	{
		const waiting = this.waiting;

		this.stop();
		waiting?.reject(waiting.refusal);
	}

	/**
	 * The token the widget made that no request has used yet, if any, which the next request uses
	 *
	 * @return The token
	 */
	private takeToken(): string | undefined
	{
		const token = this.token;

		this.token = undefined;

		return(token);
	}

	/**
	 * Shows the check and waits for it to be passed
	 *
	 * @param challenge What the server asked for the check with
	 * @param refusal The server's answer asking for it
	 * @return The check's token
	 */
	private async waitForToken(challenge: BotCheckChallenge, refusal: EditorApiError): Promise<string>
	{
		const ready = this.takeToken();

		if ((ready !== undefined) && (this.shown?.challenge.action === challenge.action) && (this.shown.challenge.siteKey === challenge.siteKey))
		{
			// The widget already made a new one after the last answer
			return(ready);
		}

		this.box.hidden = false;
		this.showProblem(undefined);
		this.setStatus(t(botCheckMessages.checking));

		let turnstile: Turnstile;

		try
		{
			turnstile = await loadTurnstile();
		}
		catch (error)
		{
			console.warn('The bot check could not load:', error);
			this.stop();

			throw new EditorApiError(t({
				id: 'botCheck.couldNotLoad',
				defaultMessage: 'The bot check (Cloudflare Turnstile) couldn\'t load, perhaps because an ad blocker or firewall blocks it. Try again in another browser or on another network.',
				description: 'Shown under a form when the site asked the browser to pass a bot check, after many tries for an address or from a network, but the check\'s script couldn\'t be loaded from Cloudflare'
			}), refusal.status, refusal.data);
		}

		return(await new Promise<string>((resolve, reject) =>
		{
			this.waiting = {
				resolve,
				reject,
				refusal
			};
			this.show(turnstile, challenge);
		}));
	}

	/**
	 * Shows the widget for a challenge, or keeps the one shown when it was made for the same
	 *
	 * @param turnstile Turnstile
	 * @param challenge What the check is for
	 */
	private show(turnstile: Turnstile, challenge: BotCheckChallenge): void
	{
		if (this.shown && (this.shown.challenge.action === challenge.action) && (this.shown.challenge.siteKey === challenge.siteKey))
		{
			turnstile.reset(this.shown.id);
			return;
		}

		this.removeWidget();

		const id = turnstile.render(this.widget, {
			'sitekey': challenge.siteKey,
			'action': challenge.action,
			'language': turnstileLanguage(currentLocale()),
			'theme': 'dark',
			'refresh-expired': 'manual',
			'refresh-timeout': 'manual',
			'callback': (token) =>
			{
				this.passed(token);
			},
			'error-callback': () =>
			{
				this.failed(t({
					id: 'botCheck.failed',
					defaultMessage: 'The bot check didn\'t pass. Try it again.',
					description: 'Shown under a bot check (Cloudflare Turnstile) that failed, above a button that starts it again'
				}));

				// Handled: Turnstile doesn't throw
				return(true);
			},
			'expired-callback': () =>
			{
				this.token = undefined;
				this.failed(t({
					id: 'botCheck.expired',
					defaultMessage: 'The bot check expired. Try it again.',
					description: 'Shown under a bot check (Cloudflare Turnstile) that was passed but not used for a few minutes, above a button that starts it again'
				}));
			},
			'timeout-callback': () =>
			{
				this.failed(t({
					id: 'botCheck.timedOut',
					defaultMessage: 'The bot check wasn\'t finished in time. Try it again.',
					description: 'Shown under a bot check (Cloudflare Turnstile) that asked the player to do something, such as tick a box, and wasn\'t answered in time, above a button that starts it again'
				}));
			},
			'before-interactive-callback': () =>
			{
				this.setStatus(t({
					id: 'botCheck.needsYou',
					defaultMessage: 'The bot check needs you: follow what it asks, such as ticking its box.',
					description: 'Shown above a bot check (Cloudflare Turnstile) and read out when it asks the player to do something before it passes; focus moves to the check'
				}), true);
				this.widget.querySelector('iframe')?.focus();
			},
			'after-interactive-callback': () =>
			{
				this.setStatus(t(botCheckMessages.checking));
			}
		});

		if (id !== undefined)
		{
			this.shown = {
				id,
				challenge
			};
		}
	}

	/**
	 * A check was passed: the request waiting for it is sent with its token, or the next one is
	 *
	 * @param token The check's token
	 */
	private passed(token: string): void
	{
		this.showProblem(undefined);

		const waiting = this.waiting;

		if (waiting)
		{
			this.waiting = undefined;
			this.setStatus(t({
				id: 'botCheck.passed',
				defaultMessage: 'Check passed. Sending...',
				description: 'Shown above a form\'s button and read out once the player\'s browser passed a bot check (Cloudflare Turnstile), as the form is sent again'
			}));
			waiting.resolve(token);
		}
		else
		{
			this.token = token;
		}
	}

	/**
	 * A check failed, expired or wasn't finished in time: says so, with a button to try again
	 *
	 * @param message What went wrong
	 */
	private failed(message: string): void
	{
		this.status.textContent = '';
		this.showProblem(message);
		this.retry.focus();
	}

	/**
	 * Starts the check again after it failed or expired
	 */
	private restart(): void
	{
		this.showProblem(undefined);
		this.setStatus(t(botCheckMessages.checking));
		this.token = undefined;

		if (this.shown && window.turnstile)
		{
			window.turnstile.reset(this.shown.id);
		}

		this.widget.querySelector('iframe')?.focus();
	}

	/**
	 * After an answer that didn't ask for a check, such as a wrong password, has the shown widget make a
	 * new token for the next try, since each token works once
	 */
	private renew(): void
	{
		this.token = undefined;

		if (this.shown && window.turnstile && !this.box.hidden)
		{
			this.showProblem(undefined);
			window.turnstile.reset(this.shown.id);
		}
	}

	/**
	 * Hides the check once a request went through, or the check stopped
	 */
	private stop(): void
	{
		this.waiting = undefined;
		this.token = undefined;
		this.removeWidget();
		this.showProblem(undefined);
		this.status.textContent = '';
		this.box.hidden = true;
	}

	/**
	 * Removes the widget shown, if any
	 */
	private removeWidget(): void
	{
		if (this.shown && window.turnstile)
		{
			window.turnstile.remove(this.shown.id);
		}

		this.shown = undefined;
		this.widget.replaceChildren();
	}

	/**
	 * Shows what the check is doing, and reads it out
	 *
	 * @param text What it is doing
	 * @param urgent Whether the player must hear it now
	 */
	private setStatus(text: string, urgent = false): void
	{
		this.status.textContent = text;
		announce(text, urgent);
	}

	/**
	 * Shows or hides what went wrong with the check, and the button to try again, reading it out
	 *
	 * @param message What went wrong, or undefined to hide it
	 */
	private showProblem(message: string | undefined): void
	{
		this.problem.textContent = (message ?? '');
		this.problem.hidden = (message === undefined);
		this.retry.hidden = (message === undefined);

		if (message !== undefined)
		{
			announce(message, true);
		}
	}
}
