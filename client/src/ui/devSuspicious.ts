import { DEV_SUSPICIOUS_COOKIE } from '@multiverse-kiln/shared';

import { announce } from './announcer';

/**
 * Whether the browser acts suspicious: whether it has DEV_SUSPICIOUS_COOKIE
 *
 * @return Whether it does
 */
function isActingSuspicious(): boolean
{
	return(document.cookie
		.split(';')
		.some((pair) => (pair.trim() === `${DEV_SUSPICIOUS_COOKIE}=1`)));
}

/**
 * Sets DEV_SUSPICIOUS_COOKIE until the browser closes, or clears it. Cookies ignore ports, so the
 * server on the same host gets it with its requests. The __Host- prefix needs Secure and Path=/
 *
 * @param on Whether the browser acts suspicious
 */
function setActingSuspicious(on: boolean): void
{
	if (on)
	{
		document.cookie = `${DEV_SUSPICIOUS_COOKIE}=1; Path=/; Secure; SameSite=Strict`;
	}
	else
	{
		document.cookie = `${DEV_SUSPICIOUS_COOKIE}=; Path=/; Secure; SameSite=Strict; Max-Age=0`;
	}
}

/**
 * Shows whether the browser acts suspicious on the toggle
 *
 * @param button The toggle
 * @param state The text beside it that shows its state
 */
function showActingSuspicious(button: HTMLButtonElement, state: HTMLElement): void
{
	const on = isActingSuspicious();

	button.setAttribute('aria-pressed', String(on));
	state.textContent = (on ? ' (on)' : ' (off)');
}

/**
 * Adds a toggle in development builds that makes this browser act suspicious, so a local server with
 * dev tools on asks it for a bot check at every login and email code, even on an account it has logged
 * in to (server/src/auth/devSuspicious.ts). It does nothing while the server's bot checks are off.
 * Players never see it, so it isn't a message
 *
 * @param container Where the toggle goes, at the end
 */
export function addDevSuspiciousToggle(container: HTMLElement): void
{
	const line = document.createElement('p');
	const button = document.createElement('button');
	const state = document.createElement('span');

	button.type = 'button';
	button.className = 'link-button';
	// eslint-disable-next-line no-restricted-syntax -- only development builds show it
	button.textContent = 'act like a suspicious browser';
	// eslint-disable-next-line no-restricted-syntax -- only development builds show it
	button.title = 'Asks this browser for a bot check at every login and email code. Needs ENABLE_DEV_TOOLS and Turnstile keys on the server, or it does nothing';
	button.addEventListener('click', () =>
	{
		const on = !isActingSuspicious();

		setActingSuspicious(on);
		showActingSuspicious(button, state);
		announce((on ? 'Acting like a suspicious browser' : 'Acting like a normal browser'));
	});

	// aria-pressed gives the state to screen readers
	state.setAttribute('aria-hidden', 'true');
	showActingSuspicious(button, state);

	line.className = 'hint dev-suspicious';
	line.translate = false;
	// eslint-disable-next-line no-restricted-syntax -- only development builds show it
	line.append('Dev: ', button, state);
	container.append(line);
}
