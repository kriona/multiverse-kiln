import assert from 'assert';
import { MAX_DISABLED_REASON_LENGTH } from '@multiverse-kiln/shared';

import { adminDb } from '../../src/db/adminClient.js';
import { createUniverse, deleteUniverse, findDisabledReason, findEditableUniverse, findUniverse, findUniverseDetails, isUniverseDeletionPrevented, listUniverses, lockUniverse, lockUniverseShared, setUniverseAreas, setUniverseDisabled, UniverseNameTakenError, updateUniverseSettings } from '../../src/db/universeRepo.js';
import { loadArea } from '../../src/db/areaRepo.js';
import { createCharacter } from '../../src/db/characterRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { liveVersion } from '../../src/db/universeVersions.js';
import { addPlayer } from '../players.js';
import { addUniverse, addArea, dwarfFighter, inTransactionWithoutWaiting, testLobbyRegionId } from './fixtures.js';

/**
 * Whether a query failed because it waited for a lock past inTransactionWithoutWaiting()'s timeout
 *
 * @param error What the query threw, which Drizzle wraps around Postgres's error
 * @return True for Postgres's lock_not_available
 */
function isLockTimeout(error: unknown): boolean
{
	const cause = ((error instanceof Error) ? error.cause : undefined);

	return(((cause as { code?: string } | undefined)?.code === '55P03'));
}

