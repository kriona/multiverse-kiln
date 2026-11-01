/**
 * Whether a player may play a universe in the stage it is in, which the rooms check as a window joins
 */
import { canPlayUniverse } from '@multiverse-kiln/shared';

import { findUniverseRole } from '../db/universeEditorRepo.js';
import { findUniverse } from '../db/universeRepo.js';

/**
 * Whether a player may play a universe: its stage and their role in it allow them to
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @return True when they may; false too when the universe doesn't exist
 */
export async function mayPlayUniverse(universeId: string, playerId: string): Promise<boolean>
{
	const [universe, role] = await Promise.all([
		findUniverse(universeId),
		findUniverseRole(universeId, playerId)
	]);

	return((universe !== undefined) && canPlayUniverse(universe.stage, role));
}
