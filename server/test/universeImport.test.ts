import assert from 'assert';
import { randomUUID } from 'crypto';
import http from 'http';
import { DEFAULT_SITE_SETTINGS, EDITOR_UNIVERSES_PATH, emptyMoney, MAX_AREA_LINKS, MAX_AREA_SIDE, MAX_AREAS_PER_UNIVERSE, MAX_UNIVERSE_IMPORT_JSON_BYTES, MAX_UNIVERSE_IMPORT_JSON_FILE_BYTES, MAX_UPLOADED_TILE_GRAPHICS, NEW_PF1E_RACE_RULES, sourceTextHash, UNIVERSE_EXPORT_AREA_LEGEND, UNIVERSE_EXPORT_AREAS, UNIVERSE_EXPORT_CLASSES, UNIVERSE_EXPORT_ITEMS, UNIVERSE_EXPORT_LIVE_IDS, UNIVERSE_EXPORT_MANIFEST, UNIVERSE_EXPORT_PATH, UNIVERSE_EXPORT_SIGNATURE, UNIVERSE_EXPORT_RACES, UNIVERSE_EXPORT_REGIONS, UNIVERSE_EXPORT_TILESETS, UNIVERSE_EXPORT_TRANSLATIONS, UNIVERSE_IMPORT_PATH, UNIVERSE_IMPORT_PREVIEW_PATH, UNIVERSE_IMPORT_RIGHTS_PARAM, VOID_CELL, type AreaListPayload, type EditableUniverse, type EditorChange, type EditorClass, type EditorItem, type EditorRace, type ErrorPayload, type ExportedArea, type ExportedLiveIds, type ExportedRegion, type ExportedTilesets, type ExportedTranslations, type TileSettings, type UniverseExport, type UniverseImportPreview } from '@multiverse-kiln/shared';

import { readZip, zipArchive, zipFile } from '../src/archives/zip.js';
import { adminDb } from '../src/db/adminClient.js';
import { saveSiteSettings } from '../src/db/siteSettingsRepo.js';
import { createTileGraphic, tileGraphicStorageKey } from '../src/db/tileGraphicRepo.js';
import { listUniverseEdits } from '../src/db/universeEditRepo.js';
import { isImporting } from '../src/http/universeImport.js';
import { setUniverseAccess, setUniverseRole } from '../src/db/universeEditorRepo.js';
import { createArea, createUniverse, logIn, saveAll, send, solidPng, worldRegionId, type Editor } from './editorRequests.js';
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
 * @return The archive
 */
async function exportArchive(editor: Editor, universeId: string, version?: 'draft'): Promise<Buffer>
{
	const query = ((version === undefined) ? '' : `?version=${version}`);
	const response = await fetch(`${testServerUrl}${EDITOR_UNIVERSES_PATH}/${universeId}${UNIVERSE_EXPORT_PATH}${query}`, {
		headers: { Cookie: editor.cookie }
	});

	assert.strictEqual(response.status, 200);

	return(Buffer.from(await response.arrayBuffer()));
}

/**
 * What an export's JSON files hold
 */
interface ExportContents
{
	manifest: UniverseExport;

	/**
	 * Undefined when the archive has no races.json or classes.json
	 */
	races: EditorRace[] | undefined;
	classes: EditorClass[] | undefined;

	/**
	 * Undefined when the archive has no tilesets.json or items.json
	 */
	tilesets: ExportedTilesets | undefined;
	items: EditorItem[] | undefined;

	/**
	 * The areas' files' paths, as areas.json lists them, or undefined when the archive has no areas.json,
	 * and the files, in the same order
	 */
	areaPaths: string[] | undefined;
	areas: ExportedArea[];

	/**
	 * Undefined when the archive has no regions.json
	 */
	regions: ExportedRegion[] | undefined;

	/**
	 * Undefined when the archive has no translations.json
	 */
	translations: ExportedTranslations | undefined;

	/**
	 * Undefined when the archive has no liveIds.json
	 */
	liveIds: ExportedLiveIds | undefined;

	/**
	 * The text of signature.json, kept as it is so the file's origin stays signed while its other files
	 * are changed, or undefined when the archive has none
	 */
	signature: string | undefined;
}

/**
 * What an archive's JSON files hold
 *
 * @param archive The archive
 * @return The manifest, the races and classes, and the areas
 */
async function contentsOf(archive: Buffer): Promise<ExportContents>
{
	const files = await readZip(archive, 100000000);
	const jsonOf = <T>(path: string): T | undefined => ((files.get(path) === undefined) ? undefined : JSON.parse(files.get(path)?.toString('utf8') ?? '') as T);
	const manifest = jsonOf<UniverseExport>(UNIVERSE_EXPORT_MANIFEST);
	const areaPaths = jsonOf<string[]>(UNIVERSE_EXPORT_AREAS);

	assert.ok(manifest);

	return({
		manifest,
		races: jsonOf<EditorRace[]>(UNIVERSE_EXPORT_RACES),
		classes: jsonOf<EditorClass[]>(UNIVERSE_EXPORT_CLASSES),
		tilesets: jsonOf<ExportedTilesets>(UNIVERSE_EXPORT_TILESETS),
		items: jsonOf<EditorItem[]>(UNIVERSE_EXPORT_ITEMS),
		areaPaths,
		areas: (areaPaths ?? []).map((path) => jsonOf<ExportedArea>(path) ?? assert.fail(`No ${path}`)),
		regions: jsonOf<ExportedRegion[]>(UNIVERSE_EXPORT_REGIONS),
		translations: jsonOf<ExportedTranslations>(UNIVERSE_EXPORT_TRANSLATIONS),
		liveIds: jsonOf<ExportedLiveIds>(UNIVERSE_EXPORT_LIVE_IDS),
		signature: files.get(UNIVERSE_EXPORT_SIGNATURE)?.toString('utf8')
	});
}

/**
 * An archive of an export's JSON files, as contentsOf() read them and a test changed them, without its
 * tilesets' images, and with its signature as it was, as editing an export by hand leaves it
 *
 * @param contents What the files hold
 * @param folder The folder to put them in, such as "Kilnhaven/", or '' for the archive's root
 * @param others Other files to add, by their paths in the archive, as zipping a folder can
 * @return The archive
 */
