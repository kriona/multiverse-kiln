/**
 * Provider logins: the only module that reads or writes the provider_logins and
 * pending_provider_logins tables
 */
import { and, eq, gt, lte } from 'drizzle-orm';
import type { LoginProvider } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { pendingProviderLogins, providerLogins } from './schema.js';

/**
 * A provider login waiting on the player's next step
 */
export interface PendingProviderLogin
{
	id: string;
	provider: LoginProvider;
	providerUserId: string;
	email: string;
	displayName: string;

	/**
	 * The local account with the same address, to link to; null for a new account
	 */
	playerId: string | null;

	rememberMe: boolean;
}

/**
 * A provider login to keep while the player takes the next step
 */
export interface NewPendingProviderLogin extends Omit<PendingProviderLogin, 'id'>
{
	/**
	 * SHA-256 of the token in the browser's cookie (hashToken())
	 */
	continuationHash: Uint8Array;

	expiresAt: Date;
}

/**
 * Thrown when a provider login can't be linked to an account: the provider account is linked to
 * another, or the account already has a login with that provider
 */
export class ProviderLoginTakenError extends Error
{
	/**
	 * @param by Whether another account has the provider account, or the account has another login with the provider
	 */
	constructor(readonly by: 'otherAccount' | 'otherLogin')
	{
		super((by === 'otherAccount') ? 'Another account has that provider login' : 'The account already has a login with that provider');
		this.name = 'ProviderLoginTakenError';
	}
}

/**
 * Postgres's code for a row that breaks a unique index
 */
const UNIQUE_VIOLATION = '23505';

/**
 * The account a provider login belongs to
 *
 * @param provider The provider
 * @param providerUserId The provider's ID for its user
 * @param executor The database, or a transaction
 * @return The account's ID, or undefined when no account has it
 */
export async function findProviderLoginPlayer(provider: LoginProvider, providerUserId: string, executor: Executor = db): Promise<string | undefined>
{
	const [row] = await executor
		.select({
			playerId: providerLogins.playerId
		})
		.from(providerLogins)
		.where(and(
			eq(providerLogins.provider, provider),
			eq(providerLogins.providerUserId, providerUserId)
		))
		.limit(1);

	return(row?.playerId);
}

/**
 * Links a provider login to an account
 *
 * @param provider The provider
 * @param providerUserId The provider's ID for its user
 * @param playerId The account
 * @param executor The database, or a transaction
 * @throws ProviderLoginTakenError when another account has the provider login, or the account already has one with that provider
 */
export async function addProviderLogin(provider: LoginProvider, providerUserId: string, playerId: string, executor: Executor = db): Promise<void>
{
	try
	{
		await executor
			.insert(providerLogins)
			.values({
				provider,
				providerUserId,
				playerId
			});
	}
	catch (error)
	{
		// Drizzle wraps the driver's error, which it keeps as the cause
		const cause = ((error instanceof Error) ? (error.cause ?? error) : error);

		if ((typeof cause === 'object') && (cause !== null) && ('code' in cause) && (cause.code === UNIQUE_VIOLATION) && ('constraint' in cause))
		{
			throw new ProviderLoginTakenError((cause.constraint === 'provider_logins_player_provider_unique') ? 'otherLogin' : 'otherAccount');
		}

		throw error;
	}
}

/**
 * Keeps a provider login while the player takes the next step
 *
 * @param login The login
 * @param executor The database, or a transaction
 */
export async function savePendingProviderLogin(login: NewPendingProviderLogin, executor: Executor = db): Promise<void>
{
	await executor
		.insert(pendingProviderLogins)
		.values(login);
}

/**
 * Finds and locks the pending provider login a browser's token allows, if it hasn't expired, so two
 * requests can't both use it
 *
 * @param continuationHash Hash of the token in the browser's cookie
 * @param now The time now
 * @param executor A transaction
 * @return The login, or undefined when the token doesn't allow one now
 */
export async function lockPendingProviderLogin(continuationHash: Uint8Array, now: Date, executor: Executor): Promise<PendingProviderLogin | undefined>
{
	const [row] = await executor
		.select({
			id: pendingProviderLogins.id,
			provider: pendingProviderLogins.provider,
			providerUserId: pendingProviderLogins.providerUserId,
			email: pendingProviderLogins.email,
			displayName: pendingProviderLogins.displayName,
			playerId: pendingProviderLogins.playerId,
			rememberMe: pendingProviderLogins.rememberMe
		})
		.from(pendingProviderLogins)
		.where(and(
			eq(pendingProviderLogins.continuationHash, continuationHash),
			gt(pendingProviderLogins.expiresAt, now)
		))
		.for('update');

	return(row);
}

/**
 * Deletes a pending provider login, once its next step is taken
 *
 * @param id The login
 * @param executor The database, or a transaction
 */
export async function deletePendingProviderLogin(id: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(pendingProviderLogins)
		.where(eq(pendingProviderLogins.id, id));
}

/**
 * Deletes every pending provider login whose time is up
 *
 * @param now The time now
 * @param executor The database, or a transaction
 * @return How many were deleted
 */
export async function deleteExpiredPendingProviderLogins(now: Date, executor: Executor = db): Promise<number>
{
	const rows = await executor
		.delete(pendingProviderLogins)
		.where(lte(pendingProviderLogins.expiresAt, now))
		.returning({
			id: pendingProviderLogins.id
		});

	return(rows.length);
}
