/**
 * Deletes the saves recorded for universes' Audit tabs once they are UNIVERSE_EDIT_DAYS old: once as the
 * server starts, then every hour. It runs on its own timer, never in a room's simulation tick
 */
import { deleteUniverseEditsBefore } from './db/universeEditRepo.js';
import { DAY_MS, HOUR_MS } from './logic/emailCodes.js';

/**
 * How often the sweep runs
 */
const SWEEP_INTERVAL_MS = HOUR_MS;

/**
 * How long a save is kept, in days. The Audit tab's hint (client/edit.html) and the privacy policy
 * (client/privacy.html) say so
 */
export const UNIVERSE_EDIT_DAYS = 90;

/**
 * The most saves one delete takes. The sweep deletes batch after batch until none are left, each in a
 * short transaction of its own, so a large backlog never holds locks on the table for long
 */
const BATCH_SIZE = 1000;

/**
 * Deletes every save older than UNIVERSE_EDIT_DAYS, a batch at a time, logging what fails
 *
 * @param now The time now
 * @param batchSize The most saves one delete takes
 * @return How many saves were deleted
 */
export async function sweepUniverseEdits(now: Date = new Date(), batchSize: number = BATCH_SIZE): Promise<number>
{
	const before = new Date(now.getTime() - (UNIVERSE_EDIT_DAYS * DAY_MS));
	let deleted = 0;

	try
	{
		let batch: number;

		do
		{
			batch = await deleteUniverseEditsBefore(before, batchSize);
			deleted += batch;
		}
		while (batch === batchSize);
	}
	catch (error)
	{
		console.error('Could not delete the old saves from universes\' audit records:', error);
	}

	return(deleted);
}

/**
 * Sweeps now and every SWEEP_INTERVAL_MS. The timer doesn't keep the process running on its own
 *
 * @return Stops the sweeps
 */
export function startUniverseEditSweep(): () => void
{
	void sweepUniverseEdits();

	const timer = setInterval(() =>
	{
		void sweepUniverseEdits();
	}, SWEEP_INTERVAL_MS);

	timer.unref();

	return(() =>
	{
		clearInterval(timer);
	});
}