describe('universeRepo', () =>
{
	it('creates a universe still being built, with no areas yet', async () =>
	{
		const universeId = await createUniverse({ name: 'Kilnhaven', shortDescription: 'A small town.', ruleset: 'pf1e' });

		assert.deepStrictEqual(await findUniverse(universeId), {
			id: universeId,
			name: 'Kilnhaven',
			shortDescription: 'A small town.',
			stage: 'in_the_beginning',
			ruleset: 'pf1e',
			lobbyAreaId: undefined,
			lobbyColumn: 0,
			lobbyRow: 0,
			startingAreaId: undefined,
			startingColumn: 0,
			startingRow: 0,
			disabled: false,
			requireTwoFactor: false,
			requireBuilderDraft: true
		});
	});

	it('disables a universe with a reason, leaving it out of the lists and pages until it is enabled again', async () =>
	{
		const universeId = await addUniverse('Kilnhaven');

		await updateUniverseSettings(liveVersion(universeId), { stage: 'let_there_be_light' });

		assert.strictEqual(await setUniverseDisabled(universeId, {
			reason: 'Spam',
			preventDeletion: true
		}, adminDb), true);
		assert.strictEqual(await setUniverseDisabled(universeId, {
			reason: 'Spam again',
			preventDeletion: false
		}, adminDb), false);
		assert.strictEqual((await findUniverse(universeId))?.disabled, true);
		assert.strictEqual(await findDisabledReason(universeId), 'Spam');
		assert.strictEqual(await isUniverseDeletionPrevented(universeId), true);
		assert.strictEqual((await findEditableUniverse(liveVersion(universeId)))?.disabledReason, 'Spam');
		assert.deepStrictEqual(await listUniverses('let_there_be_light', 0, 10), []);
		assert.strictEqual(await findUniverseDetails(universeId), undefined);

		assert.strictEqual(await setUniverseDisabled(universeId, null, adminDb), true);
		assert.strictEqual(await setUniverseDisabled(universeId, null, adminDb), false);
		assert.strictEqual(await findDisabledReason(universeId), null);
		assert.strictEqual(await isUniverseDeletionPrevented(universeId), false);
		assert.deepStrictEqual((await listUniverses('let_there_be_light', 0, 10)).map((universe) => universe.id), [universeId]);
		assert.strictEqual((await findUniverseDetails('kilnhaven'))?.id, universeId);
	});

	it('locks a universe without keeping rows that refer to it from being added', async () =>
	{
		const universeId = await addUniverse();
		const player = await addPlayer('Locksmith');
		const character = await dwarfFighter(player.id, universeId);

		await inTransaction(async (transaction) =>
		{
			assert.strictEqual(await lockUniverse(universeId, transaction), true);
			await inTransactionWithoutWaiting((other) => createCharacter(character, other));
		});
	});

	it('shares a universe\'s shared lock between transactions, but not with its lock', async () =>
	{
		const universeId = await addUniverse();

		await inTransaction(async (transaction) =>
		{
			assert.strictEqual(await lockUniverseShared(universeId, transaction), true);
			assert.strictEqual(await inTransactionWithoutWaiting((other) => lockUniverseShared(universeId, other)), true);
			await assert.rejects(inTransactionWithoutWaiting((other) => lockUniverse(universeId, other)), isLockTimeout);
		});

		await inTransaction(async (transaction) =>
		{
			await lockUniverse(universeId, transaction);
			await assert.rejects(inTransactionWithoutWaiting((other) => lockUniverseShared(universeId, other)), isLockTimeout);
		});

		assert.strictEqual(await inTransaction((transaction) => lockUniverseShared('00000000-0000-0000-0000-000000000000', transaction)), false);
	});

	it('refuses a disabled universe without a reason, or with one too long', async () =>
	{
		const universeId = await addUniverse();

		await assert.rejects(setUniverseDisabled(universeId, {
			reason: '',
			preventDeletion: false
		}, adminDb));
		await assert.rejects(setUniverseDisabled(universeId, {
			reason: 'x'.repeat(MAX_DISABLED_REASON_LENGTH + 1),
			preventDeletion: false
		}, adminDb));
		assert.strictEqual(await findDisabledReason(universeId), null);
	});

	it('sets the lobby region and the lobby and starting areas', async () =>
	{
		const universeId = await addUniverse();
		const lobbyId = await addArea(universeId, 'Lobby', { lobby: true });
		const startId = await addArea(universeId, 'Start');
		const lobbyRegionId = await testLobbyRegionId(universeId);

		await setUniverseAreas(universeId, {
			lobbyRegionId,
			lobbyAreaId: lobbyId,
			startingAreaId: startId
		});

		const universe = await findUniverse(universeId);

		assert.strictEqual(universe?.lobbyAreaId, lobbyId);
		assert.strictEqual(universe?.startingAreaId, startId);
		assert.strictEqual((await findEditableUniverse(liveVersion(universeId)))?.lobbyRegionId, lobbyRegionId);
	});

	it('finds a universe\'s details in any stage, with its stage', async () =>
	{
		const universeId = await addUniverse('Kilnhaven');

		assert.strictEqual((await findUniverseDetails(universeId))?.stage, 'in_the_beginning');

		await updateUniverseSettings(liveVersion(universeId), { stage: 'end_of_time' });

		assert.strictEqual((await findUniverseDetails('kilnhaven'))?.stage, 'end_of_time');
	});

	it('finds nothing for an unknown ID', async () =>
	{
		assert.strictEqual(await findUniverse('00000000-0000-4000-8000-000000000000'), undefined);
	});

	it('refuses a name another universe has, or one that could be mistaken for it', async () =>
	{
		await createUniverse({ name: 'The Shattered Isles', ruleset: 'pf1e' });

		// The last has a Cyrillic е
		for (const name of ['The Shattered Isles', 'the shattered isles', 'The Shattered-Isles!', 'TheShatteredIsles', 'The Shatt3red 1sles', 'Thе Shattered Isles'])
		{
			await assert.rejects(createUniverse({ name, ruleset: 'pf1e' }), UniverseNameTakenError, name);
		}
	});

	it('changes the slug with the name, and refuses a rename to another universe\'s name', async () =>
	{
		const isles = await createUniverse({ name: 'The Shattered Isles', ruleset: 'pf1e', stage: 'let_there_be_light' });
		const kilnhaven = await createUniverse({ name: 'Kilnhaven', ruleset: 'pf1e' });

		await updateUniverseSettings(liveVersion(isles), { name: 'Café Isles' });

		assert.strictEqual((await findUniverseDetails('café-isles'))?.id, isles);
		assert.strictEqual(await findUniverseDetails('the-shattered-isles'), undefined);
		await assert.rejects(updateUniverseSettings(liveVersion(kilnhaven), { name: 'CAFÉ ISLES' }), UniverseNameTakenError);
		assert.strictEqual((await findUniverse(kilnhaven))?.name, 'Kilnhaven');
	});

	it('deletes a universe with its areas', async () =>
	{
		const universeId = await addUniverse();
		const areaId = await addArea(universeId);

		assert.strictEqual(await deleteUniverse(universeId), true);
		assert.strictEqual(await findUniverse(universeId), undefined);
		assert.strictEqual(await loadArea(areaId), undefined);
		assert.strictEqual(await deleteUniverse(universeId), false);
	});
});
