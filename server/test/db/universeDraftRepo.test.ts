import assert from 'assert';
import { eq, sql, type SQL } from 'drizzle-orm';
import { CHUNK_SIZE, DEFAULT_TILE_CELL, cellIndexInChunk } from '@multiverse-kiln/shared';

import { listAreas, loadChunks, saveGroundChunk, updateAreaSettings, listAreaLinks } from '../../src/db/areaRepo.js';
import { createCharacter, findCharacterDetails } from '../../src/db/characterRepo.js';
import { createCustomItem, loadEditorItems, updateCustomItem } from '../../src/db/itemRepo.js';
import { createTileGraphic } from '../../src/db/tileGraphicRepo.js';
import { createCustomTile, loadEditorTiles } from '../../src/db/tileRepo.js';
import { inTransaction } from '../../src/db/transactions.js';
import { applyDraft, deleteRemovedRows, discardDraft, findDraftOrigins, startDraft } from '../../src/db/universeDraftRepo.js';
import { findEditableUniverse, hasDraft, updateUniverseSettings } from '../../src/db/universeRepo.js';
import { listTranslations, saveTranslation } from '../../src/db/universeTextRepo.js';
import { draftVersion, liveVersion } from '../../src/db/universeVersions.js';
import { db } from '../../src/db/client.js';
import { areaChunks, areaLinks, areas, regions, tiles, universeTranslations } from '../../src/db/schema.js';
import { addArea, addPlayableUniverse, dwarfFighter, testLobbyRegionId, type PlayableUniverse } from './fixtures.js';
import { addPlayer } from '../players.js';

/**
 * The draft's copy of a live area
 *
 * @param universeId The universe's ID
 * @param liveAreaId The live area's ID
 * @return The copy's ID
 */
async function draftAreaOf(universeId: string, liveAreaId: string): Promise<string>
{
	const origins = await inTransaction((transaction) => findDraftOrigins<string>(areas, universeId, transaction));
	const draftId = [...origins].find(([, originId]) => (originId === liveAreaId))?.[0];

	assert.ok(draftId, `The draft has no copy of area ${liveAreaId}`);

	return(draftId);
}

/**
 * Which version of a row the database holds, which changes whenever the row is written
 *
 * @param from The row's table and the condition finding it
 * @return The version; undefined when there is no such row
 */
async function rowVersion(from: SQL): Promise<string | undefined>
{
	const result = await db.execute<{ version: string }>(sql`SELECT xmin::text AS version FROM ${from}`);

	assert.ok(result.rows.length <= 1, 'The condition finds more than one row');

	return(result.rows[0]?.version);
}

