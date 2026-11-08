import assert from 'assert';
import { EDITOR_UNIVERSES_PATH, sourceTextHash, TILE_GRAPHICS_PATH, UNIVERSE_EXPORT_AREA_LEGEND, UNIVERSE_EXPORT_FORMAT, UNIVERSE_EXPORT_FORMAT_VERSION, UNIVERSE_EXPORT_MANIFEST, UNIVERSE_EXPORT_PATH, VOID_CELL, type EditableUniverse, type ExportedAreaCells, type TileSettings, type UniverseExport } from '@multiverse-kiln/shared';

import { readZip } from '../src/archives/zip.js';
import { findDefaultItemIds } from '../src/db/itemRepo.js';
import { findPlayer } from '../src/db/playerRepo.js';
import { findDefaultTileIds } from '../src/db/tileRepo.js';
import { setUniverseAccess, setUniverseRole } from '../src/db/universeEditorRepo.js';
import { createArea, createUniverse, logIn, saveAll, send, solidPng, type Editor } from './editorRequests.js';
import { getTestServer, testServerUrl } from './testServer.js';

const moss: TileSettings = {
	name: 'Moss',
	indoors: false,
	outdoors: true,
	color: 0x2a7a30,
	graphic: null,
	uploadedGraphicId: null,
	visionCost: 0,
	walkSeconds: 600,
	enabled: true
};

/**
 * Exports a universe, as Export Universe asks
 *
 * @param editor The browser asking
 * @param universeId The universe's ID
 * @param version The version, or undefined for the live version
 * @return The status, the headers, and the archive's files when it answered with one
 */
async function exportUniverse(editor: Editor, universeId: string, version?: 'draft'): Promise<{ status: number; headers: Headers; files: Map<string, Buffer> }>
{
	const query = ((version === undefined) ? '' : `?version=${version}`);
	const response = await fetch(`${testServerUrl}${EDITOR_UNIVERSES_PATH}/${universeId}${UNIVERSE_EXPORT_PATH}${query}`, {
		headers: { Cookie: editor.cookie }
	});
	const body = Buffer.from(await response.arrayBuffer());

	return({
		status: response.status,
		headers: response.headers,
		files: ((response.status === 200) ? await readZip(body, 100000000) : new Map<string, Buffer>())
	});
}

/**
 * The export's manifest
 *
 * @param files The archive's files
 * @return The manifest
 */
function manifestOf(files: Map<string, Buffer>): UniverseExport
{
	const manifest = files.get(UNIVERSE_EXPORT_MANIFEST);

	assert.ok(manifest, `No ${UNIVERSE_EXPORT_MANIFEST} in ${[...files.keys()].join(', ')}`);

	return(JSON.parse(manifest.toString('utf8')) as UniverseExport);
}

