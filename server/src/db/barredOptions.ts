/**
 * Which characters can't play in a universe, from the races and classes it has disabled for characters
 * already of them (see characterBar() in /shared). Reads through raceRepo and classRepo
 */
import type { BarredOptions } from '@multiverse-kiln/shared';

import type { Executor } from './client.js';
import { db } from './client.js';
import { listBarredClassIds } from './classRepo.js';
import { listBarredRaceIds } from './raceRepo.js';
import { liveVersion } from './universeVersions.js';

/**
 * The races and classes whose characters can't play in a universe, as its live version has them
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return Their IDs, as characters hold them
 */
export async function loadBarredOptions(universeId: string, executor: Executor = db): Promise<BarredOptions>
{
	const version = liveVersion(universeId);

	return({
		raceIds: await listBarredRaceIds(version, executor),
		classIds: await listBarredClassIds(version, executor)
	});
}

/**
 * Whether two sets of barred races and classes are the same
 *
 * @param first One set
 * @param second The other
 * @return True when they bar the same races and classes
 */
export function sameBarred(first: BarredOptions, second: BarredOptions): boolean
{
	const sameIds = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => ((a.size === b.size) && [...a].every((id) => b.has(id)));

	return(sameIds(first.raceIds, second.raceIds) && sameIds(first.classIds, second.classIds));
}
