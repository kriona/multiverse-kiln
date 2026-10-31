/**
 * 2FA: the only module that reads or writes the authenticators, recovery_codes,
 * pending_two_factor_logins and trusted_browsers tables
 */
import { and, count, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { TwoFactorState } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { authenticators, pendingTwoFactorLogins, recoveryCodes, trustedBrowsers } from './schema.js';

/**
 * An account's authenticator, set up or turned on
 */
export interface AuthenticatorRecord
{
	/**
	 * The secret, encrypted (server/src/auth/totpSecrets.ts)
	 */
	encryptedSecret: Uint8Array;

	lastUsedStep: number | null;
	createdAt: Date;

	/**
	 * When 2FA was turned on, or null while it is being set up
	 */
	enabledAt: Date | null;
}

/**
 * A login waiting on the account's authenticator or recovery code
 */
export interface PendingTwoFactorLogin
{
	id: string;
	playerId: string;
	rememberMe: boolean;
	wrongGuesses: number;
}

/**
 * A new login waiting on the account's authenticator or recovery code
 */
export interface NewPendingTwoFactorLogin
{
	/**
	 * Hash of the token in the browser's continuation cookie
	 */
	continuationHash: Uint8Array;

	playerId: string;
	rememberMe: boolean;
	expiresAt: Date;
}

/**
 * Starts setting up an authenticator, replacing a setup the account already started. An account that
 * has 2FA on keeps its authenticator
 *
 * @param playerId The account
 * @param encryptedSecret The new secret, encrypted
 * @param now The time now
 * @param executor The database, or a transaction
 * @return Whether the setup was saved: false when the account has 2FA on
 */
export async function saveAuthenticatorSetup(playerId: string, encryptedSecret: Uint8Array, now: Date, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.insert(authenticators)
		.values({
			playerId,
			encryptedSecret,
			createdAt: now
		})
		.onConflictDoUpdate({
			target: authenticators.playerId,
			set: {
				encryptedSecret,
				lastUsedStep: null,
				createdAt: now
			},
			setWhere: isNull(authenticators.enabledAt)
		})
		.returning({
			playerId: authenticators.playerId
		});

	return((rows.length > 0));
}

/**
 * Finds and locks an account's authenticator, so two requests can't both use the same code
 *
 * @param playerId The account
 * @param executor A transaction
 * @return The authenticator, or undefined when the account has none
 */
export async function lockAuthenticator(playerId: string, executor: Executor): Promise<AuthenticatorRecord | undefined>
{
	const [row] = await executor
		.select({
			encryptedSecret: authenticators.encryptedSecret,
			lastUsedStep: authenticators.lastUsedStep,
			createdAt: authenticators.createdAt,
			enabledAt: authenticators.enabledAt
		})
		.from(authenticators)
		.where(eq(authenticators.playerId, playerId))
		.for('update');

	return(row);
}

/**
 * Whether an account has 2FA on
 *
 * @param playerId The account
 * @param executor The database, or a transaction
 * @return Whether it has
 */
export async function hasTwoFactor(playerId: string, executor: Executor = db): Promise<boolean>
{
	const [row] = await executor
		.select({
			playerId: authenticators.playerId
		})
		.from(authenticators)
		.where(and(
			eq(authenticators.playerId, playerId),
			isNotNull(authenticators.enabledAt)
		))
		.limit(1);

	return((row !== undefined));
}

/**
 * Records the time step of a code an account used, so it can't be used again
 *
 * @param playerId The account
 * @param step The code's time step
 * @param executor The database, or a transaction
 */
export async function saveLastUsedStep(playerId: string, step: number, executor: Executor = db): Promise<void>
{
	await executor
		.update(authenticators)
		.set({
			lastUsedStep: step
		})
		.where(eq(authenticators.playerId, playerId));
}

/**
 * Turns 2FA on, once the authenticator being set up gave its first code
 *
 * @param playerId The account
 * @param step The first code's time step
 * @param now The time now
 * @param executor The database, or a transaction
 */
export async function enableAuthenticator(playerId: string, step: number, now: Date, executor: Executor = db): Promise<void>
{
	await executor
		.update(authenticators)
		.set({
			lastUsedStep: step,
			enabledAt: now
		})
		.where(eq(authenticators.playerId, playerId));
}

/**
 * Turns 2FA off: deletes the account's authenticator, recovery codes, trusted browsers and logins
 * waiting on a code
 *
 * @param playerId The account
 * @param executor The database, or a transaction
 */
export async function deleteTwoFactor(playerId: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(authenticators)
		.where(eq(authenticators.playerId, playerId));
	await executor
		.delete(recoveryCodes)
		.where(eq(recoveryCodes.playerId, playerId));
	await deleteTrustedBrowsers(playerId, executor);
	await executor
		.delete(pendingTwoFactorLogins)
		.where(eq(pendingTwoFactorLogins.playerId, playerId));
}

/**
 * Replaces an account's recovery codes
 *
 * @param playerId The account
 * @param codeHashes Keyed hashes of the new codes
 * @param executor The database, or a transaction
 */
export async function replaceRecoveryCodes(playerId: string, codeHashes: readonly Uint8Array[], executor: Executor = db): Promise<void>
{
	await executor
		.delete(recoveryCodes)
		.where(eq(recoveryCodes.playerId, playerId));
	await executor
		.insert(recoveryCodes)
		.values(codeHashes.map((codeHash) => ({
			playerId,
			codeHash
		})));
}

/**
 * Uses one of an account's recovery codes, deleting it
 *
 * @param playerId The account
 * @param codeHash Keyed hash of the code typed
 * @param executor The database, or a transaction
 * @return Whether the account had the code
 */
export async function useRecoveryCode(playerId: string, codeHash: Uint8Array, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.delete(recoveryCodes)
		.where(and(
			eq(recoveryCodes.playerId, playerId),
			eq(recoveryCodes.codeHash, codeHash)
		))
		.returning({
			id: recoveryCodes.id
		});

	return((rows.length > 0));
}

/**
 * How many recovery codes an account has left
 *
 * @param playerId The account
 * @param executor The database, or a transaction
 * @return The number
 */
export async function countRecoveryCodes(playerId: string, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			codes: count()
		})
		.from(recoveryCodes)
		.where(eq(recoveryCodes.playerId, playerId));

	return((row?.codes ?? 0));
}

