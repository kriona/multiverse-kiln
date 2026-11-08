import assert from 'assert';
import { EDITOR_UNIVERSES_PATH, emptyMoney, NEW_PF1E_RACE_RULES, sourceTextHash, UNIVERSE_EXPORT_MANIFEST, UNIVERSE_EXPORT_PATH, UNIVERSE_IMPORT_PATH, UNIVERSE_IMPORT_PREVIEW_PATH, UNIVERSE_IMPORT_RIGHTS_PARAM, VOID_CELL, type EditableUniverse, type EditorChange, type ErrorPayload, type ExportedAreaCells, type TileSettings, type UniverseExport, type UniverseImportPreview } from '@multiverse-kiln/shared';

import { readZip, zipArchive, zipFile } from '../src/archives/zip.js';
import { listUniverseEdits } from '../src/db/universeEditRepo.js';
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
 * What an archive's files hold: its manifest, and each area's cells by the area's ID
 *
 * @param archive The archive
 * @return The manifest and the cells
 */
async function contentsOf(archive: Buffer): Promise<{ manifest: UniverseExport; cells: Map<string, ExportedAreaCells> }>
{
	const files = await readZip(archive, 100000000);
	const manifest = JSON.parse(files.get(UNIVERSE_EXPORT_MANIFEST)?.toString('utf8') ?? '') as UniverseExport;
	const cells = new Map((manifest.areas ?? []).map((area) => [area.id, JSON.parse(files.get(area.file)?.toString('utf8') ?? '') as ExportedAreaCells]));

	return({ manifest, cells });
}

/**
 * The universe's draft, as its export holds it
 *
 * @param editor The browser asking
 * @param universeId The universe's ID
 * @return The draft's manifest and cells
 */
async function draftOf(editor: Editor, universeId: string): Promise<{ manifest: UniverseExport; cells: Map<string, ExportedAreaCells> }>
{
	return(contentsOf(await exportArchive(editor, universeId, 'draft')));
}

/**
 * Sends a file to the import routes, as Import Universe does
 *
 * @param editor The browser sending it
 * @param universeId The universe's ID
 * @param archive The file
 * @param options Whether to only preview it, whether to send it to the live version, and whether the
 * player confirms their rights to its tilesets
 * @return The status and the answer
 */
async function importArchive<T = ErrorPayload>(editor: Editor, universeId: string, archive: Buffer, options: { preview?: boolean; live?: boolean; rights?: boolean } = {}): Promise<{ status: number; body: T }>
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
			'Content-Type': 'application/zip'
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
 * The cell an area's cells hold at a column and row
 *
 * @param cells The area's cells
 * @param column The column
 * @param row The row
 * @return The cell's value, 0 for the default tile
 */
