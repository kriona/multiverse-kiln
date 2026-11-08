/**
 * Logs the kiln-review skill's live checks in as existing accounts (.agents/skills/kiln-review/SKILL.md):
 *
 *   npm run review:session -w server -- <username>
 *   npm run review:session -w server -- --end <token>
 *
 * The first makes a session for the account and prints { "token": "...", "playerId": "..." } as JSON. The
 * token goes in a Cookie header, as SESSION_COOKIE (server/src/http/cookies.ts). The session isn't
 * remembered, like the bot login's (server/src/http/devLogin.ts), so it ends after an hour without use.
 * The second deletes the session a token belongs to
 *
 * It never creates accounts, and refuses to run unless dev tools are on and DATABASE_URL is a database on
 * this computer (localOnlyRefusal())
 */
import { parseArgs } from 'node:util';

import { localOnlyRefusal } from './localDatabase.js';

/**
 * Closes the database connection, once main() has opened it
 */
let closeDatabase: (() => Promise<void>) | undefined;

/**
 * Makes or ends the session the command line asks for, and says what happened
 *
 * @return The process's exit code
 */
async function main(): Promise<number>
{
	const refusal = localOnlyRefusal();

	if (refusal)
	{
		console.error(refusal);
		return(1);
	}

	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			end: { type: 'string' }
		}
	});

	if ((values.end === undefined) ? (positionals.length !== 1) : (positionals.length !== 0))
	{
		console.error('Give one username to log in as, or --end and a token: npm run review:session -w server -- <username> | --end <token>');
		return(1);
	}

	// The database client reads DATABASE_URL when it is first imported, so nothing imports it until the
	// check above has passed
	const { pool } = await import('../src/db/client.js');
	const { createToken, hashToken, isTokenForm } = await import('../src/auth/tokens.js');
	const { findPlayerByUsername } = await import('../src/db/playerRepo.js');
	const { createSession, deleteSession, findSessionByTokenHash } = await import('../src/db/sessionRepo.js');

	closeDatabase = () => pool.end();

	if (values.end !== undefined)
	{
		if (!isTokenForm(values.end))
		{
			console.error('That isn\'t a session token.');
			return(1);
		}

		const session = await findSessionByTokenHash(hashToken(values.end));

		if (session)
		{
			await deleteSession(session.id);
		}

		console.log((session ? 'Ended the session.' : 'There is no session with that token, so there was nothing to end.'));
		return(0);
	}

	const player = await findPlayerByUsername(positionals[0]);

	if (!player)
	{
		console.error(`There is no player with the username ${positionals[0]}. Register the account first.`);
		return(1);
	}

	const token = createToken();

	await createSession(player.id, hashToken(token), false);

	console.log(JSON.stringify({
		token,
		playerId: player.id
	}));

	return(0);
}

try
{
	process.exitCode = await main();
}
finally
{
	await closeDatabase?.();
}
