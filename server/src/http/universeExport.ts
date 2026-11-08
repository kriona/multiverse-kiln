/**
 * Exporting a universe (see Exporting a universe in STRUCTURE-OVERVIEW.md): GET
 * EDITOR_UNIVERSES_PATH/:universeId/export answers a zip archive of what the player's role may change in
 * the version the request names, as shared/src/universeExport.ts lays it out
 *
 * Everything is read in one read-only snapshot, so the archive fits together while others save, and the
 * archive is made in memory before it is sent, so the snapshot's connection isn't held while a slow
 * browser downloads it. Areas' cells are deflated a page of chunks at a time as they are read
 */
import type { Request, Response, Router } from 'express';
import { canExportUniverse, CHUNK_SIZE, defineMessages, UNIVERSE_EXPORT_FORMAT, UNIVERSE_EXPORT_FORMAT_VERSION, UNIVERSE_EXPORT_MANIFEST, UNIVERSE_EXPORT_PATH, universeExportContents, universeExportAreaPath, universeExportFileName, universeExportTilesetPath, type AreaChunk, type EditableUniverseDetails, type ExportedArea, type ExportedLiveIds, type ExportedTileGraphic, type UniverseExport, type UniverseExportContents, type UniverseSettings, type UniverseTextRef } from '@multiverse-kiln/shared';

import { zipArchive, zipFile, type ZipFile } from '../archives/zip.js';
import { listEditorAreas, listVersionAreaLinks, loadChunkPage } from '../db/areaRepo.js';
import { loadEditorClasses } from '../db/classRepo.js';
import type { Executor } from '../db/client.js';
import { listDifficultyLevels } from '../db/difficultyRepo.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { findPlayer } from '../db/playerRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { loadRulesetSettings } from '../db/rulesetRepo.js';
import { loadEditorThemes } from '../db/themeRepo.js';
import { listTileGraphicFiles } from '../db/tileGraphicRepo.js';
import { loadEditorTiles } from '../db/tileRepo.js';
import { inSnapshot } from '../db/transactions.js';
import { listUniverseEditors } from '../db/universeEditorRepo.js';
import { findAllDraftOrigins, type DraftOrigins } from '../db/universeDraftRepo.js';
import { findEditableUniverse } from '../db/universeRepo.js';
import { listTranslations, listTranslatorNotes } from '../db/universeTextRepo.js';
import type { UniverseVersion } from '../db/universeVersions.js';
import { getObject } from '../storage/objectStorage.js';
import { findEditorAccess, requireRole, universeContextOf } from './editorAccess.js';
import { errorMessages, sendError } from './errors.js';

/**
 * How many chunks of an area are read, and deflated, at once
 */
const CHUNKS_PER_PAGE = 500;

/**
 * How many tilesets' images are read from storage at once
 */
const TILESETS_AT_ONCE = 8;

/**
 * The players an export is being made for, each of whom has one made at a time, so one player can't
 * have the server read and deflate many universes at once
 */
const exporting = new Set<string>();

/**
 * Why an export wasn't made (see shared/src/localization.ts)
 */
const messages = defineMessages({
	alreadyExporting: {
		id: 'error.alreadyExporting',
		defaultMessage: 'You\'re already exporting a universe. Try again once it has downloaded.',
		description: 'Why a universe wasn\'t exported: the player is already exporting one, in this window or another, and each player exports one at a time'
	}
});

/**
 * A universe's export, made from one snapshot of it
 */
interface ExportSnapshot
{
	manifest: UniverseExport;

	/**
	 * The areas' cells, ready for the archive
	 */
	areaFiles: ZipFile[];

	/**
	 * Where each uploaded tileset's image is stored, by the tileset's ID
	 */
	tilesetKeys: Map<string, string>;
}

/**
 * Adds the route that exports a universe, for the roles that may change something in it
 *
 * @param router The router for routes under /:universeId
 */
export function addUniverseExportRoutes(router: Router): void
{
	router.get(UNIVERSE_EXPORT_PATH, requireRole(canExportUniverse), exportRoute);
}

/**
 * GET EDITOR_UNIVERSES_PATH/:universeId/export: a zip archive of what the player's role may change in
 * the version the request names. Answers 429 while the player's last export is still being made
 *
 * @param request The request
 * @param response The response: the archive, as an attachment
 */