describe('universeDraftRepo', () =>
{
	let universe: PlayableUniverse;
	let lavaId: number;
	let torchId: number;

	beforeEach(async () =>
	{
		universe = await addPlayableUniverse();
		lavaId = await createCustomTile(liveVersion(universe.universeId), 'pf1e', {
			name: 'Lava',
			indoors: false,
			outdoors: true,
			color: 0xff4400,
			graphic: null,
			uploadedGraphicId: null,
			visionCost: 0,
			walkSeconds: 0,
			enabled: true
		});
		torchId = await createCustomItem(liveVersion(universe.universeId), 'pf1e', {
			name: 'Torch',
			type: 'torch',
			enabled: true
		});

		const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

		cells[cellIndexInChunk(1, 1)] = lavaId;
		await saveGroundChunk(universe.fieldAreaId, 0, 0, cells);
		await saveTranslation(liveVersion(universe.universeId), {
			kind: 'area',
			thingId: universe.squareAreaId,
			field: 'name',
			language: 'fr',
			text: 'Place',
			sourceHash: '0'.repeat(64)
		});
		await saveTranslation(liveVersion(universe.universeId), {
			kind: 'tile',
			thingId: String(lavaId),
			field: 'name',
			language: 'fr',
			text: 'Lave',
			sourceHash: '0'.repeat(64)
		});
		await updateUniverseSettings(liveVersion(universe.universeId), { translationLanguages: ['fr'], shortDescription: 'Live' });
	});

	describe('startDraft', () =>
	{
		it('copies the live version with IDs of its own, pointing the copies at each other', async () =>
		{
			const { universeId, squareAreaId, fieldAreaId } = universe;
			const testLobbyId = await testLobbyRegionId(universeId);

			await inTransaction((transaction) => startDraft(universeId, transaction));

			assert.strictEqual(await hasDraft(universeId), true);

			const liveAreas = await listAreas(liveVersion(universeId));
			const draftAreas = await listAreas(draftVersion(universeId));

			assert.deepStrictEqual(draftAreas.map((area) => area.name), liveAreas.map((area) => area.name));
			assert.ok(draftAreas.every((area) => !liveAreas.some((live) => (live.id === area.id))));

			// The lobby, the links and the painted lava point at the draft's own copies
			const draft = await findEditableUniverse(draftVersion(universeId));
			const draftSquareId = await draftAreaOf(universeId, squareAreaId);
			const draftFieldId = await draftAreaOf(universeId, fieldAreaId);

			assert.strictEqual(draft?.lobbyAreaId, draftSquareId);
			assert.strictEqual(draft?.lobbyRegionId, (await findDraftOrigins<string>(regions, universeId)).entries().find(([, liveId]) => (liveId === testLobbyId))?.[0]);
			assert.notStrictEqual(draft?.lobbyRegionId, testLobbyId);
			assert.strictEqual(draft?.version, 'draft');
			assert.strictEqual(draft?.shortDescription, 'Live');

			const [link] = await listAreaLinks(draftSquareId);

			assert.ok(draftAreas.some((area) => (area.id === link.targetAreaId)));

			const draftLava = (await loadEditorTiles(draftVersion(universeId), 'pf1e')).find((tile) => (tile.name === 'Lava'));
			const [chunk] = await loadChunks(draftFieldId, { minChunkColumn: 0, minChunkRow: 0, maxChunkColumn: 0, maxChunkRow: 0 });

			assert.ok(draftLava && (draftLava.id !== lavaId));
			assert.strictEqual(chunk.cells[cellIndexInChunk(1, 1)], draftLava.id);

			const translations = await listTranslations(draftVersion(universeId), ['fr']);
			const areaTranslation = translations.find((translation) => (translation.kind === 'area'));
			const tileTranslation = translations.find((translation) => (translation.kind === 'tile'));

			assert.strictEqual(areaTranslation?.thingId, draftSquareId);
			assert.strictEqual(areaTranslation.text, 'Place');
			assert.strictEqual(tileTranslation?.thingId, String(draftLava.id));
			assert.strictEqual(tileTranslation.text, 'Lave');
		});

		it('leaves the live version as it was when the draft changes', async () =>
		{
			const { universeId, squareAreaId } = universe;

			await inTransaction((transaction) => startDraft(universeId, transaction));
			await updateAreaSettings(await draftAreaOf(universeId, squareAreaId), { name: 'Market' });
			await updateUniverseSettings(draftVersion(universeId), { shortDescription: 'Draft' });

			assert.ok((await listAreas(liveVersion(universeId))).some((area) => ((area.id === squareAreaId) && (area.name === 'Square'))));
			assert.strictEqual((await findEditableUniverse(liveVersion(universeId)))?.shortDescription, 'Live');
			assert.strictEqual((await findEditableUniverse(draftVersion(universeId)))?.shortDescription, 'Draft');
		});
	});

	describe('applyDraft', () =>
	{
		it('writes the draft into the live version under the live IDs, and adds what the draft added', async () =>
		{
			const { universeId, squareAreaId, houseAreaId, fieldAreaId } = universe;
			const playerId = (await addPlayer('Ada')).id;
			const characterId = await inTransaction(async (transaction) => createCharacter({
				...await dwarfFighter(playerId, universeId),
				items: [{ itemId: torchId, quantity: 1 }]
			}, transaction));

			await inTransaction((transaction) => startDraft(universeId, transaction));

			const draft = draftVersion(universeId);
			const draftTorch = (await loadEditorItems(draft, 'pf1e')).find((item) => (item.name === 'Torch'));

			assert.ok(draftTorch);
			await updateCustomItem(draft, draftTorch.id, { name: 'Lantern', type: 'torch', enabled: true });
			await updateAreaSettings(await draftAreaOf(universeId, squareAreaId), { name: 'Market' });
			await updateUniverseSettings(draft, { shortDescription: 'Draft' });

			const cellarId = await addArea(universeId, 'Cellar');

			await inTransaction(async (transaction) =>
			{
				await transaction
					.update(areas)
					.set({
						draft: true
					})
					.where(eq(areas.id, cellarId));
			});

			const removed = await inTransaction((transaction) => applyDraft(universeId, transaction));

			assert.strictEqual(await hasDraft(universeId), false);
			assert.deepStrictEqual(await listAreas(draft), []);
			assert.deepStrictEqual(removed.areaIds, []);

			const liveAreas = await listAreas(liveVersion(universeId));

			assert.deepStrictEqual(liveAreas.map((area) => area.id).sort(), [squareAreaId, houseAreaId, fieldAreaId, cellarId].sort());
			assert.ok(liveAreas.some((area) => ((area.id === squareAreaId) && (area.name === 'Market'))));

			const live = await findEditableUniverse(liveVersion(universeId));

			assert.strictEqual(live?.shortDescription, 'Draft');
			assert.strictEqual(live?.lobbyAreaId, squareAreaId);
			assert.strictEqual(live?.lobbyRegionId, await testLobbyRegionId(universeId));

			// The character still carries the same item, now with the draft's settings
			const character = await findCharacterDetails(playerId, universeId, 'pf1e', characterId);

			assert.deepStrictEqual(character?.items.map((item) => item.itemId), [torchId]);
			assert.ok((await loadEditorItems(liveVersion(universeId), 'pf1e')).some((item) => ((item.id === torchId) && (item.name === 'Lantern'))));

			// The field paints the live lava again, and the translations name the live area and tile
			const [chunk] = await loadChunks(fieldAreaId, { minChunkColumn: 0, minChunkRow: 0, maxChunkColumn: 0, maxChunkRow: 0 });

			assert.strictEqual(chunk.cells[cellIndexInChunk(1, 1)], lavaId);

			const translations = await listTranslations(liveVersion(universeId), ['fr']);

			assert.strictEqual(translations.find((translation) => (translation.kind === 'area'))?.thingId, squareAreaId);
			assert.strictEqual(translations.find((translation) => (translation.kind === 'tile'))?.thingId, String(lavaId));
		});

		it('leaves alone the live rows the draft didn\'t change', async () =>
		{
			const { universeId, squareAreaId, houseAreaId, fieldAreaId } = universe;
			const grass = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

			await saveGroundChunk(houseAreaId, 0, 0, grass);
			await inTransaction((transaction) => startDraft(universeId, transaction));

			const unchanged = [
				sql`${areaChunks} WHERE area_id = ${fieldAreaId}`,
				sql`${areaLinks} WHERE area_id = ${squareAreaId}`,
				sql`${tiles} WHERE id = ${lavaId}`,
				sql`${areas} WHERE id = ${fieldAreaId}`,
				sql`${universeTranslations} WHERE universe_id = ${universeId} AND NOT draft AND kind = 'area'`,
				sql`${universeTranslations} WHERE universe_id = ${universeId} AND NOT draft AND kind = 'tile'`
			];
			const before = await Promise.all(unchanged.map((from) => rowVersion(from)));

			// The draft paints its lava into the square, and clears the house's cells
			const draftLava = (await loadEditorTiles(draftVersion(universeId), 'pf1e')).find((tile) => (tile.name === 'Lava'));
			const draftSquareId = await draftAreaOf(universeId, squareAreaId);
			const draftHouseId = await draftAreaOf(universeId, houseAreaId);
			const [draftSquareChunk] = await loadChunks(draftSquareId, { minChunkColumn: 0, minChunkRow: 0, maxChunkColumn: 0, maxChunkRow: 0 });

			assert.ok(draftLava);
			draftSquareChunk.cells[cellIndexInChunk(7, 7)] = draftLava.id;
			await saveGroundChunk(draftSquareId, 0, 0, draftSquareChunk.cells);
			await inTransaction(async (transaction) =>
			{
				await transaction
					.delete(areaChunks)
					.where(eq(areaChunks.areaId, draftHouseId));
			});

			await inTransaction((transaction) => applyDraft(universeId, transaction));

			assert.deepStrictEqual(await Promise.all(unchanged.map((from) => rowVersion(from))), before);

			const bounds = { minChunkColumn: 0, minChunkRow: 0, maxChunkColumn: 0, maxChunkRow: 0 };
			const [fieldChunk] = await loadChunks(fieldAreaId, bounds);
			const [squareChunk] = await loadChunks(squareAreaId, bounds);

			assert.strictEqual(fieldChunk.cells[cellIndexInChunk(1, 1)], lavaId);
			assert.strictEqual(squareChunk.cells[cellIndexInChunk(7, 7)], lavaId);
			assert.deepStrictEqual(await loadChunks(houseAreaId, bounds), []);
		});

		it('leaves the rows the draft deleted for the caller, then deletes them', async () =>
		{
			const { universeId, houseAreaId } = universe;

			await inTransaction((transaction) => startDraft(universeId, transaction));

			const draftHouseId = await draftAreaOf(universeId, houseAreaId);

			await inTransaction(async (transaction) =>
			{
				await transaction
					.delete(areas)
					.where(eq(areas.id, draftHouseId));
				await transaction
					.delete(tiles)
					.where(eq(tiles.originId, lavaId));
			});

			const removed = await inTransaction((transaction) => applyDraft(universeId, transaction));

			assert.deepStrictEqual(removed.areaIds, [houseAreaId]);
			assert.deepStrictEqual(removed.tileIds, [lavaId]);
			assert.ok((await listAreas(liveVersion(universeId))).some((area) => (area.id === houseAreaId)));

			await inTransaction((transaction) => deleteRemovedRows(universeId, removed, transaction));

			assert.ok(!(await listAreas(liveVersion(universeId))).some((area) => (area.id === houseAreaId)));
			assert.ok(!(await loadEditorTiles(liveVersion(universeId), 'pf1e')).some((tile) => (tile.id === lavaId)));
		});
	});

	describe('discardDraft', () =>
	{
		it('deletes the draft and leaves the live version, returning the images only the draft used', async () =>
		{
			const { universeId } = universe;
			const playerId = (await addPlayer('Ada')).id;

			await createTileGraphic('00000000-0000-4000-8000-000000000001', {
				universeId,
				draft: false,
				name: 'Moss',
				format: 'dualGrid',
				drawOrder: 35,
				storageKey: 'tile-graphics/live.png',
				uploadedBy: playerId
			});
			await inTransaction((transaction) => startDraft(universeId, transaction));
			await createTileGraphic('00000000-0000-4000-8000-000000000002', {
				universeId,
				draft: true,
				name: 'Lichen',
				format: 'dualGrid',
				drawOrder: 35,
				storageKey: 'tile-graphics/draft.png',
				uploadedBy: playerId
			});

			const before = await listAreas(liveVersion(universeId));
			const unused = await inTransaction((transaction) => discardDraft(universeId, transaction));

			assert.deepStrictEqual(unused, ['tile-graphics/draft.png']);
			assert.strictEqual(await hasDraft(universeId), false);
			assert.deepStrictEqual(await listAreas(draftVersion(universeId)), []);
			assert.deepStrictEqual(await listAreas(liveVersion(universeId)), before);
		});
	});
});
