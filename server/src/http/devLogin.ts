/**
 * A login for bots, such as the load test's, which can't read email: only added while dev tools are on
 * (isDevToolsEnabled()), which is never in production
 */
import { randomBytes } from 'crypto';
import type { Application } from 'express';

import { createToken, hashToken } from '../auth/tokens.js';
import { createPlayer } from '../db/playerRepo.js';
import { createSession } from '../db/sessionRepo.js';

/**
 * Where bots log in
 */
export const DEV_BOT_LOGIN_PATH = '/dev/bot-login';

/**
 * What a bot login answers
 */
export interface BotLoginPayload
{
	/**
	 * The session token, for the bot's own Cookie header (SESSION_COOKIE)
	 */
	token: string;

	playerId: string;
}

/**
 * Adds POST DEV_BOT_LOGIN_PATH, which makes a new account with a random username, without an email or
 * password, and answers with a session token for it
 *
 * @param app Express app to add the route to
 */
export function addDevBotLoginRoute(app: Application): void
{
	app.post(DEV_BOT_LOGIN_PATH, async (_request, response) =>
	{
		const suffix = randomBytes(6).toString('hex');
		const player = await createPlayer({
			username: `bot_${suffix}`,
			displayName: `Bot ${suffix.slice(0, 4)}`,
			email: null,
			passwordHash: null
		});
		const token = createToken();

		await createSession(player.id, hashToken(token), false);

		const payload: BotLoginPayload = {
			token,
			playerId: player.id
		};

		response.set('Cache-Control', 'no-store');
		response.json(payload);
	});
}