async function exportRoute(request: Request, response: Response): Promise<void>
{
	const { playerId, universe, version } = universeContextOf(request);

	if (exporting.has(playerId))
	{
		sendError(response, 429, messages.alreadyExporting);
		return;
	}

	exporting.add(playerId);

	try
	{
		const exportedAt = new Date();
		const snapshot = await inSnapshot((executor) => readExport(version, playerId, exportedAt, executor));

		if (snapshot === 'not_found')
		{
			sendError(response, 404, errorMessages.noSuchUniverse);
			return;
		}

		if (snapshot === 'not_allowed')
		{
			sendError(response, 403, errorMessages.roleNotAllowed);
			return;
		}

		const tilesets = await readTilesets(snapshot);
		const manifest = await zipFile(UNIVERSE_EXPORT_MANIFEST, [`${JSON.stringify(snapshot.manifest, null, '\t')}\n`]);

		response.attachment(universeExportFileName(universe.name, universe.version, exportedAt));
		response.send(zipArchive([manifest, ...snapshot.areaFiles, ...tilesets], exportedAt));
	}
	finally
	{
		exporting.delete(playerId);
	}
}

/**
 * Reads what a player's role may change in a version of a universe, checking the role again in the
 * snapshot, since what the export holds follows from it
 *
 * @param version The version
 * @param playerId The player
 * @param exportedAt When the export is made
 * @param executor The snapshot
 * @return The export, not_found when the universe or the version is gone, or not_allowed when the
 * player's role no longer lets them export it
 */
async function readExport(version: UniverseVersion, playerId: string, exportedAt: Date, executor: Executor): Promise<ExportSnapshot | 'not_found' | 'not_allowed'>
{
	const universe = await findEditableUniverse(version, executor);

	if (!universe)
	{
		return('not_found');
	}

	const { access } = await findEditorAccess(version.universeId, playerId, executor);
	const player = await findPlayer(playerId, executor);

	if (!access || !canExportUniverse(access.role) || !player)
	{
		return('not_allowed');
	}

	const contents = universeExportContents(access, universe.translationLanguages);
	const snapshot: ExportSnapshot = {
		manifest: {
			format: UNIVERSE_EXPORT_FORMAT,
			formatVersion: UNIVERSE_EXPORT_FORMAT_VERSION,
			exportedAt: exportedAt.toISOString(),
			exportedBy: {
				username: player.username,
				displayName: player.displayName
			},
			role: access.role,
			universe: {
				id: universe.id,
				version: universe.version,
				name: universe.name,
				ruleset: universe.ruleset,
				sourceLanguage: universe.sourceLanguage
			}
		},
		areaFiles: [],
		tilesetKeys: new Map()
	};

	if (contents.settings)
	{
		await readSettings(snapshot.manifest, universe, version, executor);
	}

	if (contents.world)
	{
		await readWorld(snapshot, universe, version, executor);
	}

	await readText(snapshot.manifest, contents, version, executor);

	if (version.draft)
	{
		snapshot.manifest.liveIds = liveIdsOf(await findAllDraftOrigins(version.universeId, executor));
	}

	return(snapshot);
}

/**
 * A draft's live rows as an export lists them, with the draft's IDs as keys
 *
 * @param origins Each draft row's live row, by kind
 * @return The live rows, by kind
 */
function liveIdsOf(origins: DraftOrigins): ExportedLiveIds
{
	return({
		tileGraphics: Object.fromEntries(origins.tileGraphics),
		tiles: Object.fromEntries(origins.tiles),
		items: Object.fromEntries(origins.items),
		areas: Object.fromEntries(origins.areas),
		races: Object.fromEntries(origins.races),
		classes: Object.fromEntries(origins.classes),
		themes: Object.fromEntries(origins.themes),
		difficultyLevels: Object.fromEntries(origins.difficultyLevels)
	});
}

/**
 * Reads what only creators (and the site admin role) change into an export: the universe's settings, the
 * Ruleset tab's settings and difficulty levels, races, classes, themes and editors
 *
 * @param manifest The export
 * @param universe The universe, in the version exported
 * @param version The version
 * @param executor The snapshot
 */