function cellAt(cells: ExportedAreaCells | undefined, column: number, row: number): number
{
	const chunk = cells?.chunks.find((each) => ((each.chunkColumn === Math.floor(column / 32)) && (each.chunkRow === Math.floor(row / 32))));

	return(chunk?.cells[(((row % 32) + 32) % 32) * 32 + (((column % 32) + 32) % 32)] ?? 0);
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

	it('imports another universe\'s export into a draft, which applies to the live version', async () =>
	{
		const archive = await exportArchive(ada, kilnhavenId);
		const otherId = await createUniverse(ada, 'Otherhaven');

		await saveAll(ada, otherId, [
			{ kind: 'createArea', ref: 'new:swamp', area: { name: 'Swamp' } },
			{ kind: 'startDraft' }
		]);

		const preview = await importArchive<UniverseImportPreview>(ada, otherId, archive, { preview: true });

		assert.strictEqual(preview.status, 200, JSON.stringify(preview.body));
		assert.strictEqual(preview.body.sameUniverse, false);
		assert.deepStrictEqual(preview.body.parts, ['settings', 'world', 'noTranslation', 'translations']);
		assert.strictEqual(preview.body.counts.areas, 3);
		assert.strictEqual(preview.body.tilesetUploads, 1);
		assert.deepStrictEqual(preview.body.translationLanguages, ['fr']);

		// Kilnhaven's name is taken, by Kilnhaven
		assert.deepStrictEqual(preview.body.leftOut, ['universeOnly', 'nameTaken']);

		const imported = await importArchive(ada, otherId, archive);

		assert.strictEqual(imported.status, 204, JSON.stringify(imported.body));

		const { manifest, cells } = await draftOf(ada, otherId);
		const cave = manifest.areas?.find((area) => (area.name === 'Cave'));
		const lobby = manifest.areas?.find((area) => (area.name === 'Lobby'));
		const tile = manifest.tiles?.find((each) => (each.name === 'Moss'));
		const lantern = manifest.items?.find((item) => (item.name === 'Lantern'));
		const race = manifest.races?.find((each) => (each.name === 'Molefolk'));

		assert.deepStrictEqual(manifest.areas?.map((area) => area.name), ['Cave', 'Lobby', 'Starting Area']);
		assert.ok(cave && lobby && tile && lantern && race);
		assert.strictEqual(manifest.settings?.name, 'Otherhaven');
		assert.strictEqual(manifest.settings?.longDescription, 'A small town.');
		assert.strictEqual(manifest.settings?.lobbyAreaId, lobby.id);
		assert.strictEqual(cellAt(cells.get(cave.id), 0, 0), tile.id);
		assert.strictEqual(cellAt(cells.get(cave.id), 12, -3), VOID_CELL);
		assert.strictEqual(manifest.tileGraphics?.length, 1);
		assert.strictEqual(tile.uploadedGraphicId, manifest.tileGraphics?.[0]?.id);
		assert.deepStrictEqual(lobby.links.map((link) => [link.column, link.row, link.targetAreaId, link.requiresWholeGroup]), [[1, 0, cave.id, true]]);
		assert.deepStrictEqual(race.startingItems, [{ itemId: lantern.id, quantity: 2 }]);
		assert.strictEqual(race.startingAreaId, cave.id);
		assert.deepStrictEqual(manifest.translatorNotes, [{ kind: 'area', thingId: cave.id, field: 'name', note: 'A dark place' }]);
		assert.deepStrictEqual(manifest.noTranslation, [{ kind: 'universe', thingId: otherId, field: 'name' }]);
		assert.deepStrictEqual(manifest.translations?.entries.map((entry) => [entry.thingId, entry.text]), [[cave.id, 'Grotte']]);

		// The draft reaches the live version only once it is applied
		const live = await contentsOf(await exportArchive(ada, otherId));

		assert.deepStrictEqual(live.manifest.areas?.map((area) => area.name), ['Lobby', 'Starting Area', 'Swamp']);

		await saveAll(ada, otherId, [{ kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } }]);

		const applied = await contentsOf(await exportArchive(ada, otherId));

		assert.deepStrictEqual(applied.manifest.areas?.map((area) => area.name), ['Cave', 'Lobby', 'Starting Area']);
		assert.ok(applied.manifest.races?.some((each) => (each.name === 'Molefolk')));

		// The import is recorded as a save to the draft
		const edits = await listUniverseEdits(otherId, { offset: 0, limit: 10 });

		assert.ok(edits.edits.some((edit) => (edit.draft && (edit.changeDetails?.some((change) => ((change.subject === 'area') && (change.action === 'added'))) ?? false))));
	});

	it('puts the same universe\'s draft back as it was exported, keeping its things\' places', async () =>
	{
		await saveAll(ada, kilnhavenId, [{ kind: 'startDraft' }]);

		const before = await draftOf(ada, kilnhavenId);
		const archive = await exportArchive(ada, kilnhavenId, 'draft');
		const draftCave = before.manifest.areas?.find((area) => (area.name === 'Cave'));
		const draftMoss = before.manifest.tiles?.find((tile) => (tile.name === 'Moss'));

		assert.ok(draftCave && draftMoss);

		// Changes to the draft after the export, which the import takes back
		await saveToDraft(ada, kilnhavenId, [
			{ kind: 'updateArea', areaId: draftCave.id, update: { name: 'Grotto' } },
			{ kind: 'editCells', areaId: draftCave.id, changes: [[0, 0, VOID_CELL], [3, 3, VOID_CELL]] },
			{ kind: 'createArea', ref: 'new:swamp', area: { name: 'Swamp' } }
		]);

		const imported = await importArchive(ada, kilnhavenId, archive);

		assert.strictEqual(imported.status, 204, JSON.stringify(imported.body));

		const after = await draftOf(ada, kilnhavenId);
		const cave = after.manifest.areas?.find((area) => (area.id === draftCave.id));

		assert.deepStrictEqual(after.manifest.areas?.map((area) => area.name), ['Cave', 'Lobby', 'Starting Area']);
		assert.ok(cave);
		assert.strictEqual(cellAt(after.cells.get(cave.id), 0, 0), draftMoss.id);
		assert.strictEqual(cellAt(after.cells.get(cave.id), 3, 3), 0);
		assert.strictEqual(cellAt(after.cells.get(cave.id), 12, -3), VOID_CELL);
		assert.deepStrictEqual(after.manifest.tiles?.find((tile) => (tile.name === 'Moss'))?.id, draftMoss.id);
		assert.strictEqual(after.manifest.tileGraphics?.length, 1);

		// Once applied, the live version's cave and race are the ones it had
		const liveBefore = await contentsOf(await exportArchive(ada, kilnhavenId));

		await saveAll(ada, kilnhavenId, [{ kind: 'applyDraft', choices: { races: {}, classes: {}, items: {}, areas: {} } }]);

		const liveAfter = await contentsOf(await exportArchive(ada, kilnhavenId));

		assert.deepStrictEqual(liveAfter.manifest.areas?.map((area) => area.id).sort(), liveBefore.manifest.areas?.map((area) => area.id).sort());
		assert.strictEqual(liveAfter.manifest.races?.find((race) => (race.name === 'Molefolk'))?.id, liveBefore.manifest.races?.find((race) => (race.name === 'Molefolk'))?.id);
		assert.ok(liveAfter.manifest.areas?.some((area) => (area.id === caveId)));
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
		const { manifest: draft } = await draftOf(ada, kilnhavenId);
		const draftCave = draft.areas?.find((area) => (area.name === 'Cave'));

		assert.ok(draftCave);

		await saveToDraft(ada, kilnhavenId, [
			{ kind: 'saveTranslation', text: { kind: 'area', thingId: draftCave.id, field: 'name' }, language: 'fr', translation: 'Caverne', sourceHash: sourceTextHash('Cave') },
			{ kind: 'updateArea', areaId: draftCave.id, update: { enabled: false } }
		]);
		assert.strictEqual((await importArchive(cy, kilnhavenId, archive)).status, 204);

		const { manifest: after } = await draftOf(ada, kilnhavenId);

		assert.deepStrictEqual(after.translations?.entries.map((entry) => entry.text), ['Grotte']);
		assert.strictEqual(after.areas?.find((area) => (area.id === draftCave.id))?.enabled, false);
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

	it('refuses a file whose content a save wouldn\'t take, saving none of it', async () =>
	{
		const { manifest, cells } = await contentsOf(await exportArchive(ada, kilnhavenId));
		const otherId = await createUniverse(ada, 'Otherhaven');
		const cave = manifest.areas?.find((area) => (area.name === 'Cave'));

		assert.ok(cave);
		cave.name = '';

		const archive = zipArchive([
			await zipFile(UNIVERSE_EXPORT_MANIFEST, [JSON.stringify(manifest)]),
			...await Promise.all([...cells].map(([areaId, areaCells]) => zipFile(`areas/${areaId}.json`, [JSON.stringify(areaCells)])))
		], new Date());

		await saveAll(ada, otherId, [{ kind: 'startDraft' }]);

		const refused = await importArchive(ada, otherId, archive);

		assert.strictEqual(refused.status, 400);
		assert.strictEqual(refused.body.error.id, 'error.importNotAnExport');
		assert.deepStrictEqual((await draftOf(ada, otherId)).manifest.areas?.map((area) => area.name), ['Lobby', 'Starting Area']);
	});
});
