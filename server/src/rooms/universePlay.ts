/**
 * Whether a player may play a universe, or look at it, in the stage it is in, which the rooms check as a
 * window joins
 */
import { canPlayUniverse, canViewUniverse } from '@multiverse-kiln/shared';

import { findUniverseRole } from '../db/universeEditorRepo.js';
import { findUniverse } from '../db/universeRepo.js';

/**
 * Whether a player may play a universe: it isn't disabled, and its stage and their role in it allow them to
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

	return((universe !== undefined) && !universe.disabled && canPlayUniverse(universe.stage, role));
}

/**
 * Whether a player may open their groups in a universe: it isn't disabled, and its stage and their role
 * in it let them look at it (canViewUniverse), which a universe at the end of time lets everyone do,
 * read-only
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @return True when they may; false too when the universe doesn't exist
 */
export async function mayViewUniverse(universeId: string, playerId: string): Promise<boolean>
{
	const [universe, role] = await Promise.all([
		findUniverse(universeId),
		findUniverseRole(universeId, playerId)
	]);

	return((universe !== undefined) && !universe.disabled && canViewUniverse(universe.stage, role));
}
