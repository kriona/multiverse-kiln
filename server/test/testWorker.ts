/**
 * Which of mocha's parallel workers this process is, so each worker has a database and a port of its own
 *
 * `npm test` runs the test files in parallel (mocha's --parallel), each worker a process of its own that
 * runs one file after another. Mocha numbers the workers from 0 in MOCHA_WORKER_ID. Running mocha
 * without --parallel runs every file in this one process, which is worker 0 here
 */

/**
 * How many workers have a database of their own: kiln_test_1 to kiln_test_8, which
 * docker/postgres/init/02-databases.sh creates. `npm test` runs 6 workers (--jobs 6 in package.json),
 * which leaves databases for workers mocha starts to replace ones that crash
 */
export const MAX_TEST_WORKERS = 8;

/**
 * This process's worker: 0 when the tests run in one process, otherwise 1 for mocha's first parallel
 * worker, 2 for the second and so on
 */
export const testWorker = readTestWorker(process.env.MOCHA_WORKER_ID);

/**
 * Reads the worker from mocha's worker ID
 *
 * @param workerId MOCHA_WORKER_ID, which mocha sets in each parallel worker
 * @return The worker, counting from 1, or 0 outside a parallel worker
 */
function readTestWorker(workerId: string | undefined): number
{
	if (workerId === undefined)
	{
		return(0);
	}

	const worker = Number(workerId) + 1;

	// Mocha numbers a worker it starts to replace one that crashed after the rest, which can pass the last
	// database there is
	if (!Number.isInteger(worker) || (worker > MAX_TEST_WORKERS))
	{
		throw new Error(`Test worker ${worker} has no database: there are only ${MAX_TEST_WORKERS}. Run mocha with --jobs ${MAX_TEST_WORKERS} or fewer`);
	}

	return(worker);
}
