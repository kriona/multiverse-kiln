import assert from 'assert';
import { randomUUID } from 'crypto';
import { AREA_LIGHT_LEVELS, AREA_LINK_MODES, PASSAGES_OF_TIME, CHUNK_SIZE, EDITOR_UNIVERSES_PATH, FAERIE_MORNINGS, MAX_AREA_LINKS, MAX_AREA_NAME_LENGTH, MAX_PLACE_PARENTS, MAX_AREA_SIDE, MAX_UNIVERSE_IMPORT_JSON_FILE_BYTES, sourceTextHash, TILE_GRAPHICS_PATH, UNIVERSE_EXPORT_AREA_LEGEND, UNIVERSE_EXPORT_AREAS, UNIVERSE_EXPORT_CLASSES, UNIVERSE_EXPORT_FORMAT, UNIVERSE_EXPORT_FORMAT_VERSION, UNIVERSE_EXPORT_ITEMS, UNIVERSE_EXPORT_LIVE_IDS, UNIVERSE_EXPORT_MANIFEST, UNIVERSE_EXPORT_PATH, UNIVERSE_EXPORT_SIGNATURE, UNIVERSE_EXPORT_RACES, UNIVERSE_EXPORT_TILESETS, UNIVERSE_EXPORT_TRANSLATIONS, VOID_CELL, type EditableUniverse, type EditorArea, type EditorAreaLink, type EditorClass, type EditorItem, type EditorRace, type ExportedArea, type ExportedLiveIds, type ExportedTilesets, type ExportedTranslations, type TileSettings, type UniverseExport } from '@multiverse-kiln/shared';

import { readZip } from '../src/archives/zip.js';
import { findDefaultItemIds } from '../src/db/itemRepo.js';
import { findPlayer } from '../src/db/playerRepo.js';
import { findDefaultTileIds } from '../src/db/tileRepo.js';
import { setUniverseAccess, setUniverseRole } from '../src/db/universeEditorRepo.js';
import { AREA_FILE_END, areaFileStart, areaRowsText } from '../src/http/universeExport.js';
import { createArea, createUniverse, logIn, saveAll, send, solidPng, type Editor } from './editorRequests.js';
import { getTestServer, testServerUrl } from './testServer.js';

/**
 * The largest ID a tile can have, the largest value the database's integer columns hold
 */
const LARGEST_TILE_ID = 2147483647;

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

/**
 * What one of the export's JSON files holds
 *
 * @param files The archive's files
 * @param path The file's path
 * @return What it holds, or undefined when the archive doesn't have it
 */
function jsonOf<T>(files: Map<string, Buffer>, path: string): T | undefined
{
	const file = files.get(path);

	return(((file === undefined) ? undefined : JSON.parse(file.toString('utf8')) as T));
}

/**
 * The export's areas, from the files its manifest lists
 *
 * @param files The archive's files
 * @return The areas, in the order areas.json lists them
 */
