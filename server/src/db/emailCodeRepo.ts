/**
 * Email codes waiting to be entered: the only module that reads or writes the email_codes table
 *
 * The rules a code follows are in server/src/logic/emailCodes.ts; this module only stores codes
 */
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { EmailCodePurpose } from '@multiverse-kiln/shared';

import { EMAIL_CODE_LIFETIME_MS } from '../logic/emailCodes.js';
import { db, type Executor } from './client.js';
import { emailCodes } from './schema.js';

/**
 * A code as stored
 */
export interface EmailCodeRecord
{
	id: string;
	purpose: EmailCodePurpose;
	addressHash: Uint8Array;

	/**
	 * The account a password reset, email change or provider link is for; null when registering
	 */
	playerId: string | null;

	codeHash: Uint8Array;
	sentAt: Date;
	wrongGuesses: number;
	usedAt: Date | null;
	continuationExpiresAt: Date | null;
}

/**
 * A code to store
 */
export interface NewEmailCode
{
	purpose: EmailCodePurpose;
	addressHash: Uint8Array;
	playerId: string | null;
	codeHash: Uint8Array;
}

const recordColumns = {
	id: emailCodes.id,
	purpose: emailCodes.purpose,
	addressHash: emailCodes.addressHash,
	playerId: emailCodes.playerId,
	codeHash: emailCodes.codeHash,
	sentAt: emailCodes.sentAt,
	wrongGuesses: emailCodes.wrongGuesses,
	usedAt: emailCodes.usedAt,
	continuationExpiresAt: emailCodes.continuationExpiresAt
};

/**
 * Stores a newly sent code, replacing any code for the same purpose and address
 *
 * @param code The code
 * @param now When it was sent
 * @param executor The database, or a transaction
 */
export async function replaceEmailCode(code: NewEmailCode, now: Date, executor: Executor = db): Promise<void>
{
	const values = {
		...code,
		sentAt: now,
		wrongGuesses: 0,
		usedAt: null,
		continuationHash: null,
		continuationExpiresAt: null
	};

	await executor
		.insert(emailCodes)
		.values(values)
		.onConflictDoUpdate({
			target: [emailCodes.purpose, emailCodes.addressHash],
			set: values
		});
}

/**
 * Finds and locks the code for a purpose and address until the transaction ends, so guesses made at
 * once are counted one after another
 *
 * @param purpose What the code is for
 * @param addressHash Keyed hash of the address
 * @param executor A transaction
 * @return The code, or undefined when none was sent
 */
export async function lockEmailCode(purpose: EmailCodePurpose, addressHash: Uint8Array, executor: Executor): Promise<EmailCodeRecord | undefined>
{
	const [row] = await executor
		.select(recordColumns)
		.from(emailCodes)
		.where(and(
			eq(emailCodes.purpose, purpose),
			eq(emailCodes.addressHash, addressHash)
		))
		.for('update');

	return(row);
}

/**
 * Counts a wrong guess against a code
 *
 * @param codeId The code
 * @param executor The database, or a transaction
 */
export async function recordWrongEmailCodeGuess(codeId: string, executor: Executor = db): Promise<void>
{
	await executor
		.update(emailCodes)
		.set({
			wrongGuesses: sql`${emailCodes.wrongGuesses} + 1`
		})
		.where(eq(emailCodes.id, codeId));
}

/**
 * Marks a code as used, and gives the next step to the browser holding the continuation token
 *
 * @param codeId The code
 * @param continuationHash Hash of the token in that browser's cookie (hashToken())
 * @param now When the code was used
 * @param expiresAt When the next step must be taken by
 * @param executor The database, or a transaction
 */
export async function useEmailCode(codeId: string, continuationHash: Uint8Array, now: Date, expiresAt: Date, executor: Executor = db): Promise<void>
{
	await executor
		.update(emailCodes)
		.set({
			usedAt: now,
			continuationHash,
			continuationExpiresAt: expiresAt
		})
		.where(eq(emailCodes.id, codeId));
}

/**
 * Finds and locks the used code whose next step a browser's continuation token allows, if that step
 * hasn't expired
 *
 * @param purpose What the code was for
 * @param continuationHash Hash of the token in the browser's cookie
 * @param now The time now
 * @param executor A transaction
 * @return The code, or undefined when the token doesn't allow a step now
 */
export async function lockContinuation(purpose: EmailCodePurpose, continuationHash: Uint8Array, now: Date, executor: Executor): Promise<EmailCodeRecord | undefined>
{
	const [row] = await executor
		.select(recordColumns)
		.from(emailCodes)
		.where(and(
			eq(emailCodes.purpose, purpose),
			eq(emailCodes.continuationHash, continuationHash),
			gt(emailCodes.continuationExpiresAt, now)
		))
		.for('update');

	return(row);
}

/**
 * Deletes a code, once its next step is taken
 *
 * @param codeId The code
 * @param executor The database, or a transaction
 */
export async function deleteEmailCode(codeId: string, executor: Executor = db): Promise<void>
{
	await executor
		.delete(emailCodes)
		.where(eq(emailCodes.id, codeId));
}

/**
 * Deletes every code that can no longer be entered and whose next step, if any, has expired
 *
 * @param now The time now
 * @param executor The database, or a transaction
 * @return How many were deleted
 */
export async function deleteStaleEmailCodes(now: Date, executor: Executor = db): Promise<number>
{
	const rows = await executor
		.delete(emailCodes)
		.where(and(
			lte(emailCodes.sentAt, new Date(now.getTime() - EMAIL_CODE_LIFETIME_MS)),
			or(
				isNull(emailCodes.continuationExpiresAt),
				lte(emailCodes.continuationExpiresAt, now)
			)
		))
		.returning({
			id: emailCodes.id
		});

	return(rows.length);
}
