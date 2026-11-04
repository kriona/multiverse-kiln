/**
 * Which characters can't play in a universe, from the races and classes it has disabled for characters
 * already of them (see characterBar() in /shared). Reads through raceRepo and classRepo
 */
import type { BarredOptions } from '@multiverse-kiln/shared';

import type { Executor } from './client.js';
import { db } from './client.js';
import { listBarredClassIds } from './classRepo.js';
import { listBarredRaceIds } from './raceRepo.js';

/**
 * The races and classes whose characters can't play in a universe
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return Their IDs, as characters hold them
 */
export async function loadBarredOptions(universeId: string, executor: Executor = db): Promise<BarredOptions>
{
	return({
		raceIds: await listBarredRaceIds(universeId, executor),
		classIds: await listBarredClassIds(universeId, executor)
	});
}