/**
 * Keeps a login whose password was right while the player enters their authenticator or recovery code
 *
 * @param login The login
 * @param executor The database, or a transaction
 */
export async function savePendingTwoFactorLogin(login: NewPendingTwoFactorLogin, executor: Executor = db): Promise<void>
{
	await executor
		.insert(pendingTwoFactorLogins)
		.values(login);
}

/**
 * Finds and locks the login waiting on a code that a browser's token allows, if it hasn't expired
 *
 * @param continuationHash Hash of the token in the browser's cookie
 * @param now The time now
 * @param executor A transaction
 * @return The login, or undefined when the token doesn't allow one now
 */
export async function lockPendingTwoFactorLogin(continuationHash: Uint8Array, now: Date, executor: Executor): Promise<PendingTwoFactorLogin | undefined>
{
	const [row] = await executor
		.select({
			id: pendingTwoFactorLogins.id,
			playerId: pendingTwoFactorLogins.playerId,
			rememberMe: pendingTwoFactorLogins.rememberMe,
			wrongGuesses: pendingTwoFactorLogins.wrongGuesses
		})
		.from(pendingTwoFactorLogins)
		.where(and(
			eq(pendingTwoFactorLogins.continuationHash, continuationHash),
			gt(pendingTwoFactorLogins.expiresAt, now)
		))
		.for('update');

	return(row);
}

/**
 * Counts a wrong code against a login waiting on one
 *
 * @param id The login
 * @param executor The database, or a transaction
 */
