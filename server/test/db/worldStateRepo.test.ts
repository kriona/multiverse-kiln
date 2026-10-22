import assert from 'assert';

import { deleteArea } from '../../src/db/areaRepo.js';
import { leaveGroup } from '../../src/db/groupRepo.js';
import { loadOrCreatePlayerByName } from '../../src/db/playerRepo.js';
import { loadSeenChunks, saveSeenChunks } from '../../src/db/worldStateRepo.js';
import { SEEN_CHUNK_BYTES } from '../../src/logic/seenCells.js';
import { addCharacter, addGroup, addPlayableUniverse, type PlayableUniverse } from './fixtures.js';

/**
 * A chunk's seen cells with some bytes set
 *
 * @param bytes The bytes to set, by index
 * @return The cells
 */
function cellsWith(bytes: Record<number, number>): Uint8Array
{
	const cells = new Uint8Array(SEEN_CHUNK_BYTES);

	for (const [index, value] of Object.entries(bytes))
	{
		cells[Number(index)] = value;
	}

	return(cells);
}

describe('worldStateRepo', () =>
{
	let universe: PlayableUniverse;
	let anchorId: string;
	let groupId: string;

	beforeEach(async () =>
	{
		universe = await addPlayableUniverse();

		const playerId = (await loadOrCreatePlayerByName('Ada')).id;

		anchorId = await addCharacter(playerId, universe.universeId, 'Anchor');
		groupId = await addGroup(universe.universeId, anchorId, universe.fieldAreaId);
	});

	it('saves the cells a group has seen and reads them back, replacing what was saved before', async () =>
	{
		await saveSeenChunks(groupId, [
			{ areaId: universe.fieldAreaId, chunkColumn: 0, chunkRow: 0, cells: cellsWith({ 0: 1 }) },
			{ areaId: universe.houseAreaId, chunkColumn: -1, chunkRow: 2, cells: cellsWith({ 127: 128 }) }
		]);
		await saveSeenChunks(groupId, [
			{ areaId: universe.fieldAreaId, chunkColumn: 0, chunkRow: 0, cells: cellsWith({ 0: 3 }) }
		]);

		const saved = (await loadSeenChunks(groupId)).sort((first, second) => (first.chunkColumn - second.chunkColumn));

		assert.deepStrictEqual(saved, [
			{ areaId: universe.houseAreaId, chunkColumn: -1, chunkRow: 2, cells: cellsWith({ 127: 128 }) },
			{ areaId: universe.fieldAreaId, chunkColumn: 0, chunkRow: 0, cells: cellsWith({ 0: 3 }) }
		]);
	});

	it('leaves out areas that have been deleted, and forgets those deleted later', async () =>
	{
		await saveSeenChunks(groupId, [{ areaId: universe.houseAreaId, chunkColumn: 0, chunkRow: 0, cells: cellsWith({ 0: 1 }) }]);
		await deleteArea(universe.houseAreaId);
		await saveSeenChunks(groupId, [
			{ areaId: universe.houseAreaId, chunkColumn: 0, chunkRow: 0, cells: cellsWith({ 0: 1 }) },
			{ areaId: universe.fieldAreaId, chunkColumn: 0, chunkRow: 0, cells: cellsWith({ 0: 1 }) }
		]);

		assert.deepStrictEqual((await loadSeenChunks(groupId)).map((chunk) => chunk.areaId), [universe.fieldAreaId]);
	});

	it('forgets what a group has seen when it is disbanded', async () =>
	{
		await saveSeenChunks(groupId, [{ areaId: universe.fieldAreaId, chunkColumn: 0, chunkRow: 0, cells: cellsWith({ 0: 1 }) }]);
		await leaveGroup(groupId, anchorId);

		assert.deepStrictEqual(await loadSeenChunks(groupId), []);
	});
});
