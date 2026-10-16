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
