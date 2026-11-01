/**
 * Makes a player a server admin, who can use the admin pages once they turn on 2FA (see Admin in
 * STRUCTURE-OVERVIEW.md):
 *
 *   npm run admin:add -w server -- <username>
 *
 * Run it by hand on the server, with the server's DATABASE_URL, to make the site's first admin. The
 * account must exist already: register it first
 */
import { parseArgs } from 'node:util';

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

	const player = await findPlayerByUsername(positionals[0]);

	if (!player)
	{
		console.error(`There is no player with the username ${positionals[0]}. Register the account first.`);
		return(1);
	}

	const added = await addServerAdmin(player.id);

	console.log((added ? `${player.username} is now a server admin.` : `${player.username} was already a server admin.`));

	if (!await hasTwoFactor(player.id))
	{
		console.log('They need to turn on two-factor authentication on their profile before they can use the admin pages.');
	}

	return(0);
}

try
{
	process.exitCode = await main();
}
finally
{
	await pool.end();
}
