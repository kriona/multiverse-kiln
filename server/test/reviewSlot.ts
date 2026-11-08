/**
 * Which of the kiln-review skill's slots this process's tests run in, so verifiers running repro tests at
 * once each have a database and a test server port of their own
 * (.agents/skills/kiln-review/references/verification.md)
 *
 * A repro test runs under mocha without --parallel, which would use the test database itself and port
 * 2568, so two at once would empty each other's database. TEST_REVIEW_SLOT=<1 to 4> runs them against
 * kiln_review_<slot>_test instead (reviewDatabaseUrl() in testDatabase.ts), which
 * docker/postgres/init/02-databases.sh creates, on a port after the parallel workers' (testServer.ts)
 */

/**
 * How many slots have a database of their own: kiln_review_1_test to kiln_review_4_test
 */
export const MAX_REVIEW_SLOTS = 4;

/**
 * This process's slot: 0 when TEST_REVIEW_SLOT is unset, otherwise 1 to MAX_REVIEW_SLOTS
 */
export const reviewSlot = readReviewSlot(process.env.TEST_REVIEW_SLOT, process.env.MOCHA_WORKER_ID);

/**
 * Reads the slot from TEST_REVIEW_SLOT
 *
 * @param value TEST_REVIEW_SLOT
 * @param workerId MOCHA_WORKER_ID, which mocha sets in each parallel worker
 * @return The slot, or 0 when there is none
 * @throws Error when the slot isn't one of the slots there are, or mocha runs in parallel, whose
 * workers would share the slot's one database
 */
export function readReviewSlot(value: string | undefined, workerId: string | undefined): number
{
	if ((value === undefined) || (value === ''))
	{
		return(0);
	}

	const slot = Number(value);

	if (!Number.isInteger(slot) || (slot < 1) || (slot > MAX_REVIEW_SLOTS))
	{
		throw new Error(`TEST_REVIEW_SLOT is ${JSON.stringify(value)}: it must be a whole number from 1 to ${MAX_REVIEW_SLOTS}`);
	}

	if (workerId !== undefined)
	{
		throw new Error('TEST_REVIEW_SLOT gives the tests one database, so run them without --parallel');
	}

	return(slot);
}
