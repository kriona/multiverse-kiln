/**
 * Player accounts: the only module that reads or writes the players table
 */
import { and, count, eq, exists, isNotNull, not, sql } from 'drizzle-orm';
import type { LoginProvider, ProfileLanguage, SocialSite, SocialUsernames } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { authenticators, players, providerLogins, serverAdmins } from './schema.js';
import { anyColumnContains } from './textSearch.js';

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
 * What other players can read of a player's profile
 */
export interface ProfileDetails
{
	id: string;
	username: string;
	displayName: string;
	pronouns: string | null;
	location: string | null;
	timeZone: string | null;
	languages: ProfileLanguage[];
	socials: SocialUsernames;

	/**
	 * The language the player chose, or null when the pages follow the browser's settings. Other
	 * players see it only as the language of their pronouns
	 */
	locale: string | null;

	/**
	 * Whether the profile lists all of the player's characters, or only those marked visible
	 */
	showCharacters: boolean;
}

/**
 * A player's profile as they see it themselves
 */
export interface OwnProfileDetails extends ProfileDetails
{
	email: string | null;
	hasPassword: boolean;
	createdAt: Date;

	/**
	 * When the player last logged in, or null when they never have
	 */
	lastLoginAt: Date | null;
}

/**
 * What a player can change on their profile
 */
export type ProfileChanges = Omit<OwnProfileDetails, 'id' | 'email' | 'hasPassword' | 'createdAt' | 'lastLoginAt'>;

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
 * An account's password hash
 *
 * @param playerId The account's ID
 * @param executor The database, or a transaction
 * @return The hash, or null when the account has no password or doesn't exist
 */
export async function findPasswordHash(playerId: string, executor: Executor = db): Promise<string | null>
{
	const [row] = await executor
		.select({
			passwordHash: players.passwordHash
		})
		.from(players)
		.where(eq(players.id, playerId))
		.limit(1);

	return((row?.passwordHash ?? null));
}

/**
 * The columns of a profile other players can read
 */
const publicProfileColumns = {
	id: players.id,
	username: players.username,
	displayName: players.displayName,
	pronouns: players.pronouns,
	location: players.location,
	timeZone: players.timeZone,
	languages: players.languages,
	discord: players.discordUsername,
	facebook: players.facebookUsername,
	instagram: players.instagramUsername,
	tiktok: players.tiktokUsername,
	locale: players.locale,
	showCharacters: players.showCharacters
};

/**
 * A profile's row with its social usernames gathered together
 *
 * @param row The row, with a column for each social site
 * @return The profile
 */
function toProfile<T extends Record<SocialSite, string | null>>(row: T): Omit<T, SocialSite> & { socials: SocialUsernames }
{
	const { discord, facebook, instagram, tiktok, ...rest } = row;

	return({
		...rest,
		socials: { discord, facebook, instagram, tiktok }
	});
}

/**
 * Finds a profile by its username, ignoring capitals
 *
 * @param username The username
 * @param executor The database, or a transaction
 * @return What other players can read of it, or undefined when no account has the username
 */
export async function findProfileByUsername(username: string, executor: Executor = db): Promise<ProfileDetails | undefined>
{
	const [row] = await executor
		.select(publicProfileColumns)
		.from(players)
		.where(sql`lower(${players.username}) = lower(${username})`)
		.limit(1);

	return((row ? toProfile(row) : undefined));
}

/**
 * A player's own profile, with what only they see of their account
 *
 * @param playerId The account's ID
 * @param executor The database, or a transaction
 * @return The profile, or undefined when the account doesn't exist
 */
export async function findOwnProfile(playerId: string, executor: Executor = db): Promise<OwnProfileDetails | undefined>
{
	const [row] = await executor
		.select({
			...publicProfileColumns,
			email: players.email,
			hasPassword: sql<boolean>`${players.passwordHash} IS NOT NULL`,
			createdAt: players.createdAt,
			lastLoginAt: players.lastLoginAt
		})
		.from(players)
		.where(eq(players.id, playerId))
		.limit(1);

	return((row ? toProfile(row) : undefined));
}

/**
 * Saves the changes a player made to their profile
 *
 * @param playerId The account's ID
 * @param changes The profile's new values
 * @param executor The database, or a transaction
 * @throws AccountTakenError when another account has the username
 */
