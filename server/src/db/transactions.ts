/**
 * Transactions for callers outside this folder: several repository calls that must succeed or fail together
 */
import { bulkDb, db, type Executor } from './client.js';

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
 * Runs repository calls in one transaction on the bulk pool (client.ts), for work that can hold its
 * connection for seconds, such as an editor save. The transaction commits when work resolves and rolls
 * back when it throws
 *
 * Work never starts another bulk transaction while it runs: with every bulk connection held by
 * transactions waiting for another, none could go on
 *
 * @param work The calls to make
 * @return What work resolves with
 */
export function inBulkTransaction<T>(work: (executor: Executor) => Promise<T>): Promise<T>
{
	return(bulkDb.transaction(work));
}

/**
 * Runs repository calls that only read in one transaction on the bulk pool (client.ts) that sees the
 * database as it was when its first call ran, so what they read fits together however long they take,
 * even while others save
 *
 * Like inBulkTransaction(), work never starts another bulk transaction while it runs
 *
 * @param work The calls to make, which can't write
 * @return What work resolves with
 */
export function inBulkSnapshot<T>(work: (executor: Executor) => Promise<T>): Promise<T>
{
	return(bulkDb.transaction(work, {
		isolationLevel: 'repeatable read',
		accessMode: 'read only'
	}));
}
