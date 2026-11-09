/**
 * Makes a change while a request waits for a universe's lock: after the request has checked the
 * universe, before it may go on, as a world editor save or a server admin holding the lock would
 */
import { sql } from 'drizzle-orm';

import { db, type Executor } from '../src/db/client.js';
import { inTransaction } from '../src/db/transactions.js';
import { lockUniverse } from '../src/db/universeRepo.js';
import { waitUntil } from './waitUntil.js';

/**
 * Whether another connection to the test database is waiting for a lock
 *
 * @return True when one is
 */
export async function someoneWaitsForALock(): Promise<boolean>
{
	const result = await db.execute<{ waiting: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()) AS waiting`);

	return((result.rows[0]?.waiting ?? false));
}

/**
 * Takes a universe's lock, sends a request, and once the request waits for the lock (or has answered
 * without waiting), makes a change in the transaction holding it and commits
 *
 * @param universeId The universe's ID
 * @param send Sends the request
 * @param change Makes the change, in the transaction holding the lock
 * @param transact Runs the transaction: inTransaction as the server's role, or inAdminTransaction for a
 * change only server admins may make, such as disabling the universe
 * @return What the request answered
 */
export async function changeWhileWaitingForUniverse<T>(universeId: string, send: () => Promise<T>, change: (transaction: Executor) => Promise<void>, transact: (work: (transaction: Executor) => Promise<void>) => Promise<void> = inTransaction): Promise<T>
{
	let answered = false;
	let answer: Promise<T> | undefined;

	await transact(async (transaction) =>
	{
		await lockUniverse(universeId, transaction);

		answer = send().finally(() =>
		{
			answered = true;
		});

		await waitUntil(async () => (answered || await someoneWaitsForALock()));
		await change(transaction);
	});

	if (!answer)
	{
		throw new Error('The request wasn\'t sent');
	}

	return(await answer);
}