export async function recordWrongTwoFactorGuess(id: string, executor: Executor = db): Promise<void>
{
	await executor
		.update(pendingTwoFactorLogins)
		.set({
			wrongGuesses: sql`${pendingTwoFactorLogins.wrongGuesses} + 1`
		})
		.where(eq(pendingTwoFactorLogins.id, id));
}

/**
 * Deletes a login waiting on a code, once it is finished or guessed wrong too often
 *
 * @param id The login
 * @param executor The database, or a transaction
 */
export async function deletePendingTwoFactorLogin(id: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(pendingTwoFactorLogins)
		.where(eq(pendingTwoFactorLogins.id, id));
}

/**
 * Deletes every login waiting on a code whose time is up
 *
 * @param now The time now
 * @param executor The database, or a transaction
 * @return How many were deleted
 */
export async function deleteExpiredPendingTwoFactorLogins(now: Date, executor: Executor = db): Promise<number>
{
	const rows = await executor
		.delete(pendingTwoFactorLogins)
		.where(lte(pendingTwoFactorLogins.expiresAt, now))
		.returning({
			id: pendingTwoFactorLogins.id
		});

	return(rows.length);
}

/**
 * Trusts a browser for an account until a time, or extends its trust
 *
 * @param tokenHash Hash of the token in the browser's trust cookie
 * @param playerId The account
 * @param expiresAt When the trust ends
 * @param executor The database, or a transaction
 */
export async function trustBrowser(tokenHash: Uint8Array, playerId: string, expiresAt: Date, executor: Executor = db): Promise<void>
{
	await executor
		.insert(trustedBrowsers)
		.values({
			tokenHash,
			playerId,
			expiresAt
		})
		.onConflictDoUpdate({
			target: [trustedBrowsers.tokenHash, trustedBrowsers.playerId],
			set: {
				expiresAt
			}
		});
}

/**
 * Whether a browser is trusted for an account now
 *
 * @param tokenHash Hash of the token in the browser's trust cookie
 * @param playerId The account
 * @param now The time now
 * @param executor The database, or a transaction
 * @return Whether it is
 */
export async function isBrowserTrusted(tokenHash: Uint8Array, playerId: string, now: Date, executor: Executor = db): Promise<boolean>
{
	const [row] = await executor
		.select({
			id: trustedBrowsers.id
		})
		.from(trustedBrowsers)
		.where(and(
			eq(trustedBrowsers.tokenHash, tokenHash),
			eq(trustedBrowsers.playerId, playerId),
			gt(trustedBrowsers.expiresAt, now)
		))
		.limit(1);

	return((row !== undefined));
}

/**
 * Stops trusting every browser for an account
 *
 * @param playerId The account
 * @param executor The database, or a transaction
 */
export async function deleteTrustedBrowsers(playerId: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(trustedBrowsers)
		.where(eq(trustedBrowsers.playerId, playerId));
}

/**
 * Deletes every trusted browser whose trust has ended
 *
 * @param now The time now
 * @param executor The database, or a transaction
 * @return How many were deleted
 */
export async function deleteExpiredTrustedBrowsers(now: Date, executor: Executor = db): Promise<number>
{
	const rows = await executor
		.delete(trustedBrowsers)
		.where(lte(trustedBrowsers.expiresAt, now))
		.returning({
			id: trustedBrowsers.id
		});

	return(rows.length);
}

/**
 * An account's 2FA, as its own profile shows it
 *
 * @param playerId The account
 * @param now The time now
 * @param executor The database, or a transaction
 * @return The account's 2FA, or null when it is off
 */
export async function findTwoFactorState(playerId: string, now: Date, executor: Executor = db): Promise<TwoFactorState | null>
{
	if (!(await hasTwoFactor(playerId, executor)))
	{
		return(null);
	}

	const [browsers] = await executor
		.select({
			trusted: count()
		})
		.from(trustedBrowsers)
		.where(and(
			eq(trustedBrowsers.playerId, playerId),
			gt(trustedBrowsers.expiresAt, now)
		));

	return({
		recoveryCodesLeft: await countRecoveryCodes(playerId, executor),
		trustedBrowsers: (browsers?.trusted ?? 0)
	});
}