describe('exporting a universe', () =>
{
	let ada: Editor;
	let universeId: string;
	let caveId: string;
	let mossId: number;
	let graphicId: string;

	before(async () =>
	{
		await getTestServer();
	});

	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		universeId = await createUniverse(ada, 'Kilnhaven');
		caveId = await createArea(ada, universeId, { name: 'Cave' });

		const { lobbyAreaId } = (await send<EditableUniverse>(ada, 'GET', `/${universeId}`)).body;
		const png = await solidPng();

		assert.ok(lobbyAreaId);

		const ids = await saveAll(ada, universeId, [
			{ kind: 'universe', update: { translationLanguages: ['fr', 'de'] } },
			{ kind: 'uploadTileGraphic', ref: 'new:mossy', upload: { name: 'Mossy', format: 'dualGrid', drawOrder: 35, image: png, rightsConfirmed: true } },
			{ kind: 'createTile', ref: 'new:moss', settings: { ...moss, uploadedGraphicId: 'new:mossy' } },
			{ kind: 'editCells', areaId: caveId, changes: [[0, 0, 'new:moss'], [12, -3, VOID_CELL]] },
			{ kind: 'saveLink', areaId: lobbyAreaId, column: 1, row: 0, target: { targetAreaId: caveId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: true } },
			{ kind: 'saveTranslatorNote', text: { kind: 'area', thingId: caveId, field: 'name' }, note: 'A dark place' },
			{ kind: 'saveNoTranslation', text: { kind: 'universe', thingId: universeId, field: 'name' }, noTranslation: true }
		]);

		mossId = Number(ids['new:moss']);
		graphicId = String(ids['new:mossy']);

		await saveAll(ada, universeId, [
			{ kind: 'saveTranslation', text: { kind: 'area', thingId: caveId, field: 'name' }, language: 'fr', translation: 'Grotte', sourceHash: sourceTextHash('Cave') },
			{ kind: 'saveTranslation', text: { kind: 'area', thingId: caveId, field: 'name' }, language: 'de', translation: 'Höhle', sourceHash: sourceTextHash('Cave') }
		]);
	});

	it('gives a creator everything, as a zip archive named for the universe', async () =>
	{
		const { status, headers, files } = await exportUniverse(ada, universeId);
		const manifest = manifestOf(files);
		const defaultTiles = await findDefaultTileIds('pf1e');
		const dagger = (await findDefaultItemIds('pf1e')).get('dagger');

		assert.strictEqual(status, 200);
		assert.strictEqual(headers.get('content-type'), 'application/zip');
		assert.match(headers.get('content-disposition') ?? '', /^attachment; filename="?\w+\.kilnhaven\.\d{4}-\d{2}-\d{2}\.zip"?$/);
		assert.strictEqual(manifest.format, UNIVERSE_EXPORT_FORMAT);
		assert.strictEqual(manifest.formatVersion, UNIVERSE_EXPORT_FORMAT_VERSION);
		assert.strictEqual(manifest.role, 'creator');
		assert.deepStrictEqual(manifest.exportedBy, {
			username: (await findPlayer(ada.playerId))?.username,
			displayName: 'Ada'
		});
		assert.deepStrictEqual(manifest.universe, { id: universeId, version: 'live', name: 'Kilnhaven', ruleset: 'pf1e', sourceLanguage: 'en' });
		assert.strictEqual(manifest.settings?.name, 'Kilnhaven');
		assert.deepStrictEqual(manifest.settings?.translationLanguages, ['fr', 'de']);
		assert.deepStrictEqual(manifest.settings?.startingItems, [{ itemId: dagger, quantity: 1 }]);
		assert.strictEqual(manifest.rulesetSettings?.ruleset, 'pf1e');
		assert.ok(manifest.difficultyLevels?.some((level) => (level.key === 'normal') && level.isDefault));
		assert.ok(manifest.races?.some((race) => (race.key === 'dwarf')));
		assert.ok(manifest.classes?.some((each) => (each.key === 'wizard')));
		assert.deepStrictEqual(manifest.themes, []);
		assert.deepStrictEqual(manifest.editors?.map((editor) => editor.role), ['creator']);

		// The ruleset's defaults are listed with their keys, so an import can find them in another database
		assert.ok(manifest.items?.some((item) => (item.id === dagger) && (item.key === 'dagger')));
		assert.ok(manifest.tiles?.some((tile) => (tile.id === defaultTiles.get('grass')) && (tile.key === 'grass') && !tile.edited));
		assert.deepStrictEqual(manifest.tiles?.find((tile) => (tile.id === mossId)), {
			id: mossId,
			key: null,
			custom: true,
			edited: false,
			...moss,
			uploadedGraphicId: graphicId
		});
		assert.deepStrictEqual(manifest.tileGraphics, [{ id: graphicId, name: 'Mossy', format: 'dualGrid', drawOrder: 35, file: `tilesets/${graphicId}.png` }]);
		// The image as stored, which the upload re-encoded
		const stored = Buffer.from(await (await fetch(`${testServerUrl}${TILE_GRAPHICS_PATH}/${graphicId}.png`)).arrayBuffer());

		assert.ok(files.get(`tilesets/${graphicId}.png`)?.equals(stored));

		// Each area's cells are a file of their own, holding only the chunks that differ from its default tile
		const cave = manifest.areas?.find((area) => (area.id === caveId));
		const lobby = manifest.areas?.find((area) => (area.name === 'Lobby'));

		assert.deepStrictEqual(manifest.areas?.map((area) => area.name), ['Cave', 'Lobby', 'Starting Area']);
		assert.ok(cave && lobby);
		assert.strictEqual(cave.file, `areas/${caveId}.json`);

		// The legend beside the cells names each number they hold and each file's area
		const legend = files.get(UNIVERSE_EXPORT_AREA_LEGEND)?.toString('utf8') ?? '';

		assert.match(legend, /^# Kilnhaven: area cells$/m);
		assert.ok(legend.includes(`| ${mossId} | Moss | #2A7A30 |`), legend);
		assert.ok(legend.includes(`| ${defaultTiles.get('grass')} | Grass |`), legend);
		assert.ok(legend.includes('| -1 | Void (nothing) |  |'), legend);
		assert.ok(legend.includes(`| \`${caveId}.json\` | Cave | Grass | Columns -15 to 15, rows -8 to 8 |`), legend);
		assert.deepStrictEqual(lobby.links, [{ column: 1, row: 0, targetAreaId: caveId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: true }]);

		const cellsText = files.get(cave.file)?.toString('utf8') ?? '';
		const lobbyCellsText = files.get(lobby.file)?.toString('utf8') ?? '';
		const cells = JSON.parse(cellsText) as ExportedAreaCells;
		const lobbyCells = JSON.parse(lobbyCellsText) as ExportedAreaCells;

		// Each chunk is on a line of its own, in one line of JSON
		assert.strictEqual(cellsText, `{\n\t"chunkSize": 32,\n\t"chunks": [\n\t\t${JSON.stringify(cells.chunks[0])},\n\t\t${JSON.stringify(cells.chunks[1])}\n\t]\n}\n`);
		assert.strictEqual(lobbyCellsText, '{\n\t"chunkSize": 32,\n\t"chunks": []\n}\n');

		assert.strictEqual(cells.chunkSize, 32);
		assert.deepStrictEqual(cells.chunks.map((chunk) => [chunk.chunkColumn, chunk.chunkRow]), [[0, -1], [0, 0]]);
		assert.strictEqual(cells.chunks[0].cells[(29 * 32) + 12], VOID_CELL);
		assert.strictEqual(cells.chunks[1].cells[0], mossId);
		assert.deepStrictEqual(lobbyCells.chunks, []);

		assert.deepStrictEqual(manifest.translatorNotes, [{ kind: 'area', thingId: caveId, field: 'name', note: 'A dark place' }]);
		assert.deepStrictEqual(manifest.noTranslation, [{ kind: 'universe', thingId: universeId, field: 'name' }]);
		assert.deepStrictEqual(manifest.translations?.languages, ['fr', 'de']);
		assert.deepStrictEqual(manifest.translations?.entries.map((entry) => [entry.language, entry.text]), [['de', 'Höhle'], ['fr', 'Grotte']]);
	});

	it('gives a builder the world, without the settings or translations', async () =>
	{
		const bea = await logIn('Bea');

		await setUniverseRole(universeId, bea.playerId, 'builder');

		const manifest = manifestOf((await exportUniverse(bea, universeId)).files);

		assert.strictEqual(manifest.role, 'builder');
		assert.strictEqual(manifest.settings, undefined);
		assert.strictEqual(manifest.rulesetSettings, undefined);
		assert.strictEqual(manifest.races, undefined);
		assert.strictEqual(manifest.editors, undefined);
		assert.strictEqual(manifest.translations, undefined);
		assert.strictEqual(manifest.areas?.length, 3);
		assert.strictEqual(manifest.tileGraphics?.length, 1);
		assert.ok(manifest.tiles?.some((tile) => (tile.id === mossId)));
		assert.ok(manifest.items && (manifest.items.length > 0));
		assert.strictEqual(manifest.translatorNotes?.length, 1);
		assert.strictEqual(manifest.noTranslation?.length, 1);
	});

	it('gives a translator their languages\' translations and the text needing none', async () =>
	{
		const cy = await logIn('Cy');

		await setUniverseAccess(universeId, cy.playerId, { role: 'translator', languages: ['fr', 'es'] });

		const { files } = await exportUniverse(cy, universeId);
		const manifest = manifestOf(files);

		assert.deepStrictEqual([...files.keys()], [UNIVERSE_EXPORT_MANIFEST]);
		assert.strictEqual(manifest.role, 'translator');
		assert.strictEqual(manifest.areas, undefined);
		assert.strictEqual(manifest.tiles, undefined);
		assert.strictEqual(manifest.translatorNotes, undefined);
		assert.deepStrictEqual(manifest.noTranslation, [{ kind: 'universe', thingId: universeId, field: 'name' }]);
		assert.deepStrictEqual(manifest.translations, {
			languages: ['fr'],
			entries: [{ kind: 'area', thingId: caveId, field: 'name', language: 'fr', text: 'Grotte', sourceHash: sourceTextHash('Cave') }]
		});
	});

	it('refuses beta testers, and players without a role', async () =>
	{
		const dee = await logIn('Dee');
		const eve = await logIn('Eve');

		await setUniverseRole(universeId, dee.playerId, 'beta_tester');

		assert.strictEqual((await exportUniverse(dee, universeId)).status, 403);
		assert.strictEqual((await exportUniverse(eve, universeId)).status, 404);
	});

	it('exports the draft with the draft\'s own IDs', async () =>
	{
		await saveAll(ada, universeId, [{ kind: 'startDraft' }]);

		const { status, headers, files } = await exportUniverse(ada, universeId, 'draft');
		const manifest = manifestOf(files);
		const draftCave = manifest.areas?.find((area) => (area.name === 'Cave'));
		const draftMoss = manifest.tiles?.find((tile) => (tile.name === 'Moss'));

		assert.strictEqual(status, 200);
		assert.match(headers.get('content-disposition') ?? '', /\.kilnhaven\.draft\.\d{4}-\d{2}-\d{2}\.zip"?$/);
		assert.strictEqual(manifest.universe.version, 'draft');
		assert.ok(draftCave && draftMoss);
		assert.notStrictEqual(draftCave.id, caveId);
		assert.notStrictEqual(draftMoss.id, mossId);

		const cells = JSON.parse(files.get(draftCave.file)?.toString('utf8') ?? '') as ExportedAreaCells;

		assert.strictEqual(cells.chunks[1].cells[0], draftMoss.id);
		assert.deepStrictEqual(manifest.translations?.entries.map((entry) => entry.thingId), [draftCave.id, draftCave.id]);
	});
});
