import assert from 'assert';
import { CHUNK_SIZE, DEFAULT_TILE_CELL, IMPASSABLE_WALK_SECONDS, VOID_CELL, cellIndexInChunk, placeKey, type AreaListPayload, type BlockedArrival, type ClassListPayload, type EditorChange, type RaceListPayload, type SaveRefusedPayload, type TileListPayload } from '@multiverse-kiln/shared';

import { saveGroundChunk } from '../src/db/areaRepo.js';
import { findUniverse } from '../src/db/universeRepo.js';
import { setUniverseRole } from '../src/db/universeEditorRepo.js';
import { addPlayableUniverse, defaultTileId, type PlayableUniverse } from './db/fixtures.js';
import { logIn, saveAll, saveChanges, send, type Editor } from './editorRequests.js';
import { getTestServer } from './testServer.js';

describe('Squares nobody can walk on', () =>
{
	let ada: Editor;
	let universe: PlayableUniverse;
	let mountainsId: number;
	let waterId: number;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		universe = await addPlayableUniverse();
		mountainsId = await defaultTileId('mountains');
		waterId = await defaultTileId('water');
		await setUniverseRole(universe.universeId, ada.playerId, 'creator');
	});

	/**
	 * Saving changes that must be refused for sending characters to squares nobody can walk on
	 *
	 * @param changes The changes
	 * @param changeIndex The change the refusal must name
	 * @return The problems the refusal names
	 */
	async function arrivalRefusal(changes: EditorChange[], changeIndex: number = (changes.length - 1)): Promise<BlockedArrival[]>
	{
		const answer = await saveChanges(ada, universe.universeId, changes);

		assert.strictEqual(answer.status, 409, JSON.stringify(answer.body));
		assert.strictEqual(answer.body.error.id, 'error.arrivalProblems');
		assert.strictEqual(answer.body.changeIndex, changeIndex);

		return((answer.body.placeProblems ?? []) as BlockedArrival[]);
	}

	it('refuses the lobby\'s starting square on mountains, naming the square and the tile', async () =>
	{
		const { universeId, squareAreaId } = universe;
		const answer = await saveChanges(ada, universeId, [{ kind: 'universe', update: { lobbyColumn: 12, lobbyRow: 3 } }]);

		assert.strictEqual(answer.status, 409, JSON.stringify(answer.body));
		assert.deepStrictEqual(answer.body.placeProblems, [{ kind: 'arrivalBlocked', source: { kind: 'lobby' }, areaId: squareAreaId, column: 12, row: 3, tileId: mountainsId }]);
		assert.strictEqual(answer.body.placeNames?.[placeKey({ kind: 'area', id: squareAreaId })], 'Square');

		// Nothing was saved, and a square beside the mountains is
		const saved = await findUniverse(universeId);

		assert.deepStrictEqual([saved?.lobbyColumn, saved?.lobbyRow], [0, 0]);
		await saveAll(ada, universeId, [{ kind: 'universe', update: { lobbyColumn: 11, lobbyRow: 3 } }]);
	});

	it('refuses a link leading to mountains, naming the link\'s area and cell', async () =>
	{
		const { universeId, squareAreaId, houseAreaId } = universe;
		const link = (column: number): EditorChange => ({
			kind: 'saveLink',
			areaId: houseAreaId,
			column: 3,
			row: 3,
			target: { targetAreaId: squareAreaId, targetColumn: column, targetRow: 3, mode: 'automatic', requiresWholeGroup: false }
		});
		const answer = await saveChanges(ada, universeId, [link(12)]);

		assert.strictEqual(answer.status, 409, JSON.stringify(answer.body));
		assert.deepStrictEqual(answer.body.placeProblems, [{ kind: 'arrivalBlocked', source: { kind: 'link', areaId: houseAreaId, column: 3, row: 3 }, areaId: squareAreaId, column: 12, row: 3, tileId: mountainsId }]);
		assert.strictEqual(answer.body.placeNames?.[placeKey({ kind: 'area', id: houseAreaId })], 'House');

		await saveAll(ada, universeId, [link(11)]);
	});

	it('refuses painting a starting square or a link\'s destination with a tile nobody can walk on, or Unexplored', async () =>
	{
		const { universeId, fieldAreaId, squareAreaId } = universe;

		// Characters start at column 0, row 0 of the field, and a link leads to column 5, row 6 of the square
		assert.deepStrictEqual(await arrivalRefusal([{ kind: 'editCells', areaId: fieldAreaId, changes: [[0, 0, waterId]] }]), [
			{ kind: 'arrivalBlocked', source: { kind: 'universe' }, areaId: fieldAreaId, column: 0, row: 0, tileId: waterId }
		]);
		assert.deepStrictEqual(await arrivalRefusal([{ kind: 'editCells', areaId: squareAreaId, changes: [[5, 6, VOID_CELL]] }]), [
			{ kind: 'arrivalBlocked', source: { kind: 'link', areaId: universe.houseAreaId, column: 2, row: 4 }, areaId: squareAreaId, column: 5, row: 6, tileId: null }
		]);

		// Painting the cells beside them is saved, and so is painting a square and moving the start off it at once
		await saveAll(ada, universeId, [
			{ kind: 'editCells', areaId: fieldAreaId, changes: [[1, 0, waterId]] },
			{ kind: 'editCells', areaId: squareAreaId, changes: [[5, 7, VOID_CELL]] }
		]);
		await saveAll(ada, universeId, [
			{ kind: 'editCells', areaId: fieldAreaId, changes: [[0, 0, waterId]] },
			{ kind: 'universe', update: { startingColumn: 2, startingRow: 0 } }
		]);
	});

	it('refuses making a tile one nobody can walk on while characters start on it', async () =>
	{
		const { universeId } = universe;
		const tiles = (await send<TileListPayload>(ada, 'GET', `/${universeId}/tiles`)).body.tiles;
		const forest = tiles.find((tile) => (tile.key === 'forest'))!;
		const impassable: EditorChange = { kind: 'saveTile', id: forest.id, settings: { ...forest, walkSeconds: IMPASSABLE_WALK_SECONDS } };

		// The square has forest at column 10, row 3
		await saveAll(ada, universeId, [{ kind: 'universe', update: { lobbyColumn: 10, lobbyRow: 3 } }]);

		assert.deepStrictEqual(await arrivalRefusal([impassable]), [
			{ kind: 'arrivalBlocked', source: { kind: 'lobby' }, areaId: universe.squareAreaId, column: 10, row: 3, tileId: forest.id }
		]);

		await saveAll(ada, universeId, [{ kind: 'universe', update: { lobbyColumn: 11 } }, impassable]);
	});

	it('refuses changing an area\'s default tile to one nobody can walk on under a starting square', async () =>
	{
		const { fieldAreaId } = universe;

		assert.deepStrictEqual(await arrivalRefusal([{ kind: 'updateArea', areaId: fieldAreaId, update: { defaultTileId: waterId } }]), [
			{ kind: 'arrivalBlocked', source: { kind: 'universe' }, areaId: fieldAreaId, column: 0, row: 0, tileId: waterId }
		]);
	});

	it('refuses a race\'s starting square on water, and one that resizing moves onto water', async () =>
	{
		const { universeId, fieldAreaId } = universe;
		const races = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races;
		const dwarf = races.find((race) => (race.key === 'dwarf'))!;
		const startAt = (column: number): EditorChange => ({ kind: 'saveRace', id: dwarf.id, settings: { ...dwarf, startingAreaId: fieldAreaId, startingColumn: column, startingRow: 4 } });

		await saveAll(ada, universeId, [{ kind: 'editCells', areaId: fieldAreaId, changes: [[4, 4, waterId]] }]);

		assert.deepStrictEqual(await arrivalRefusal([startAt(4)]), [
			{ kind: 'arrivalBlocked', source: { kind: 'race', race: { id: dwarf.id, key: 'dwarf', name: null } }, areaId: fieldAreaId, column: 4, row: 4, tileId: waterId }
		]);

		// A starting square outside the area counts as the nearest cell inside it
		await saveAll(ada, universeId, [startAt(6)]);

		assert.deepStrictEqual(await arrivalRefusal([{ kind: 'resizeArea', areaId: fieldAreaId, bounds: { minColumn: 0, minRow: 0, maxColumn: 4, maxRow: 17 }, discard: true }]), [
			{ kind: 'arrivalBlocked', source: { kind: 'race', race: { id: dwarf.id, key: 'dwarf', name: null } }, areaId: fieldAreaId, column: 4, row: 4, tileId: waterId }
		]);
	});

	it('refuses a class\'s starting square on water, for every race or for one', async () =>
	{
		const { universeId, fieldAreaId } = universe;
		const races = (await send<RaceListPayload>(ada, 'GET', `/${universeId}/races`)).body.races;
		const classes = (await send<ClassListPayload>(ada, 'GET', `/${universeId}/classes`)).body.classes;
		const dwarf = races.find((race) => (race.key === 'dwarf'))!;
		const fighter = classes.find((characterClass) => (characterClass.key === 'fighter'))!;
		const named = { id: fighter.id, key: 'fighter', name: null };

		await saveAll(ada, universeId, [{ kind: 'editCells', areaId: fieldAreaId, changes: [[4, 4, waterId]] }]);

		assert.deepStrictEqual(await arrivalRefusal([{ kind: 'saveClass', id: fighter.id, settings: { ...fighter, startingAreaId: fieldAreaId, startingColumn: 4, startingRow: 4 } }]), [
			{ kind: 'arrivalBlocked', source: { kind: 'class', characterClass: named }, areaId: fieldAreaId, column: 4, row: 4, tileId: waterId }
		]);
		assert.deepStrictEqual(await arrivalRefusal([{ kind: 'saveClass', id: fighter.id, settings: { ...fighter, raceAreas: [{ raceId: dwarf.id, areaId: fieldAreaId, column: 4, row: 4 }] } }]), [
			{ kind: 'arrivalBlocked', source: { kind: 'classRace', characterClass: named, race: { id: dwarf.id, key: 'dwarf', name: null } }, areaId: fieldAreaId, column: 4, row: 4, tileId: waterId }
		]);
	});

	it('refuses applying a draft that sends characters to a square nobody can walk on', async () =>
	{
		const { universeId } = universe;

		await saveAll(ada, universeId, [{ kind: 'startDraft' }]);

		const draft = (await send<AreaListPayload>(ada, 'GET', `/${universeId}/areas?version=draft`)).body;
		const field = draft.areas.find((area) => (area.name === 'Field'))!;
		const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

		// Written past the editor, as a save to the draft checks only what it changes
		cells[cellIndexInChunk(0, 0)] = waterId;
		await saveGroundChunk(field.id, 0, 0, cells);

		const answer = await send<SaveRefusedPayload>(ada, 'POST', `/${universeId}/changes?version=draft`, { body: { changes: [{ kind: 'applyDraft', choices: { items: {}, areas: {}, races: {}, classes: {} } }] } });

		assert.strictEqual(answer.status, 409, JSON.stringify(answer.body));
		assert.strictEqual(answer.body.error.id, 'error.arrivalProblems');
		assert.deepStrictEqual(answer.body.placeProblems?.map((problem) => problem.kind), ['arrivalBlocked']);
	});

	it('checks only the areas a save may have changed, and lists every square with the areas', async () =>
	{
		const { universeId, fieldAreaId, squareAreaId } = universe;
		const cells = new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL);

		// Written past the editor, so the field's starting square is on water already
		cells[cellIndexInChunk(0, 0)] = waterId;
		await saveGroundChunk(fieldAreaId, 0, 0, cells);

		await saveAll(ada, universeId, [{ kind: 'editCells', areaId: squareAreaId, changes: [[20, 10, waterId]] }]);
		assert.deepStrictEqual((await arrivalRefusal([{ kind: 'editCells', areaId: fieldAreaId, changes: [[20, 10, waterId]] }])).map((problem) => problem.source.kind), ['universe']);

		const list = (await send<AreaListPayload>(ada, 'GET', `/${universeId}/areas`)).body;

		assert.deepStrictEqual(list.arrivals, [
			{ source: { kind: 'link', areaId: squareAreaId, column: 5, row: 5 }, areaId: universe.houseAreaId, column: 2, row: 2 },
			{ source: { kind: 'link', areaId: universe.houseAreaId, column: 2, row: 4 }, areaId: squareAreaId, column: 5, row: 6 }
		].sort((first, second) => ((first.source.areaId < second.source.areaId) ? -1 : 1)));
	});
});
