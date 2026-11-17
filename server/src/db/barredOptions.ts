/**
 * Which characters can't play in a universe, from the races and classes it has disabled for characters
 * already of them, and the books it has turned off that way (see characterBar() in /shared). Reads
 * through raceRepo, classRepo and rulesetRepo
 */
import type { BarredOptions, Ruleset } from '@multiverse-kiln/shared';

import type { Executor } from './client.js';
import { db } from './client.js';
import { listBarredClassIds } from './classRepo.js';
import { listBarredRaceIds } from './raceRepo.js';
import { loadRulebookSettings } from './rulesetRepo.js';
import { liveVersion } from './universeVersions.js';

/**
 * The races and classes whose characters can't play in a universe, as its live version has them
 *
 * @param universeId The universe's ID
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return Their IDs, as characters hold them
 */
export async function loadBarredOptions(universeId: string, ruleset: Ruleset, executor: Executor = db): Promise<BarredOptions>
{
	const version = liveVersion(universeId);
	const { barredRulebooks } = await loadRulebookSettings(version, ruleset, executor);

	return({
		raceIds: await listBarredRaceIds(version, ruleset, barredRulebooks, executor),
		classIds: await listBarredClassIds(version, ruleset, barredRulebooks, executor)
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
