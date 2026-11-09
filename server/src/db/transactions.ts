/**
 * Transactions for callers outside this folder: several repository calls that must succeed or fail together
 */
import { db, type Executor } from './client.js';

/**
 * Runs repository calls in one transaction, passing each the transaction as its executor
 *
 * The transaction commits when work resolves and rolls back when it throws
 *
 * @param work The calls to make
 * @return What work resolves with
 */
export function inTransaction<T>(work: (executor: Executor) => Promise<T>): Promise<T>
{
	return(db.transaction(work));
}

/**
 * Runs repository calls that only read in one transaction that sees the database as it was when its
 * first call ran, so what they read fits together however long they take, even while others save
 *
 * @param work The calls to make, which can't write
 * @return What work resolves with
 */
export function inSnapshot<T>(work: (executor: Executor) => Promise<T>): Promise<T>
{
	return(db.transaction(work, {
		isolationLevel: 'repeatable read',
		accessMode: 'read only'
	}));
}
