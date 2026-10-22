/**
 * Deletes characters whose last rites' time has come, and invite links that have expired: once as the
 * server starts, then every hour. It runs on its own timer, never in a room's simulation tick. Until a
 * sweep deletes them, the repositories hide them
 */
import { purgeExpiredCharacters } from './db/characterRepo.js';
import { listExpiredMemberships, listMembersOfGroups, purgeExpiredInvites } from './db/groupRepo.js';
import { inTransaction } from './db/transactions.js';
import { deletionChange, groupChanges, type GroupChange } from './players/groupChanges.js';

/**
 * How often the sweep runs
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Deletes the characters whose time has come, telling their groups' rooms, then the expired invite
 * links, logging what happened
 */
async function sweep(): Promise<void>
{
	try
	{
		// The groups' members are read before the deletion takes the characters, and whole groups, with it
		const { deleted, changes } = await inTransaction(async (transaction) =>
		{
			const memberships = await listExpiredMemberships(transaction);
			const members = await listMembersOfGroups(memberships.map(({ groupId }) => groupId), transaction);
			const groupChangesMade = memberships
				.map((membership) => deletionChange(membership, membership.character.characterId, members.get(membership.groupId) ?? []))
				.filter((change): change is GroupChange => (change !== undefined));

			return({
				deleted: await purgeExpiredCharacters(transaction),
				changes: groupChangesMade
			});
		});

		for (const change of changes)
		{
			groupChanges.publish(change);
		}

		if (deleted > 0)
		{
			console.log('Deleted', deleted, 'characters whose last rites were over');
		}
	}
	catch (error)
	{
		console.error('Could not delete the characters whose last rites were over:', error);
	}

	try
	{
		await purgeExpiredInvites();
	}
	catch (error)
	{
		console.error('Could not delete the expired invite links:', error);
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
