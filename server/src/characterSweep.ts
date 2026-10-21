/**
 * Deletes characters whose last rites' time has come: once as the server starts, then every hour. It
 * runs on its own timer, never in a room's simulation tick. Until a sweep deletes them, the character
 * repository hides them
 */
import { purgeExpiredCharacters } from './db/characterRepo.js';

/**
 * How often the sweep runs
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Deletes the characters whose time has come, logging what happened
 */
async function sweep(): Promise<void>
{
	try
	{
		const deleted = await purgeExpiredCharacters();

		if (deleted > 0)
		{
			console.log('Deleted', deleted, 'characters whose last rites were over');
		}
	}
	catch (error)
	{
		console.error('Could not delete the characters whose last rites were over:', error);
	}
}

/**
 * Sweeps now and every SWEEP_INTERVAL_MS. The timer doesn't keep the process running on its own
 *
 * @return Stops the sweeps
 */
export function startCharacterSweep(): () => void
{
	void sweep();

	const timer = setInterval(() =>
	{
		void sweep();
	}, SWEEP_INTERVAL_MS);

	timer.unref();

	return(() =>
	{
		clearInterval(timer);
	});
}