async function archiveOf(contents: ExportContents, folder = '', others: Record<string, string> = {}): Promise<Buffer>
{
	const files = new Map<string, unknown>([[UNIVERSE_EXPORT_MANIFEST, contents.manifest]]);

	if (contents.races && contents.classes)
	{
		files.set(UNIVERSE_EXPORT_RACES, contents.races);
		files.set(UNIVERSE_EXPORT_CLASSES, contents.classes);
	}

	if (contents.tilesets && contents.items)
	{
		files.set(UNIVERSE_EXPORT_TILESETS, contents.tilesets);
		files.set(UNIVERSE_EXPORT_ITEMS, contents.items);
	}

	if (contents.areaPaths)
	{
		files.set(UNIVERSE_EXPORT_AREAS, contents.areaPaths);
	}

	if (contents.regions)
	{
		files.set(UNIVERSE_EXPORT_REGIONS, contents.regions);
	}

	for (const [index, path] of (contents.areaPaths ?? []).entries())
	{
		files.set(path, contents.areas[index]);
	}

	if (contents.translations)
	{
		files.set(UNIVERSE_EXPORT_TRANSLATIONS, contents.translations);
	}

	if (contents.liveIds)
	{
		files.set(UNIVERSE_EXPORT_LIVE_IDS, contents.liveIds);
	}

	const zipped = await Promise.all([...files].map(([path, value]) => zipFile(`${folder}${path}`, [JSON.stringify(value)])));
	const signature = ((contents.signature === undefined) ? [] : [await zipFile(`${folder}${UNIVERSE_EXPORT_SIGNATURE}`, [contents.signature])]);
	const extra = await Promise.all(Object.entries(others).map(([path, text]) => zipFile(path, [text])));

	return(zipArchive([...zipped, ...signature, ...extra], new Date()));
}

/**
 * An archive with some of its files replaced or added, as they are written
 *
 * @param archive The archive
 * @param replaced The files to replace or add, by their paths in it
 * @return The new archive
 */
async function archiveWith(archive: Buffer, replaced: Record<string, string>): Promise<Buffer>
{
	const files = await readZip(archive, 1000000000);

	for (const [path, text] of Object.entries(replaced))
	{
		files.set(path, Buffer.from(text));
	}

	return(zipArchive(await Promise.all([...files].map(([path, data]) => zipFile(path, [data]))), new Date()));
}

/**
 * The universe's draft, as its export holds it
 *
 * @param editor The browser asking
 * @param universeId The universe's ID
 * @return What the draft's export holds
 */
async function draftOf(editor: Editor, universeId: string): Promise<ExportContents>
{
	return(contentsOf(await exportArchive(editor, universeId, 'draft')));
}

/**
 * Sends a file to the import routes, as Import Universe does
 *
 * @param editor The browser sending it
 * @param universeId The universe's ID
 * @param archive The file
 * @param options Whether to only preview it, whether to send it to the live version, whether the
 * player confirms their rights to its tilesets, and the type to send it as, application/zip by default
 * @return The status and the answer
 */
async function importArchive<T = ErrorPayload>(editor: Editor, universeId: string, archive: Buffer, options: { preview?: boolean; live?: boolean; rights?: boolean; contentType?: string } = {}): Promise<{ status: number; body: T }>
{
	const path = (options.preview ? UNIVERSE_IMPORT_PREVIEW_PATH : UNIVERSE_IMPORT_PATH);
	const query = new URLSearchParams();

	if (!options.live)
	{
		query.set('version', 'draft');
	}

	if (options.rights ?? true)
	{
		query.set(UNIVERSE_IMPORT_RIGHTS_PARAM, 'true');
	}

	const response = await fetch(`${testServerUrl}${EDITOR_UNIVERSES_PATH}/${universeId}${path}?${query.toString()}`, {
		method: 'POST',
		headers: {
			'Cookie': editor.cookie,
			'Content-Type': (options.contentType ?? 'application/zip')
		},
		body: new Uint8Array(archive)
	});
	const text = await response.text();

	return({
		status: response.status,
		body: ((text === '') ? undefined : JSON.parse(text)) as T
	});
}

/**
 * Starts previewing a file whose body never finishes arriving: it declares 8 MB and sends 64 KB of it
 *
 * @param editor The browser sending it
 * @param universeId The universe's ID
 * @return The open request, to destroy once the test is done with it
 */
async function startUnfinishedImport(editor: Editor, universeId: string): Promise<http.ClientRequest>
{
	const request = http.request(new URL(`${testServerUrl}${EDITOR_UNIVERSES_PATH}/${universeId}${UNIVERSE_IMPORT_PREVIEW_PATH}?version=draft`), {
		method: 'POST',
		agent: false,
		headers: {
			'Cookie': editor.cookie,
			'Content-Type': 'application/zip',
			'Content-Length': String(8 * 1024 * 1024)
		}
	});

	request.on('error', () => undefined);

	await new Promise<void>((resolve) =>
	{
		request.write(Buffer.alloc(64 * 1024), () => resolve());
	});

	return(request);
}

/**
 * Waits until an import holds a player's place, or doesn't, since the server takes a moment to reach a
 * file sent or given up just before
 *
 * @param playerId The player's ID
 * @param held Whether to wait for the place to be held
 */
async function waitForImportPlace(playerId: string, held: boolean): Promise<void>
{
	const end = Date.now() + 2000;

	while ((isImporting(playerId) !== held) && (Date.now() < end))
	{
		await new Promise((resolve) => setTimeout(resolve, 5));
	}

	assert.strictEqual(isImporting(playerId), held);
}

/**
 * Previews a file that isn't a zip file
 *
 * @param editor The browser sending it
 * @param universeId The universe's ID
 * @return The status answered
 */
async function previewNotZip(editor: Editor, universeId: string): Promise<number>
{
	return((await importArchive(editor, universeId, Buffer.from('not a zip'), { preview: true })).status);
}

/**
 * Saves editor changes to a universe's draft that must all be saved
 *
 * @param editor The browser saving them
 * @param universeId The universe's ID
 * @param changes The changes
 */