async function readSettings(manifest: UniverseExport, universe: EditableUniverseDetails, version: UniverseVersion, executor: Executor): Promise<void>
{
	const { ruleset } = universe;

	manifest.settings = universeSettingsOf(universe);
	manifest.rulesetSettings = await loadRulesetSettings(version, ruleset, executor);
	manifest.difficultyLevels = await listDifficultyLevels(version, executor);
	manifest.races = await loadEditorRaces(version, ruleset, executor);
	manifest.classes = await loadEditorClasses(version, ruleset, executor);
	manifest.themes = await loadEditorThemes(version, ruleset, executor);
	manifest.editors = (await listUniverseEditors(universe.id, executor)).map(({ username, role, languages }) => ({
		username,
		role,
		languages
	}));
}

/**
 * The settings the Universe, Lobby, Characters and Translations tabs show
 *
 * @param universe The universe, in the version exported
 * @return Its settings
 */
function universeSettingsOf(universe: EditableUniverseDetails): UniverseSettings
{
	return({
		name: universe.name,
		shortDescription: universe.shortDescription,
		longDescription: universe.longDescription,
		sourceLanguage: universe.sourceLanguage,
		translationLanguages: universe.translationLanguages,
		stage: universe.stage,
		requireTwoFactor: universe.requireTwoFactor,
		passageOfTime: universe.passageOfTime,
		faerieMorning: universe.faerieMorning,
		displayTime: universe.displayTime,
		lobbyPassageOfTime: universe.lobbyPassageOfTime,
		lobbyDayHours: universe.lobbyDayHours,
		lobbyFaerieMorning: universe.lobbyFaerieMorning,
		lobbyNoVisionCost: universe.lobbyNoVisionCost,
		lobbyAreaId: universe.lobbyAreaId,
		lobbyColumn: universe.lobbyColumn,
		lobbyRow: universe.lobbyRow,
		groupSize: universe.groupSize,
		startingMoney: universe.startingMoney,
		coinNames: universe.coinNames,
		coinAbbreviations: universe.coinAbbreviations,
		startingItems: universe.startingItems,
		startingAreaId: universe.startingAreaId,
		startingColumn: universe.startingColumn,
		startingRow: universe.startingRow
	});
}

/**
 * Reads the world into an export: uploaded tilesets, tiles, items, and areas with their links and cells
 *
 * @param snapshot The export
 * @param universe The universe, in the version exported
 * @param version The version
 * @param executor The snapshot
 */
async function readWorld(snapshot: ExportSnapshot, universe: EditableUniverseDetails, version: UniverseVersion, executor: Executor): Promise<void>
{
	const { manifest } = snapshot;
	const { ruleset } = universe;
	const graphics = await listTileGraphicFiles(version, executor);
	const links = await listVersionAreaLinks(version, executor);
	const areas: ExportedArea[] = [];

	manifest.tileGraphics = graphics.map(({ id, name, format, drawOrder, storageKey }): ExportedTileGraphic =>
	{
		snapshot.tilesetKeys.set(id, storageKey);

		return({
			id,
			name,
			format,
			drawOrder,
			file: universeExportTilesetPath(id)
		});
	});
	manifest.tiles = (await loadEditorTiles(version, ruleset, executor)).map((tile) => ({
		id: tile.id,
		key: tile.key,
		custom: tile.custom,
		edited: tile.edited,
		name: tile.name,
		indoors: tile.indoors,
		outdoors: tile.outdoors,
		color: tile.color,
		graphic: tile.graphic,
		uploadedGraphicId: tile.uploadedGraphicId,
		visionCost: tile.visionCost,
		walkSeconds: tile.walkSeconds,
		enabled: tile.enabled
	}));
	manifest.items = await loadEditorItems(version, ruleset, executor);

	for (const area of await listEditorAreas(version, executor))
	{
		const file = universeExportAreaPath(area.id);

		areas.push({
			...area,
			links: links
				.filter((link) => (link.areaId === area.id))
				.map(({ column, row, targetAreaId, targetColumn, targetRow, mode, requiresWholeGroup }) => ({
					column,
					row,
					targetAreaId,
					targetColumn,
					targetRow,
					mode,
					requiresWholeGroup
				})),
			file
		});
		snapshot.areaFiles.push(await zipFile(file, areaCellPieces(area.id, executor)));
	}

	manifest.areas = areas;
}

