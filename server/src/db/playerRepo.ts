/**
 * Player accounts: the only module that reads or writes the players table
 */
import { eq, sql } from 'drizzle-orm';

import { db, type Executor } from './client.js';
import { players } from './schema.js';

/**
 * A player account as the rest of the server sees it
 */
export interface PlayerProfile
{
	/**
	 * The player's permanent ID, also their public player ID in synced state
	 */
	id: string;

	/**
	 * The name as it was first typed, whatever capitals later logins use
	 */
	displayName: string;
}

const profileColumns = {
	id: players.id,
	displayName: players.displayName
};

/**
 * Finds the player with a name, ignoring capitals
 *
 * @param name The name, already validated and trimmed
 * @return The player, or undefined when nobody has the name
 */
async function findPlayerByName(name: string): Promise<PlayerProfile | undefined>
{
	const rows = await db.select(profileColumns).from(players).where(sql`lower(${players.displayName}) = lower(${name})`).limit(1);

	return(rows[0]);
}

/**
 * Loads the player with a name, creating them if the name is new. This is the whole of the name-only
 * login, so whoever types a name is that player
 *
 * @param name The name, already validated and trimmed
 * @return The player
 */
export async function loadOrCreatePlayerByName(name: string): Promise<PlayerProfile>
{
	const existing = await findPlayerByName(name);

	if (existing)
	{
		return(existing);
	}

	const created = await db.insert(players).values({ displayName: name }).onConflictDoNothing().returning(profileColumns);

	if (created[0])
	{
		return(created[0]);
	}

	// Another login created the same name between the two queries
	const raced = await findPlayerByName(name);

	if (!raced)
	{
		throw new Error('A new player could not be created, but no player has the name either');
	}

	return(raced);
}

/**
 * Locks a player's row until the transaction ends, so checks and changes made for that player in
 * concurrent transactions happen one after another
 *
 * @param playerId The player's ID
 * @param executor A transaction
 * @return Whether the player exists
 */
export async function lockPlayer(playerId: string, executor: Executor): Promise<boolean>
{
	const rows = await executor
		.select({
			id: players.id
		})
		.from(players)
		.where(eq(players.id, playerId))
		.for('update');

	return(rows.length > 0);
}