async function saveToDraft(editor: Editor, universeId: string, changes: EditorChange[]): Promise<void>
{
	const response = await send(editor, 'POST', `/${universeId}/changes?version=draft`, { body: { changes } });

	assert.strictEqual(response.status, 200, JSON.stringify(response.body));
}

/**
 * The cell an area's file holds at a column and row
 *
 * @param area The area's file
 * @param column The column
 * @param row The row
 * @return The cell's value, 0 for the default tile
 */
function cellAt(area: ExportedArea, column: number, row: number): number
{
	return(area.rows[row - area.bounds.minRow]?.[column - area.bounds.minColumn] ?? 0);
}

describe('importing a universe', () =>
{
	let ada: Editor;
	let kilnhavenId: string;
	let caveId: string;

	before(async () =>
	{
		await getTestServer();
	});

	/**
	 * Kilnhaven: a universe translated into French, with a cave painted with a tile of its own drawn with
	 * an uploaded tileset, a link from the lobby into it, an item, and a race starting in the cave with it
	 */
	beforeEach(async () =>
	{
		ada = await logIn('Ada');
		kilnhavenId = await createUniverse(ada, 'Kilnhaven');
		caveId = await createArea(ada, kilnhavenId, { name: 'Cave' });

		const { lobbyAreaId } = (await send<EditableUniverse>(ada, 'GET', `/${kilnhavenId}`)).body;

		assert.ok(lobbyAreaId);

		const ids = await saveAll(ada, kilnhavenId, [
			{ kind: 'universe', update: { translationLanguages: ['fr'], longDescription: 'A small town.' } },
			{ kind: 'uploadTileGraphic', ref: 'new:mossy', upload: { name: 'Mossy', format: 'dualGrid', drawOrder: 35, image: await solidPng(), rightsConfirmed: true } },
			{ kind: 'createTile', ref: 'new:moss', settings: { ...moss, uploadedGraphicId: 'new:mossy' } },
			{ kind: 'editCells', areaId: caveId, changes: [[0, 0, 'new:moss'], [12, -3, VOID_CELL]] },
			{ kind: 'saveLink', areaId: lobbyAreaId, column: 1, row: 0, target: { targetAreaId: caveId, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: true } },
			{ kind: 'createItem', ref: 'new:lantern', settings: { name: 'Lantern', type: 'torch', enabled: true } },
			{ kind: 'saveTranslatorNote', text: { kind: 'area', thingId: caveId, field: 'name' }, note: 'A dark place' },
			{ kind: 'saveNoTranslation', text: { kind: 'universe', thingId: kilnhavenId, field: 'name' }, noTranslation: true }
		]);
		const lanternId = Number(ids['new:lantern']);

		await saveAll(ada, kilnhavenId, [
			{
				kind: 'createRace',
				ref: 'new:mole',
				settings: {
					name: 'Molefolk',
					enabled: true,
					keepPlaying: true,
					startingMoney: emptyMoney(),
					startingItems: [{ itemId: lanternId, quantity: 2 }],
					startingAreaId: caveId,
					startingColumn: 0,
					startingRow: 0,
					rules: NEW_PF1E_RACE_RULES
				}
			},
			{ kind: 'saveTranslation', text: { kind: 'area', thingId: caveId, field: 'name' }, language: 'fr', translation: 'Grotte', sourceHash: sourceTextHash('Cave') }
		]);
	});

	it('exports and imports regions, with the areas\' parents and the builders assigned to them', async () =>
	{
		const worldId = await worldRegionId(ada, kilnhavenId);
		const bea = await logIn('Bea');

		await saveAll(ada, kilnhavenId, [
			{ kind: 'addEditor', username: 'Bea', settings: { role: 'builder', languages: [], permissions: { canEditTiles: true, canEditItems: false, canEditMobs: false } } },
			{ kind: 'createRegion', ref: 'new:capitol', region: { name: 'Capitol City', parents: [{ kind: 'region', id: worldId }], enabled: null, indoors: null, lightLevel: null, defaultTileId: null, passageOfTime: 'always_noon', faerieMorning: null, fogOfWar: false } },
			{ kind: 'createArea', ref: 'new:market', area: { name: 'Market', parents: [{ kind: 'region', id: 'new:capitol' }] } },
			{ kind: 'createArea', ref: 'new:stall', area: { name: 'Stall', parents: [{ kind: 'area', id: 'new:market' }, { kind: 'region', id: worldId }] } },
			{ kind: 'assignBuilders', regionId: 'new:capitol', builderIds: [bea.playerId] }
		]);

		const exported = await contentsOf(await exportArchive(ada, kilnhavenId));
		const capitol = exported.regions?.find((region) => (region.name === 'Capitol City'));
		const market = exported.areas.find((area) => (area.name === 'Market'));

		assert.ok(capitol && market);
		assert.deepStrictEqual(exported.regions?.map((region) => region.name), ['Capitol City', 'World']);
		assert.deepStrictEqual(capitol.parents, [{ kind: 'region', id: worldId }]);
		assert.strictEqual(capitol.passageOfTime, 'always_noon');
		assert.strictEqual(capitol.fogOfWar, false);
		assert.deepStrictEqual(exported.areas.find((area) => (area.name === 'Stall'))?.parents, [{ kind: 'area', id: market.id }, { kind: 'region', id: worldId }]);
		assert.deepStrictEqual(exported.manifest.editors?.find((editor) => (editor.username === 'Bea')), {
			username: 'Bea',
			role: 'builder',
			languages: [],
			permissions: { canEditTiles: true, canEditItems: false, canEditMobs: false },
			regions: [capitol.id]
		});

		const otherId = await createUniverse(ada, 'Otherhaven');

		await saveAll(ada, otherId, [{ kind: 'startDraft' }]);
		assert.strictEqual((await importArchive(ada, otherId, await exportArchive(ada, kilnhavenId))).status, 204);

		const draft = (await send<AreaListPayload>(ada, 'GET', `/${otherId}/areas?version=draft`)).body;
		const importedCapitol = draft.regions.find((region) => (region.name === 'Capitol City'));
		const importedWorld = draft.regions.find((region) => (region.name === 'World'));
		const importedMarket = draft.areas.find((area) => (area.name === 'Market'));

		assert.ok(importedCapitol && importedWorld && importedMarket);
		assert.deepStrictEqual(draft.regions.map((region) => region.name), ['Capitol City', 'World']);
		assert.deepStrictEqual(importedCapitol.parents, [{ kind: 'region', id: importedWorld.id }]);
		assert.deepStrictEqual(importedMarket.parents, [{ kind: 'region', id: importedCapitol.id }]);
		assert.strictEqual(importedMarket.resolved.passageOfTime, 'always_noon');
		assert.strictEqual(importedMarket.resolved.fogOfWar, false);
		assert.deepStrictEqual(draft.areas.find((area) => (area.name === 'Stall'))?.parents, [{ kind: 'area', id: importedMarket.id }, { kind: 'region', id: importedWorld.id }]);
	});

	it('imports another universe\'s export into a draft, which applies to the live version', async () =>
	{
		const archive = await exportArchive(ada, kilnhavenId);
		const otherId = await createUniverse(ada, 'Otherhaven');

		await saveAll(ada, otherId, [
			{ kind: 'createArea', ref: 'new:swamp', area: { name: 'Swamp', parents: [{ kind: 'region', id: await worldRegionId(ada, otherId) }] } },
			{ kind: 'startDraft' }
		]);

		const preview = await importArchive<UniverseImportPreview>(ada, otherId, archive, { preview: true });

		assert.strictEqual(preview.status, 200, JSON.stringify(preview.body));
		assert.strictEqual(preview.body.sameUniverse, false);
		assert.deepStrictEqual(preview.body.parts, ['settings', 'world', 'noTranslation', 'translations']);
		assert.strictEqual(preview.body.counts.areas, 3);
		assert.strictEqual(preview.body.tilesetUploads, 1);
		assert.deepStrictEqual(preview.body.translationLanguages, ['fr']);

		// Kilnhaven's name is taken, by Kilnhaven, so the copy is named for it
		assert.deepStrictEqual(preview.body.leftOut, ['universeOnly']);
		assert.strictEqual(preview.body.name, 'Kilnhaven (copy)');

		const imported = await importArchive(ada, otherId, archive);

		assert.strictEqual(imported.status, 204, JSON.stringify(imported.body));

		const { manifest, races, tilesets, items, areas, translations } = await draftOf(ada, otherId);
		const cave = areas.find((area) => (area.name === 'Cave'));
		const lobby = areas.find((area) => (area.name === 'Lobby'));
		const tile = tilesets?.tiles.find((each) => (each.name === 'Moss'));
		const lantern = items?.find((item) => (item.name === 'Lantern'));
		const race = races?.find((each) => (each.name === 'Molefolk'));

		assert.deepStrictEqual(areas.map((area) => area.name), ['Cave', 'Lobby', 'Starting Area']);
		assert.ok(cave && lobby && tile && lantern && race);
		assert.strictEqual(manifest.settings?.name, 'Kilnhaven (copy)');
		assert.strictEqual(manifest.settings?.longDescription, 'A small town.');
		assert.strictEqual(manifest.settings?.lobbyAreaId, lobby.id);
		assert.strictEqual(cellAt(cave, 0, 0), tile.id);
		assert.strictEqual(cellAt(cave, 12, -3), VOID_CELL);
		assert.strictEqual(tilesets?.tileGraphics.length, 1);
		assert.strictEqual(tile.uploadedGraphicId, tilesets.tileGraphics[0]?.id);
		assert.deepStrictEqual(lobby.links.map((link) => [link.column, link.row, link.targetAreaId, link.requiresWholeGroup]), [[1, 0, cave.id, true]]);
		assert.deepStrictEqual(race.startingItems, [{ itemId: lantern.id, quantity: 2 }]);
		assert.strictEqual(race.startingAreaId, cave.id);
		assert.deepStrictEqual(translations?.translatorNotes, [{ kind: 'area', thingId: cave.id, field: 'name', note: 'A dark place' }]);
		assert.deepStrictEqual(translations.noTranslation, [{ kind: 'universe', thingId: otherId, field: 'name' }]);
		assert.deepStrictEqual(translations.translations?.map((entry) => [entry.thingId, entry.text]), [[cave.id, 'Grotte']]);

		// The draft reaches the live version only once it is applied
		const live = await contentsOf(await exportArchive(ada, otherId));

		assert.deepStrictEqual(live.areas.map((area) => area.name), ['Lobby', 'Starting Area', 'Swamp']);

		await saveAll(ada, otherId, [{ kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } }]);

		const applied = await contentsOf(await exportArchive(ada, otherId));

		assert.deepStrictEqual(applied.areas.map((area) => area.name), ['Cave', 'Lobby', 'Starting Area']);
		assert.ok(applied.races?.some((each) => (each.name === 'Molefolk')));
		assert.strictEqual(applied.manifest.universe.name, 'Kilnhaven (copy)');

		// With the first copy's name taken now, the next copy is numbered
		const thirdId = await createUniverse(ada, 'Thirdhaven');

		await saveAll(ada, thirdId, [{ kind: 'startDraft' }]);
		assert.strictEqual((await importArchive<UniverseImportPreview>(ada, thirdId, archive, { preview: true })).body.name, 'Kilnhaven (copy 2)');

		// The import is recorded as a save to the draft
		const edits = await listUniverseEdits(otherId, { offset: 0, limit: 10 });

		assert.ok(edits.edits.some((edit) => (edit.draft && (edit.changeDetails?.some((change) => ((change.subject === 'area') && (change.action === 'added'))) ?? false))));
	});

	it('puts the same universe\'s draft back as it was exported, keeping its things\' places', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const before = await draftOf(ada, kilnhavenId);
		const archive = await exportArchive(ada, kilnhavenId, 'draft');
		const draftCave = before.areas.find((area) => (area.name === 'Cave'));
		const draftMoss = before.tilesets?.tiles.find((tile) => (tile.name === 'Moss'));

		assert.ok(draftCave && draftMoss);

		// Changes to the draft after the export, which the import takes back
		await saveToDraft(ada, kilnhavenId, [
			{ kind: 'updateArea', areaId: draftCave.id, update: { name: 'Grotto' } },
			{ kind: 'editCells', areaId: draftCave.id, changes: [[0, 0, VOID_CELL], [3, 3, VOID_CELL]] },
			{ kind: 'createArea', ref: 'new:swamp', area: { name: 'Swamp', parents: [{ kind: 'region', id: await worldRegionId(ada, kilnhavenId, 'draft') }] } }
		]);

		const imported = await importArchive(ada, kilnhavenId, archive);

		assert.strictEqual(imported.status, 204, JSON.stringify(imported.body));

		const after = await draftOf(ada, kilnhavenId);
		const cave = after.areas.find((area) => (area.id === draftCave.id));

		assert.deepStrictEqual(after.areas.map((area) => area.name), ['Cave', 'Lobby', 'Starting Area']);
		assert.ok(cave);
		assert.strictEqual(cellAt(cave, 0, 0), draftMoss.id);
		assert.strictEqual(cellAt(cave, 3, 3), 0);
		assert.strictEqual(cellAt(cave, 12, -3), VOID_CELL);
		assert.deepStrictEqual(after.tilesets?.tiles.find((tile) => (tile.name === 'Moss'))?.id, draftMoss.id);
		assert.strictEqual(after.tilesets?.tileGraphics.length, 1);

		// Once applied, the live version's cave and race are the ones it had
		const liveBefore = await contentsOf(await exportArchive(ada, kilnhavenId));

		await saveAll(ada, kilnhavenId, [{ kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } }]);

		const liveAfter = await contentsOf(await exportArchive(ada, kilnhavenId));

		assert.deepStrictEqual(liveAfter.areas.map((area) => area.id).sort(), liveBefore.areas.map((area) => area.id).sort());
		assert.strictEqual(liveAfter.races?.find((race) => (race.name === 'Molefolk'))?.id, liveBefore.races?.find((race) => (race.name === 'Molefolk'))?.id);
		assert.ok(liveAfter.areas.some((area) => (area.id === caveId)));
	});

	it('records nothing on the Audit tab when the file holds what the draft does', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const archive = await exportArchive(ada, kilnhavenId, 'draft');
		const before = (await listUniverseEdits(kilnhavenId, { offset: 0, limit: 100 })).total;
		const imported = await importArchive(ada, kilnhavenId, archive);

		assert.strictEqual(imported.status, 204, JSON.stringify(imported.body));

		const after = await listUniverseEdits(kilnhavenId, { offset: 0, limit: 100 });

		assert.strictEqual(after.total, before, JSON.stringify(after.edits[0]?.changeDetails));

		// A live export imported into the draft copied from it holds the same too
		const live = await exportArchive(ada, kilnhavenId);

		assert.strictEqual((await importArchive(ada, kilnhavenId, live)).status, 204);
		assert.strictEqual((await listUniverseEdits(kilnhavenId, { offset: 0, limit: 100 })).total, before);
	});

	it('imports only what the player\'s role can change', async () =>
	{
		const bea = await logIn('Bea');
		const cy = await logIn('Cy');

		await setUniverseRole(kilnhavenId, bea.playerId, 'builder');
		await setUniverseAccess(kilnhavenId, cy.playerId, { role: 'translator', languages: ['fr'] });

		const archive = await exportArchive(ada, kilnhavenId);

		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const builder = await importArchive<UniverseImportPreview>(bea, kilnhavenId, archive, { preview: true });
		const translator = await importArchive<UniverseImportPreview>(cy, kilnhavenId, archive, { preview: true });

		assert.deepStrictEqual(builder.body.parts, ['world', 'noTranslation']);
		assert.deepStrictEqual(builder.body.leftOut, ['universeOnly', 'settingsRole', 'translationLanguages']);
		assert.deepStrictEqual(translator.body.parts, ['noTranslation', 'translations']);
		assert.deepStrictEqual(translator.body.leftOut, ['universeOnly', 'settingsRole', 'worldRole']);

		// The translator's import changes the translation, and nothing else
		const draftCave = (await draftOf(ada, kilnhavenId)).areas.find((area) => (area.name === 'Cave'));

		assert.ok(draftCave);

		await saveToDraft(ada, kilnhavenId, [
			{ kind: 'saveTranslation', text: { kind: 'area', thingId: draftCave.id, field: 'name' }, language: 'fr', translation: 'Caverne', sourceHash: sourceTextHash('Cave') },
			{ kind: 'updateArea', areaId: draftCave.id, update: { enabled: false } }
		]);
		assert.strictEqual((await importArchive(cy, kilnhavenId, archive)).status, 204);

		const after = await draftOf(ada, kilnhavenId);

		assert.deepStrictEqual(after.translations?.translations?.map((entry) => entry.text), ['Grotte']);
		assert.strictEqual(after.areas.find((area) => (area.id === draftCave.id))?.enabled, false);
	});

	it('refuses an import into the live version, a beta tester\'s, and files it can\'t import', async () =>
	{
		const archive = await exportArchive(ada, kilnhavenId);
		const dee = await logIn('Dee');
		const starfinderId = await createUniverse(ada, 'Starfall', 'sf1e');
		const otherId = await createUniverse(ada, 'Otherhaven');

		await setUniverseRole(kilnhavenId, dee.playerId, 'beta_tester');

		for (const universeId of [kilnhavenId, starfinderId, otherId])
		{
			await saveAll(ada, universeId, [{ kind: 'startDraft' }]);
		}

		const live = await importArchive(ada, kilnhavenId, archive, { live: true });
		const notZip = await importArchive(ada, kilnhavenId, Buffer.from('{"format":"universe-export"}'));
		const ruleset = await importArchive(ada, starfinderId, archive);

		// Another universe uploads the file's tileset, which Kilnhaven's own draft already has
		const rights = await importArchive(ada, otherId, archive, { rights: false });
		const newer = zipArchive([await zipFile(UNIVERSE_EXPORT_MANIFEST, [JSON.stringify({ format: 'universe-export', formatVersion: 99 })])], new Date());

		assert.strictEqual(live.status, 409);
		assert.strictEqual(live.body.error.id, 'error.importDraftOnly');
		assert.strictEqual((await importArchive(dee, kilnhavenId, archive)).status, 403);
		assert.strictEqual(notZip.status, 400);
		assert.strictEqual(notZip.body.error.id, 'error.importNotAnExport');
		assert.strictEqual(ruleset.body.error.id, 'error.importOtherRuleset');
		assert.strictEqual(rights.status, 400);
		assert.strictEqual(rights.body.error.id, 'error.importRightsNeeded');
		assert.strictEqual((await importArchive(ada, kilnhavenId, newer)).body.error.id, 'error.importNewerFormat');
	});

	it('refuses a body sent as JSON, which the editor\'s routes parse into an array or object before the import route sees it', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		for (const body of ['[80, 75, 5, 6]', '{"length": 1000000}'])
		{
			for (const preview of [true, false])
			{
				const response = await importArchive(ada, kilnhavenId, Buffer.from(body), {
					preview,
					contentType: 'application/json'
				});

				assert.strictEqual(response.status, 400, body);
				assert.strictEqual(response.body.error.id, 'error.importNotZip', body);
			}
		}
	});

	it('refuses another import from a player, or past the server\'s limit, from before a file still arriving is read', async () =>
	{
		const bea = await logIn('Bea');
		const cyd = await logIn('Cyd');
		const beaUniverseId = await createUniverse(bea, 'Beahaven');
		const cydUniverseId = await createUniverse(cyd, 'Cydhaven');
		const open: http.ClientRequest[] = [];

		for (const [editor, universeId] of [[ada, kilnhavenId], [bea, beaUniverseId], [cyd, cydUniverseId]] as const)
		{
			await saveAll(editor, universeId, [{ kind: 'startDraft' }]);
		}

		try
		{
			open.push(await startUnfinishedImport(ada, kilnhavenId));
			await waitForImportPlace(ada.playerId, true);
			assert.strictEqual(await previewNotZip(ada, kilnhavenId), 429);

			open.push(await startUnfinishedImport(bea, beaUniverseId));
			await waitForImportPlace(bea.playerId, true);
			assert.strictEqual(await previewNotZip(cyd, cydUniverseId), 503);

			// Once Ada's unfinished file is given up, Ada's place is free again
			open.shift()?.destroy();
			await waitForImportPlace(ada.playerId, false);
			assert.strictEqual(await previewNotZip(ada, kilnhavenId), 400);
		}
		finally
		{
			for (const request of open)
			{
				request.destroy();
			}
		}
	});

	it('refuses a file whose content a save wouldn\'t take, saving none of it', async () =>
	{
		const contents = await contentsOf(await exportArchive(ada, kilnhavenId));
		const otherId = await createUniverse(ada, 'Otherhaven');
		const cave = contents.areas.find((area) => (area.name === 'Cave'));

		assert.ok(cave);
		cave.name = '';

		await saveAll(ada, otherId, [{ kind: 'startDraft' }]);

		const refused = await importArchive(ada, otherId, await archiveOf(contents));

		assert.strictEqual(refused.status, 400);
		assert.strictEqual(refused.body.error.id, 'error.importNotAnExport');
		assert.deepStrictEqual((await draftOf(ada, otherId)).areas.map((area) => area.name), ['Lobby', 'Starting Area']);
	});

	it('keeps the draft\'s name when the file\'s could be made into a link, importing the rest', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const contents = await contentsOf(await exportArchive(ada, kilnhavenId, 'draft'));

		assert.ok(contents.manifest.settings);
		contents.manifest.settings.name = 'Visit evil.example';

		const archive = await archiveOf(contents);
		const preview = await importArchive<UniverseImportPreview>(ada, kilnhavenId, archive, { preview: true });

		assert.strictEqual(preview.status, 200, JSON.stringify(preview.body));
		assert.deepStrictEqual(preview.body.leftOut, ['universeOnly', 'nameLinkLike']);
		assert.strictEqual(preview.body.name, null);

		const imported = await importArchive(ada, kilnhavenId, archive);

		assert.strictEqual(imported.status, 204, JSON.stringify(imported.body));
		assert.strictEqual((await draftOf(ada, kilnhavenId)).manifest.settings?.name, 'Kilnhaven');
	});

	it('refuses a file with more tilesets than a universe may have, or naming one image for two, before uploading any', async () =>
	{
		const contents = await contentsOf(await exportArchive(ada, kilnhavenId));
		const otherId = await createUniverse(ada, 'Otherhaven');
		const [graphic] = contents.tilesets?.tileGraphics ?? [];

		assert.ok(contents.tilesets && graphic);
		await saveAll(ada, otherId, [{ kind: 'startDraft' }]);

		const tilesets = contents.tilesets;
		const tooMany = await importArchive(ada, otherId, await archiveOf({
			...contents,
			tilesets: {
				...tilesets,
				tileGraphics: Array.from({ length: (MAX_UPLOADED_TILE_GRAPHICS + 1) }, (unused, index) => ({ ...graphic, id: randomUUID(), file: `tilesets/${index}.png` }))
			}
		}), { preview: true });
		const shared = await importArchive(ada, otherId, await archiveOf({
			...contents,
			tilesets: {
				...tilesets,
				tileGraphics: [graphic, { ...graphic, id: randomUUID() }]
			}
		}), { preview: true });

		assert.strictEqual(tooMany.status, 400);
		assert.strictEqual(tooMany.body.error.id, 'error.importNotAnExport');
		assert.match(tooMany.body.error.values?.problem as string, /tilesets\.json/);
		assert.strictEqual(shared.status, 400);
		assert.match(shared.body.error.values?.problem as string, /names tilesets\/.+\.png for more than one tileset/);

		// A draft with as many tilesets as it may have has no room for the file's
		for (let index = 0; index < MAX_UPLOADED_TILE_GRAPHICS; index++)
		{
			const graphicId = randomUUID();

			await createTileGraphic(graphicId, {
				universeId: otherId,
				draft: true,
				name: `Graphic ${index}`,
				format: 'dualGrid',
				drawOrder: 35,
				storageKey: tileGraphicStorageKey(otherId, graphicId),
				uploadedBy: ada.playerId
			});
		}

		const full = await importArchive(ada, otherId, await exportArchive(ada, kilnhavenId), { preview: true });

		assert.strictEqual(full.status, 400);
		assert.strictEqual(full.body.error.id, 'error.tileGraphicLimit');
	});

	it('refuses a file whose rows don\'t cover exactly their area\'s bounds, or that is missing a file', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const contents = await contentsOf(await exportArchive(ada, kilnhavenId, 'draft'));
		const cave = contents.areas.find((area) => (area.name === 'Cave'));

		assert.ok(cave);

		const cell = cave.rows[3].pop();
		const short = await importArchive(ada, kilnhavenId, await archiveOf(contents), { preview: true });

		assert.strictEqual(short.status, 400);
		assert.strictEqual(short.body.error.id, 'error.importNotAnExport');
		assert.match(short.body.error.values?.problem as string, /row -5 has 30 cells, but its bounds have 31 columns/);
		assert.ok(cell !== undefined);
		cave.rows[3].push(cell);

		// The races and classes are in files of their own, which a file with the settings must have
		const missing = await importArchive(ada, kilnhavenId, await archiveOf({ ...contents, races: undefined }), { preview: true });

		assert.strictEqual(missing.status, 400);
		assert.match(missing.body.error.values?.problem as string, /races\.json is missing/);

		// As are the live IDs, which a file of the draft must have
		const noLiveIds = await importArchive(ada, kilnhavenId, await archiveOf({ ...contents, liveIds: undefined }), { preview: true });

		assert.match(noLiveIds.body.error.values?.problem as string, /liveIds\.json is missing/);
	});

	it('refuses a file listing an area\'s file twice, two files of one area, or more areas than the site allows', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const contents = await contentsOf(await exportArchive(ada, kilnhavenId, 'draft'));
		const cave = contents.areas.find((area) => (area.name === 'Cave'));
		const cavePath = contents.areaPaths?.[contents.areas.findIndex((area) => (area.name === 'Cave'))];

		assert.ok(cave && cavePath && contents.areaPaths);

		const twice = await importArchive(ada, kilnhavenId, await archiveOf({
			...contents,
			areaPaths: [...contents.areaPaths, cavePath],
			areas: [...contents.areas, cave]
		}), { preview: true });
		const copied = await importArchive(ada, kilnhavenId, await archiveOf({
			...contents,
			areaPaths: [...contents.areaPaths, 'areas/copy.json'],
			areas: [...contents.areas, cave]
		}), { preview: true });
		// No site allows that many, so the list is refused before any area's file is read
		const pastAnySite = await importArchive(ada, kilnhavenId, await archiveOf({ ...contents, areaPaths: undefined, areas: [] }, '', {
			[UNIVERSE_EXPORT_AREAS]: JSON.stringify(Array.from({ length: (MAX_AREAS_PER_UNIVERSE + 1) }, (unused, index) => `areas/${index}.json`))
		}), { preview: true });

		assert.strictEqual(twice.status, 400);
		assert.match(twice.body.error.values?.problem as string, new RegExp(`lists ${cavePath} more than once`));
		assert.strictEqual(copied.status, 400);
		assert.match(copied.body.error.values?.problem as string, new RegExp(`areas/copy\\.json is area ${cave.id}, as another area's file is`));
		assert.strictEqual(pastAnySite.status, 400);
		assert.match(pastAnySite.body.error.values?.problem as string, new RegExp(`${UNIVERSE_EXPORT_AREAS}: .*${MAX_AREAS_PER_UNIVERSE}`));

		// The file's three areas are more than this site allows
		await saveSiteSettings({ ...DEFAULT_SITE_SETTINGS, areasPerUniverse: 2 }, adminDb);

		const pastThisSite = await importArchive(ada, kilnhavenId, await archiveOf(contents), { preview: true });

		assert.strictEqual(pastThisSite.status, 400);
		assert.strictEqual(pastThisSite.body.error.id, 'error.areaLimit');
		assert.strictEqual(pastThisSite.body.error.values?.max, 2);
	});

	it('refuses an area file larger than an import reads, or wider or with more links than an area can have', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const archive = await exportArchive(ada, kilnhavenId, 'draft');
		const contents = await contentsOf(archive);
		const caveIndex = contents.areas.findIndex((area) => (area.name === 'Cave'));
		const cave = contents.areas[caveIndex];
		const cavePath = contents.areaPaths?.[caveIndex];

		assert.ok(cave && cavePath);

		// Refused by its size, before it is parsed
		const padded = await importArchive(ada, kilnhavenId, await archiveWith(archive, {
			[cavePath]: `${JSON.stringify(cave)}${' '.repeat(MAX_UNIVERSE_IMPORT_JSON_FILE_BYTES)}`
		}), { preview: true });
		const tooWide = await importArchive(ada, kilnhavenId, await archiveWith(archive, {
			[cavePath]: JSON.stringify({ ...cave, bounds: { ...cave.bounds, minColumn: (cave.bounds.maxColumn - MAX_AREA_SIDE) } })
		}), { preview: true });
		const tooManyLinks = await importArchive(ada, kilnhavenId, await archiveWith(archive, {
			[cavePath]: JSON.stringify({ ...cave, links: new Array(MAX_AREA_LINKS + 1).fill({ column: 0, row: 0, targetAreaId: cave.id, targetColumn: 0, targetRow: 0, mode: 'manual', requiresWholeGroup: false }) })
		}), { preview: true });

		assert.strictEqual(padded.status, 400);
		assert.strictEqual(padded.body.error.id, 'error.importFileTooLarge');
		assert.deepStrictEqual(padded.body.error.values, { path: cavePath, max: (MAX_UNIVERSE_IMPORT_JSON_FILE_BYTES / (1024 * 1024)) });
		assert.strictEqual(tooWide.status, 400);
		assert.match(tooWide.body.error.values?.problem as string, new RegExp(`at most ${MAX_AREA_SIDE} cells wide`));
		assert.strictEqual(tooManyLinks.status, 400);
		assert.match(tooManyLinks.body.error.values?.problem as string, new RegExp(`links: .*${MAX_AREA_LINKS}`));
	});

	it('refuses a file whose JSON files hold more than an import reads in all', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const archive = await exportArchive(ada, kilnhavenId, 'draft');
		const contents = await contentsOf(archive);
		const [area] = contents.areas;

		assert.ok(area && contents.areaPaths);

		// Copies of an area, each padded to nearly as much as one file may hold, until they pass the total
		const copies = Math.ceil(MAX_UNIVERSE_IMPORT_JSON_BYTES / MAX_UNIVERSE_IMPORT_JSON_FILE_BYTES) + 1;
		const added: Record<string, string> = {};

		for (let index = 0; index < copies; index++)
		{
			const copy = JSON.stringify({ ...area, id: randomUUID() });

			added[`areas/copy${index}.json`] = `${copy}${' '.repeat(MAX_UNIVERSE_IMPORT_JSON_FILE_BYTES - Buffer.byteLength(copy))}`;
		}

		const refused = await importArchive(ada, kilnhavenId, await archiveWith(archive, {
			...added,
			[UNIVERSE_EXPORT_AREAS]: JSON.stringify([...contents.areaPaths, ...Object.keys(added)])
		}), { preview: true });

		assert.strictEqual(refused.status, 400);
		assert.strictEqual(refused.body.error.id, 'error.importDataTooLarge');
		assert.strictEqual(refused.body.error.values?.max, (MAX_UNIVERSE_IMPORT_JSON_BYTES / (1024 * 1024)));
	});

	it('resizes an area whose bounds and rows a file changes together', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const contents = await contentsOf(await exportArchive(ada, kilnhavenId, 'draft'));
		const cave = contents.areas.find((area) => (area.name === 'Cave'));

		assert.ok(cave);

		// One more row along the south edge, painted void
		cave.bounds.maxRow++;
		cave.rows.push(new Array<number>(cave.rows[0].length).fill(VOID_CELL));

		assert.strictEqual((await importArchive(ada, kilnhavenId, await archiveOf(contents))).status, 204);

		const resized = (await draftOf(ada, kilnhavenId)).areas.find((area) => (area.id === cave.id));

		assert.ok(resized);
		assert.deepStrictEqual(resized.bounds, cave.bounds);
		assert.deepStrictEqual(resized.rows, cave.rows);
	});

	it('reads a file whose export is all in one folder, as zipping the folder it was extracted into makes', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const contents = await contentsOf(await exportArchive(ada, kilnhavenId, 'draft'));
		const folder = 'MultiverseKiln.kilnhaven.draft.2026-11-08/';

		// macOS's metadata beside the folder doesn't count as another folder
		const zipped = await importArchive<UniverseImportPreview>(ada, kilnhavenId, await archiveOf(contents, folder, { [`__MACOSX/${folder}._universe.json`]: '' }), { preview: true });

		assert.strictEqual(zipped.status, 200, JSON.stringify(zipped.body));
		assert.strictEqual(zipped.body.counts.areas, 3);
		assert.strictEqual(zipped.body.sameUniverse, true);

		// Another folder, or a file beside the folder, leaves no one folder to look in
		const twoFolders = await importArchive(ada, kilnhavenId, await archiveOf(contents, folder, { 'Other/notes.txt': '' }), { preview: true });
		const besideIt = await importArchive(ada, kilnhavenId, await archiveOf(contents, folder, { 'notes.txt': '' }), { preview: true });

		for (const refused of [twoFolders, besideIt])
		{
			assert.strictEqual(refused.status, 400);
			assert.match(refused.body.error.values?.problem as string, /universe\.json is missing/);
		}
	});

	it('says whether the site signed a file, and whether it was changed since', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const archive = await exportArchive(ada, kilnhavenId);
		const files = await readZip(archive, 100000000);
		const manifest = JSON.parse(files.get(UNIVERSE_EXPORT_MANIFEST)?.toString('utf8') ?? '') as UniverseExport;
		const folder = 'MultiverseKiln.kilnhaven.2026-11-08/';

		/**
		 * Previews a file
		 *
		 * @param file The file
		 * @return What the preview says
		 */
		const preview = async (file: Buffer): Promise<UniverseImportPreview> =>
		{
			const answer = await importArchive<UniverseImportPreview>(ada, kilnhavenId, file, { preview: true });

			assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));

			return(answer.body);
		};

		// Extracted and zipped again, with the files operating systems add, it is still as it was exported
		const rezipped = zipArchive([
			...await Promise.all([...files].map(([path, data]) => zipFile(`${folder}${path}`, [data]))),
			await zipFile(`${folder}.DS_Store`, ['metadata']),
			await zipFile(`__MACOSX/${folder}._universe.json`, ['metadata'])
		], new Date());

		for (const file of [archive, rezipped])
		{
			const intact = await preview(file);

			assert.strictEqual(intact.signature, 'intact');
			assert.strictEqual(intact.sameUniverse, true);
		}

		// A file changed or added since keeps its signed origin
		const replacements: Record<string, string>[] = [{ [UNIVERSE_EXPORT_AREA_LEGEND]: '# Edited' }, { 'notes.txt': 'Added' }];

		for (const replaced of replacements)
		{
			const changed = await preview(await archiveWith(archive, replaced));

			assert.strictEqual(changed.signature, 'changed');
			assert.strictEqual(changed.sameUniverse, true);
		}

		// Another exporter, or no signature at all, leaves where it is from unconfirmed, which the dialog
		// says, leaving the player to decide: it is still imported as the universe it says it is of
		const forged = await archiveWith(archive, {
			[UNIVERSE_EXPORT_MANIFEST]: JSON.stringify({ ...manifest, exportedBy: { username: 'mallory', displayName: 'Mallory' } })
		});
		const unsigned = zipArchive(await Promise.all([...files]
			.filter(([path]) => (path !== UNIVERSE_EXPORT_SIGNATURE))
			.map(([path, data]) => zipFile(path, [data]))), new Date());

		for (const file of [forged, unsigned])
		{
			const unconfirmed = await preview(file);

			assert.strictEqual(unconfirmed.signature, 'unconfirmed');
			assert.strictEqual(unconfirmed.sameUniverse, true);
		}
	});
});
