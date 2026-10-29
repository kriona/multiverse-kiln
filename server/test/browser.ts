/**
 * A browser for tests of the HTTP routes, keeping cookies between requests
 */
import { AUTH_SESSION_PATH, type AuthErrorPayload, type SessionPayload } from '@multiverse-kiln/shared';

import { testServerUrl } from './testServer.js';

/**
 * A browser's cookies, kept between requests like a browser keeps them
 */
export class Browser
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
	 * @return The player's username, or null when it isn't logged in
	 */
	async username(): Promise<string | null>
	{
		return((await this.send<SessionPayload>('GET', AUTH_SESSION_PATH)).body.player?.username ?? null);
	}
}
