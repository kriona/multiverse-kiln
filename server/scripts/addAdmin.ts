/**
 * Makes a player a server admin, who must have 2FA on to be logged in: without it, their next login asks
 * them to turn it on (see Admin in STRUCTURE-OVERVIEW.md):
 *
 *   npm run admin:add -w server -- <username>
 *
 * Run it by hand on the server, with the server's ADMIN_DATABASE_URL (the only role that can add admins)
 * and DATABASE_URL, to make the site's first admin; that admin can add the others on the Admins admin
 * page. The account must exist already: register it first
 */
import { parseArgs } from 'node:util';

import { adminDb, adminPool } from '../src/db/adminClient.js';
import { pool } from '../src/db/client.js';
import { findPlayerByUsername } from '../src/db/playerRepo.js';
import { addServerAdmin } from '../src/db/serverAdminRepo.js';
import { hasTwoFactor } from '../src/db/twoFactorRepo.js';

/**
 * Makes the player the command line names a server admin, and says what happened
 *
 * @return The process's exit code
 */
async function main(): Promise<number>
{
	const { positionals } = parseArgs({ allowPositionals: true });

	if (positionals.length !== 1)
	{
		console.error('Give the username of the player to make a server admin: npm run admin:add -w server -- <username>');
		return(1);
	}

	const player = await findPlayerByUsername(positionals[0], adminDb);

	if (!player)
	{
		console.error(`There is no player with the username ${positionals[0]}. Register the account first.`);
		return(1);
	}

	const added = await addServerAdmin(player.id, adminDb);

	console.log((added ? `${player.username} is now a server admin.` : `${player.username} was already a server admin.`));

	if (!await hasTwoFactor(player.id, adminDb))
	{
		console.log('They don\'t have two-factor authentication on, so they are logged out, and their next login asks them to turn it on.');
	}

	return(0);
}

try
{
	process.exitCode = await main();
}
finally
{
	await Promise.all([pool.end(), adminPool.end()]);
}