/**
 * An area's cells as an ExportedAreaCells in JSON, a page of chunks at a time, indented with tabs like the
 * manifest but with each chunk on one line of its own
 *
 * @param areaId The area's ID
 * @param executor The snapshot
 * @return The JSON, in pieces
 */
async function* areaCellPieces(areaId: string, executor: Executor): AsyncGenerator<string>
{
	let after: AreaChunk | undefined;
	let separator = '';

	yield `{\n\t"chunkSize": ${CHUNK_SIZE},\n\t"chunks": [`;

	for (;;)
	{
		const page = await loadChunkPage(areaId, after, CHUNKS_PER_PAGE, executor);

		if (page.length > 0)
		{
			yield `${separator}\n\t\t${page.map((chunk) => JSON.stringify(chunk)).join(',\n\t\t')}`;
			separator = ',';
		}

		if (page.length < CHUNKS_PER_PAGE)
		{
			break;
		}

		after = page[page.length - 1];
	}

	yield `${((separator === '') ? '' : '\n\t')}]\n}\n`;
}

/**
 * Reads the universe text's notes for translators, needs-no-translation marks and translations into an
 * export, as far as its contents hold them
 *
 * @param manifest The export
 * @param contents What the export holds
 * @param version The version
 * @param executor The snapshot
 */
async function readText(manifest: UniverseExport, contents: UniverseExportContents, version: UniverseVersion, executor: Executor): Promise<void>
{
	const notes = ((contents.world || contents.noTranslation) ? (await listTranslatorNotes(version, executor)).sort(compareTextRefs) : []);

	if (contents.world)
	{
		manifest.translatorNotes = notes.flatMap(({ kind, thingId, field, note }) => ((note === null) ? [] : [{ kind, thingId, field, note }]));
	}

	if (contents.noTranslation)
	{
		manifest.noTranslation = notes
			.filter((note) => note.noTranslation)
			.map(({ kind, thingId, field }) => ({ kind, thingId, field }));
	}

	if (contents.translationLanguages !== undefined)
	{
		const translations = await listTranslations(version, contents.translationLanguages, executor);

		manifest.translations = {
			languages: contents.translationLanguages,
			entries: translations
				.sort((a, b) => (compareTextRefs(a, b) || compareText(a.language, b.language)))
				.map(({ kind, thingId, field, language, text, sourceHash }) => ({ kind, thingId, field, language, text, sourceHash }))
		};
	}
}

/**
 * Orders pieces of universe text by what they belong to, so an export lists them the same way each time
 *
 * @param a One piece
 * @param b The other
 * @return Negative when a comes first, positive when b does, 0 for the same piece
 */
function compareTextRefs(a: UniverseTextRef, b: UniverseTextRef): number
{
	return((compareText(a.kind, b.kind) || compareText(a.thingId, b.thingId) || compareText(a.field, b.field)));
}

/**
 * Orders two strings by their code units, the same in every language
 *
 * @param a One string
 * @param b The other
 * @return Negative when a comes first, positive when b does, 0 when they are the same
 */
function compareText(a: string, b: string): number
{
	return(((a < b) ? -1 : ((a > b) ? 1 : 0)));
}

/**
 * Reads the images of an export's uploaded tilesets from storage, a few at a time. An image storage no
 * longer has is left out, and its tileset's file is null
 *
 * @param snapshot The export
 * @return The images, ready for the archive, in the order the export lists the tilesets
 */
async function readTilesets(snapshot: ExportSnapshot): Promise<ZipFile[]>
{
	const graphics = (snapshot.manifest.tileGraphics ?? []);
	const files: ZipFile[] = [];

	for (let start = 0; start < graphics.length; start += TILESETS_AT_ONCE)
	{
		const batch = graphics.slice(start, (start + TILESETS_AT_ONCE));
		const images = await Promise.all(batch.map((graphic) => getObject(snapshot.tilesetKeys.get(graphic.id) ?? '')));

		for (const [index, graphic] of batch.entries())
		{
			const image = images[index];

			if ((image === undefined) || (graphic.file === null))
			{
				graphic.file = null;
				continue;
			}

			// PNGs are compressed already
			files.push(await zipFile(graphic.file, [image], false));
		}
	}

	return(files);
}