export async function saveProfile(playerId: string, changes: ProfileChanges, executor: Executor = db): Promise<void>
{
	const { socials, ...rest } = changes;

	try
	{
		await executor
			.update(players)
			.set({
				...rest,
				discordUsername: socials.discord,
				facebookUsername: socials.facebook,
				instagramUsername: socials.instagram,
				tiktokUsername: socials.tiktok
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
 * Records that a player logged in
 *
 * @param playerId The player's ID
 * @param now When they logged in
 * @param executor The database, or a transaction
 */
export async function saveLastLogin(playerId: string, now: Date, executor: Executor = db): Promise<void>
{
	await executor
		.update(players)
		.set({
			lastLoginAt: now
		})
		.where(eq(players.id, playerId));
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

/**
 * Deletes a player's account, and with it their profile, characters, sessions, logins, 2FA, auth events
 * and roles in universes. Groups whose anchor being was one of their characters go with them
 *
 * @param playerId The player's ID
 * @param executor The database, or a transaction
 * @return Whether there was an account to delete
 */
export async function deletePlayer(playerId: string, executor: Executor = db): Promise<boolean>
{
	const deleted = await executor
		.delete(players)
		.where(eq(players.id, playerId))
		.returning({ id: players.id });

	return(deleted.length > 0);
}

/**
 * A player account as the admin pages list it
 */
export interface AdminPlayerRecord
{
	id: string;
	username: string;
	displayName: string;
	email: string | null;
	createdAt: Date;

	/**
	 * When the account last logged in, or null when it never has
	 */
	lastLoginAt: Date | null;

	hasPassword: boolean;
	providers: LoginProvider[];
	twoFactor: boolean;
	serverAdmin: boolean;
}

/**
 * What a list of accounts for the admin pages is narrowed to
 */
export interface AdminPlayerFilter
{
	/**
	 * Text the username, name or email address holds, ignoring capitals
	 */
	search?: string;

	/**
	 * Only server admins (true), or only other players (false)
	 */
	serverAdmin?: boolean;
}

/**
 * A page of the player accounts, for the admin pages, with how each logs in and whether it is a server
 * admin. Reads the provider_logins, authenticators and server_admins tables for that
 *
 * @param filter What to narrow the list to
 * @param page How many matching accounts to skip, and the most to return
 * @param executor The database, or a transaction
 * @return The accounts, by username ignoring case, and how many match in all
 */
export async function listPlayersForAdmin(filter: AdminPlayerFilter, page: { offset: number; limit: number }, executor: Executor = db): Promise<{ players: AdminPlayerRecord[]; total: number }>
{
	const isAdmin = exists(executor
		.select({
			playerId: serverAdmins.playerId
		})
		.from(serverAdmins)
		.where(eq(serverAdmins.playerId, players.id)));
	const where = and(
		((filter.search === undefined) ? undefined : anyColumnContains([players.username, players.displayName, players.email], filter.search)),
		((filter.serverAdmin === undefined) ? undefined : (filter.serverAdmin ? isAdmin : not(isAdmin)))
	);
	const [rows, [counted]] = await Promise.all([
		executor
			.select({
				id: players.id,
				username: players.username,
				displayName: players.displayName,
				email: players.email,
				createdAt: players.createdAt,
				lastLoginAt: players.lastLoginAt,
				hasPassword: sql<boolean>`(${players.passwordHash} IS NOT NULL)`,
				providers: sql<LoginProvider[]>`coalesce((SELECT array_agg(${providerLogins.provider}::text ORDER BY ${providerLogins.provider}) FROM ${providerLogins} WHERE ${providerLogins.playerId} = ${players.id}), '{}'::text[])`,
				twoFactor: sql<boolean>`${exists(executor
					.select({
						playerId: authenticators.playerId
					})
					.from(authenticators)
					.where(and(
						eq(authenticators.playerId, players.id),
						isNotNull(authenticators.enabledAt)
					)))}`,
				serverAdmin: sql<boolean>`${isAdmin}`
			})
			.from(players)
			.where(where)
			.orderBy(sql`lower(${players.username})`)
			.offset(page.offset)
			.limit(page.limit),
		executor
			.select({
				total: count()
			})
			.from(players)
			.where(where)
	]);

	return({
		players: rows,
		total: counted.total
	});
}
