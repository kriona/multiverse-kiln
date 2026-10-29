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

	username: string;
	displayName: string;
}

/**
 * A new account
 */
export interface NewPlayer
{
	username: string;
	displayName: string;

	/**
	 * The address a local account logs in with, or null for one that doesn't have one
	 */
	email: string | null;

	/**
	 * A local account's password hash (server/src/auth/passwords.ts), or null for one without a password
	 */
	passwordHash: string | null;
}

/**
 * What a local account's login needs
 */
export interface LocalLogin
{
	id: string;
	passwordHash: string;
}

/**
 * Thrown when a new account would take a username or email address another account has, ignoring capitals
 */
export class AccountTakenError extends Error
{
	/**
	 * @param field Which of the two is taken
	 */
	constructor(readonly field: 'username' | 'email')
	{
		super(`Another account has that ${field}`);
		this.name = 'AccountTakenError';
	}
}

/**
 * Postgres's code for a row that breaks a unique index
 */
const UNIQUE_VIOLATION = '23505';

/**
 * Which taken field each unique index on players stands for
 */
const UNIQUE_INDEX_FIELDS: Readonly<Record<string, 'username' | 'email'>> = {
	players_username_lower_unique: 'username',
	players_email_lower_unique: 'email'
};

const profileColumns = {
	id: players.id,
	username: players.username,
	displayName: players.displayName
};

/**
 * Which field an error says is taken, when it is a unique violation on players
 *
 * @param error What a query threw
 * @return The field, or undefined for any other error
 */
function takenField(error: unknown): 'username' | 'email' | undefined
{
	// Drizzle wraps the driver's error, which it keeps as the cause
	const cause = ((error instanceof Error) ? (error.cause ?? error) : error);

	if ((typeof cause !== 'object') || (cause === null) || !('code' in cause) || (cause.code !== UNIQUE_VIOLATION) || !('constraint' in cause) || (typeof cause.constraint !== 'string'))
	{
		return(undefined);
	}

	return(UNIQUE_INDEX_FIELDS[cause.constraint]);
}

/**
 * Creates an account
 *
 * @param player The account
 * @param executor The database, or a transaction
 * @return The account
 * @throws AccountTakenError when another account has the username or email address
 */
export async function createPlayer(player: NewPlayer, executor: Executor = db): Promise<PlayerProfile>
{
	try
	{
		const [created] = await executor
			.insert(players)
			.values(player)
			.returning(profileColumns);

		return(created);
	}
	catch (error)
	{
		const field = takenField(error);

		if (field !== undefined)
		{
			throw new AccountTakenError(field);
		}

		throw error;
	}
}

/**
 * Finds an account by ID
 *
 * @param playerId The account's ID
 * @param executor The database, or a transaction
 * @return The account, or undefined when it doesn't exist
 */
export async function findPlayer(playerId: string, executor: Executor = db): Promise<PlayerProfile | undefined>
{
	const [row] = await executor
		.select(profileColumns)
		.from(players)
		.where(eq(players.id, playerId))
		.limit(1);

	return(row);
}

/**
 * Finds an account by username, ignoring capitals
 *
 * @param username The username
 * @param executor The database, or a transaction
 * @return The account, or undefined when no account has it
 */
export async function findPlayerByUsername(username: string, executor: Executor = db): Promise<PlayerProfile | undefined>
{
	const [row] = await executor
		.select(profileColumns)
		.from(players)
		.where(sql`lower(${players.username}) = lower(${username})`)
		.limit(1);

	return(row);
}

/**
 * Finds the account with an email address, ignoring capitals
 *
 * @param email The address
 * @param executor The database, or a transaction
 * @return The account's ID, or undefined when no account has it
 */
export async function findPlayerIdByEmail(email: string, executor: Executor = db): Promise<string | undefined>
{
	const [row] = await executor
		.select({
			id: players.id
		})
		.from(players)
		.where(sql`lower(${players.email}) = lower(${email.trim()})`)
		.limit(1);

	return(row?.id);
}

/**
 * Finds the local account that logs in with an email address, ignoring capitals
 *
 * @param email The address
 * @param executor The database, or a transaction
 * @return The account's ID and password hash, or undefined when no account with a password has it
 */
export async function findLocalLogin(email: string, executor: Executor = db): Promise<LocalLogin | undefined>
{
	const [row] = await executor
		.select({
			id: players.id,
			passwordHash: players.passwordHash
		})
		.from(players)
		.where(sql`lower(${players.email}) = lower(${email.trim()})`)
		.limit(1);

	if (!row || (row.passwordHash === null))
	{
		return(undefined);
	}

	return({
		id: row.id,
		passwordHash: row.passwordHash
	});
}

/**
 * An account's email address
 *
 * @param playerId The account's ID
 * @param executor The database, or a transaction
 * @return The address, or null when the account has none or doesn't exist
 */
export async function findPlayerEmail(playerId: string, executor: Executor = db): Promise<string | null>
{
	const [row] = await executor
		.select({
			email: players.email
		})
		.from(players)
		.where(eq(players.id, playerId))
		.limit(1);

	return((row?.email ?? null));
}

/**
 * Stores an account's new password hash
 *
 * @param playerId The account's ID
 * @param passwordHash The hash
 * @param executor The database, or a transaction
 */
export async function savePasswordHash(playerId: string, passwordHash: string, executor: Executor = db): Promise<void>
{
	await executor
		.update(players)
		.set({
			passwordHash
		})
		.where(eq(players.id, playerId));
}

/**
 * Changes an account's email address
 *
 * @param playerId The account's ID
 * @param email The new address
 * @param executor The database, or a transaction
 * @throws AccountTakenError when another account has the address
 */
export async function saveEmail(playerId: string, email: string, executor: Executor = db): Promise<void>
{
	try
	{
		await executor
			.update(players)
			.set({
				email
			})
			.where(eq(players.id, playerId));
	}
	catch (error)
	{
		const field = takenField(error);

		if (field !== undefined)
		{
			throw new AccountTakenError(field);
		}

		throw error;
	}
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