function areasOf(files: Map<string, Buffer>): ExportedArea[]
{
	return((jsonOf<string[]>(files, UNIVERSE_EXPORT_AREAS) ?? []).map((path) =>
	{
		const area = jsonOf<ExportedArea>(files, path);

		assert.ok(area, `No ${path} in ${[...files.keys()].join(', ')}`);

		return(area);
	}));
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
		assert.ok(jsonOf<EditorRace[]>(files, UNIVERSE_EXPORT_RACES)?.some((race) => (race.key === 'dwarf')));
		assert.ok(jsonOf<EditorClass[]>(files, UNIVERSE_EXPORT_CLASSES)?.some((each) => (each.key === 'wizard')));
		assert.strictEqual(('races' in manifest) || ('classes' in manifest), false);
		assert.deepStrictEqual(manifest.themes, []);
		assert.deepStrictEqual(manifest.editors?.map((editor) => editor.role), ['creator']);

		// The ruleset's defaults are listed with their keys, so an import can find them in another database
		const tilesets = jsonOf<ExportedTilesets>(files, UNIVERSE_EXPORT_TILESETS);

		assert.ok(tilesets);
		assert.strictEqual(('tileGraphics' in manifest) || ('tiles' in manifest) || ('items' in manifest), false);
		assert.ok(jsonOf<EditorItem[]>(files, UNIVERSE_EXPORT_ITEMS)?.some((item) => (item.id === dagger) && (item.key === 'dagger')));
		assert.ok(tilesets.tiles.some((tile) => (tile.id === defaultTiles.get('grass')) && (tile.key === 'grass') && !tile.edited));
		assert.deepStrictEqual(tilesets.tiles.find((tile) => (tile.id === mossId)), {
			id: mossId,
			key: null,
			custom: true,
			edited: false,
			...moss,
			uploadedGraphicId: graphicId
		});
		assert.deepStrictEqual(tilesets.tileGraphics, [{ id: graphicId, name: 'Mossy', format: 'dualGrid', drawOrder: 35, file: `tilesets/${graphicId}.png` }]);
		// The image as stored, which the upload re-encoded
		const stored = Buffer.from(await (await fetch(`${testServerUrl}${TILE_GRAPHICS_PATH}/${graphicId}.png`)).arrayBuffer());

		assert.ok(files.get(`tilesets/${graphicId}.png`)?.equals(stored));

		// Each area is a file of its own, holding its settings, links and every cell as rows
		const areas = areasOf(files);
		const cave = areas.find((area) => (area.id === caveId));
		const lobby = areas.find((area) => (area.name === 'Lobby'));

		assert.deepStrictEqual(areas.map((area) => area.name), ['Cave', 'Lobby', 'Starting Area']);
		assert.ok(cave && lobby);
		assert.strictEqual(jsonOf<string[]>(files, UNIVERSE_EXPORT_AREAS)?.[0], `areas/${caveId}.json`);
		assert.strictEqual(('areas' in manifest) || ('liveIds' in manifest), false);
		assert.strictEqual(files.has(UNIVERSE_EXPORT_LIVE_IDS), false);
		assert.deepStrictEqual(cave.bounds, { minColumn: -15, minRow: -8, maxColumn: 15, maxRow: 8 });

		// The legend beside the cells names each number they hold and each file's area
		const legend = files.get(UNIVERSE_EXPORT_AREA_LEGEND)?.toString('utf8') ?? '';

		assert.match(legend, /^# Kilnhaven: area cells$/m);
		assert.ok(legend.includes(`| ${mossId} | Moss | #2A7A30 |`), legend);
		assert.ok(legend.includes(`| ${defaultTiles.get('grass')} | Grass |`), legend);
		assert.ok(legend.includes('| -1 | Void (nothing) |  |'), legend);
		assert.ok(legend.includes(`| \`${caveId}.json\` | Cave | Grass | Columns -15 to 15, rows -8 to 8 |`), legend);
		assert.deepStrictEqual(lobby.links, [{ column: 1, row: 0, targetAreaId: caveId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: true }]);

		// The settings are indented like the manifest, then each row is on a line of its own, from the north-west corner
		const { rows: lobbyRows, ...lobbySettings } = lobby;
		const settingsText = JSON.stringify(lobbySettings, null, '\t');
		const blankRow = `[${new Array(31).fill(0).join(',')}]`;

		assert.strictEqual(files.get(`areas/${lobby.id}.json`)?.toString('utf8'), `${settingsText.slice(0, -2)},\n\t"rows": [\n\t\t${new Array(17).fill(blankRow).join(',\n\t\t')}\n\t]\n}\n`);
		assert.ok(lobbyRows.flat().every((cell) => (cell === 0)));

		assert.strictEqual(cave.rows.length, 17);
		assert.ok(cave.rows.every((row) => (row.length === 31)));
		assert.strictEqual(cave.rows[8][15], mossId);
		assert.strictEqual(cave.rows[5][27], VOID_CELL);
		assert.strictEqual(cave.rows.flat().filter((cell) => (cell !== 0)).length, 2);

		// The notes, marks and translations are in a file of their own
		const text = jsonOf<ExportedTranslations>(files, UNIVERSE_EXPORT_TRANSLATIONS);

		assert.ok(text);
		assert.strictEqual(('translatorNotes' in manifest) || ('noTranslation' in manifest) || ('translations' in manifest), false);
		assert.deepStrictEqual(text.translatorNotes, [{ kind: 'area', thingId: caveId, field: 'name', note: 'A dark place' }]);
		assert.deepStrictEqual(text.noTranslation, [{ kind: 'universe', thingId: universeId, field: 'name' }]);
		assert.deepStrictEqual(text.languages, ['fr', 'de']);
		assert.deepStrictEqual(text.translations?.map((entry) => [entry.language, entry.text]), [['de', 'Höhle'], ['fr', 'Grotte']]);
	});

	it('gives a builder the world, without the settings or translations', async () =>
	{
		const bea = await logIn('Bea');

		await setUniverseRole(universeId, bea.playerId, 'builder');

		const { files } = await exportUniverse(bea, universeId);
		const manifest = manifestOf(files);
		const tilesets = jsonOf<ExportedTilesets>(files, UNIVERSE_EXPORT_TILESETS);

		assert.strictEqual(manifest.role, 'builder');
		assert.strictEqual(manifest.settings, undefined);
		assert.strictEqual(manifest.rulesetSettings, undefined);
		assert.strictEqual(files.has(UNIVERSE_EXPORT_RACES), false);
		assert.strictEqual(files.has(UNIVERSE_EXPORT_CLASSES), false);
		assert.strictEqual(manifest.editors, undefined);
		assert.strictEqual(areasOf(files).length, 3);
		assert.ok(tilesets);
		assert.strictEqual(tilesets.tileGraphics.length, 1);
		assert.ok(tilesets.tiles.some((tile) => (tile.id === mossId)));
		assert.ok((jsonOf<EditorItem[]>(files, UNIVERSE_EXPORT_ITEMS)?.length ?? 0) > 0);

		// The text's notes and marks, without translations
		const text = jsonOf<ExportedTranslations>(files, UNIVERSE_EXPORT_TRANSLATIONS);

		assert.strictEqual(text?.translatorNotes?.length, 1);
		assert.strictEqual(text.noTranslation?.length, 1);
		assert.strictEqual(('languages' in text) || ('translations' in text), false);
	});

	it('gives a translator their languages\' translations and the text needing none', async () =>
	{
		const cy = await logIn('Cy');

		await setUniverseAccess(universeId, cy.playerId, { role: 'translator', languages: ['fr', 'es'] });

		const { files } = await exportUniverse(cy, universeId);
		const manifest = manifestOf(files);

		assert.deepStrictEqual([...files.keys()], [UNIVERSE_EXPORT_MANIFEST, UNIVERSE_EXPORT_TRANSLATIONS, UNIVERSE_EXPORT_SIGNATURE]);
		assert.strictEqual(manifest.role, 'translator');
		assert.strictEqual(files.has(UNIVERSE_EXPORT_AREAS), false);

		// Without the world, there are no notes for translators
		assert.deepStrictEqual(jsonOf<ExportedTranslations>(files, UNIVERSE_EXPORT_TRANSLATIONS), {
			noTranslation: [{ kind: 'universe', thingId: universeId, field: 'name' }],
			languages: ['fr'],
			translations: [{ kind: 'area', thingId: caveId, field: 'name', language: 'fr', text: 'Grotte', sourceHash: sourceTextHash('Cave') }]
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
		const draftCave = areasOf(files).find((area) => (area.name === 'Cave'));
		const draftMoss = jsonOf<ExportedTilesets>(files, UNIVERSE_EXPORT_TILESETS)?.tiles.find((tile) => (tile.name === 'Moss'));

		assert.strictEqual(status, 200);
		assert.match(headers.get('content-disposition') ?? '', /\.kilnhaven\.draft\.\d{4}-\d{2}-\d{2}\.zip"?$/);
		assert.strictEqual(manifest.universe.version, 'draft');
		assert.ok(draftCave && draftMoss);
		assert.notStrictEqual(draftCave.id, caveId);
		assert.notStrictEqual(draftMoss.id, mossId);

		assert.strictEqual(draftCave.rows[8][15], draftMoss.id);

		// Each copied thing's live row is in a file of its own
		const liveIds = jsonOf<ExportedLiveIds>(files, UNIVERSE_EXPORT_LIVE_IDS);

		assert.strictEqual(liveIds?.areas[draftCave.id], caveId);
		assert.strictEqual(liveIds.tiles[String(draftMoss.id)], mossId);
		assert.deepStrictEqual(jsonOf<ExportedTranslations>(files, UNIVERSE_EXPORT_TRANSLATIONS)?.translations?.map((entry) => entry.thingId), [draftCave.id, draftCave.id]);
	});
});

/**
 * The longest of some words
 *
 * @param words The words
 * @return The longest
 */
function longest<T extends string>(words: readonly T[]): T
{
	return(words.reduce((found, word) => ((word.length > found.length) ? word : found)));
}

describe('an exported area\'s file', () =>
{
	it('fits what an import reads of one file for the largest area the editor allows', () =>
	{
		// The largest area, with every cell written as the largest tile ID and the most links, so no area the
		// editor allows writes a larger file
		const width = MAX_AREA_SIDE;
		const height = MAX_AREA_SIDE;
		const area: EditorArea = {
			id: randomUUID(),
			name: '龍'.repeat(MAX_AREA_NAME_LENGTH),
			parents: Array.from({ length: MAX_PLACE_PARENTS }, () => ({ kind: 'region', id: randomUUID() })),
			enabled: false,
			indoors: false,
			lightLevel: longest(AREA_LIGHT_LEVELS),
			defaultTileId: LARGEST_TILE_ID,
			passageOfTime: longest(PASSAGES_OF_TIME),
			faerieMorning: longest(FAERIE_MORNINGS),
			fogOfWar: false,
			loopsEastWest: false,
			loopsNorthSouth: false,
			resolved: {
				enabled: false,
				indoors: true,
				lightLevel: longest(AREA_LIGHT_LEVELS),
				defaultTileId: LARGEST_TILE_ID,
				passageOfTime: longest(PASSAGES_OF_TIME),
				faerieMorning: longest(FAERIE_MORNINGS),
				fogOfWar: false
			},
			bounds: {
				minColumn: -(width - 1),
				minRow: -(height - 1),
				maxColumn: 0,
				maxRow: 0
			}
		};
		const links: EditorAreaLink[] = Array.from({ length: MAX_AREA_LINKS }, () => ({
			column: -(width - 1),
			row: -(height - 1),
			targetAreaId: randomUUID(),
			targetColumn: -(MAX_AREA_SIDE - 1),
			targetRow: -(MAX_AREA_SIDE - 1),
			mode: longest(AREA_LINK_MODES),
			requiresWholeGroup: false
		}));
		const band = new Array<number[]>(CHUNK_SIZE).fill(new Array<number>(width).fill(LARGEST_TILE_ID));
		let bytes = Buffer.byteLength(areaFileStart(area, links)) + Buffer.byteLength(AREA_FILE_END);

		for (let row = 0; row < height; row += CHUNK_SIZE)
		{
			bytes += Buffer.byteLength(areaRowsText(band.slice(0, Math.min(CHUNK_SIZE, (height - row))), (row === 0)));
		}

		assert.ok(bytes <= MAX_UNIVERSE_IMPORT_JSON_FILE_BYTES, `The file holds ${bytes} bytes`);
	});
});
