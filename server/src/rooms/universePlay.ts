/**
 * Whether a player may play a universe, or look at it, in the stage it is in, which the rooms check as a
 * window joins, and if not, why not
 */
import { canPlayUniverse, canViewUniverse, ServerCloseCode, type UniverseRole, type UniverseStage } from '@multiverse-kiln/shared';

import { findUniverseRole } from '../db/universeEditorRepo.js';
import { findUniverse } from '../db/universeRepo.js';

/**
 * Why a player may not go into a universe: it doesn't exist, a server admin disabled it, it is at the
 * end of time (which locks only the lobby), or its stage and their role in it don't let them
 */
export type EntryRefusal = 'deleted' | 'disabled' | 'locked' | 'role';

/**
 * Why a player may not play a universe, when they may not: it doesn't exist, it is disabled, or its
 * stage and their role in it don't let them
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @return Why not; undefined when they may play it
 */
export async function findPlayRefusal(universeId: string, playerId: string): Promise<EntryRefusal | undefined>
{
	return(findRefusal(universeId, playerId, canPlayUniverse));
}

/**
 * Why a player may not open their groups in a universe, when they may not: it doesn't exist, it is
 * disabled, or its stage and their role in it don't let them look at it (canViewUniverse), which a
 * universe at the end of time lets everyone do, read-only
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @return Why not; undefined when they may open their groups
 */
export async function findViewRefusal(universeId: string, playerId: string): Promise<EntryRefusal | undefined>
{
	return(findRefusal(universeId, playerId, canViewUniverse));
}

/**
 * The code that turns away a window refused a universe, the same code the lobby and game rooms turn
 * windows away with when the same thing happens while they are in it
 *
 * @param refusal Why the window is refused
 * @param stageChanged Whether the universe's stage changed while the window joined, which is then why
 * its player's role no longer lets them in
 * @return The code
 */
export function entryRefusalCode(refusal: EntryRefusal, stageChanged: boolean): ServerCloseCode
{
	switch (refusal)
	{
		case 'deleted':
			return(ServerCloseCode.UniverseDeleted);

		case 'disabled':
			return(ServerCloseCode.UniverseDisabled);

		case 'locked':
			return(ServerCloseCode.UniverseLocked);

		case 'role':
			return((stageChanged ? ServerCloseCode.StageChanged : ServerCloseCode.AccessLost));
	}
}

/**
 * Why a player may not go into a universe, when they may not
 *
 * @param universeId The universe's ID
 * @param playerId The player's ID
 * @param mayEnter Whether the universe's stage and the player's role in it let them in
 * @return Why not; undefined when they may go in
 */
async function findRefusal(universeId: string, playerId: string, mayEnter: (stage: UniverseStage, role: UniverseRole | undefined) => boolean): Promise<EntryRefusal | undefined>
{
	const [universe, role] = await Promise.all([
		findUniverse(universeId),
		findUniverseRole(universeId, playerId)
	]);

	if (!universe)
	{
		return('deleted');
	}

	if (universe.disabled)
	{
		return('disabled');
	}

	if (mayEnter(universe.stage, role))
	{
		return(undefined);
	}

	// Everyone may look at a universe at the end of time, so only the lobby gets here, locked
	return(((universe.stage === 'end_of_time') ? 'locked' : 'role'));
}
