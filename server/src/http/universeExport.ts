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
import { z } from 'zod';
import { canExportUniverse, cellIndexInChunk, CHUNK_SIZE, chunkCoordinate, DEFAULT_TILE_CELL, defineMessages, MAX_LOCALE_LENGTH, SOURCE_LOCALE, UNIVERSE_EXPORT_AREA_LEGEND, UNIVERSE_EXPORT_AREAS, UNIVERSE_EXPORT_CLASSES, UNIVERSE_EXPORT_FORMAT, UNIVERSE_EXPORT_FORMAT_VERSION, UNIVERSE_EXPORT_ITEMS, UNIVERSE_EXPORT_LIVE_IDS, UNIVERSE_EXPORT_MANIFEST, UNIVERSE_EXPORT_PATH, UNIVERSE_EXPORT_RACES, UNIVERSE_EXPORT_TILESETS, UNIVERSE_EXPORT_TRANSLATIONS, universeExportContents, universeExportAreaPath, universeExportFileName, universeExportTilesetPath, type EditableUniverseDetails, type EditorArea, type EditorAreaLink, type ExportedLiveIds, type ExportedTranslations, type ExportedTile, type ExportedTileGraphic, type ExportedTilesets, type UniverseExport, type UniverseExportContents, type UniverseSettings, type UniverseTextRef } from '@multiverse-kiln/shared';

import { zipArchive, zipFile, type ZipFile } from '../archives/zip.js';
import { listEditorAreas, listVersionAreaLinks, loadChunks } from '../db/areaRepo.js';
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
import { inBulkSnapshot } from '../db/transactions.js';
import { listUniverseEditors } from '../db/universeEditorRepo.js';
import { findAllDraftOrigins, type DraftOrigins } from '../db/universeDraftRepo.js';
import { findEditableUniverse } from '../db/universeRepo.js';
import { listTranslations, listTranslatorNotes } from '../db/universeTextRepo.js';
import type { UniverseVersion } from '../db/universeVersions.js';
import { emailTranslator } from '../email/emailLocales.js';
import { getObject } from '../storage/objectStorage.js';
import { findEditorAccess, requireRole, universeContextOf } from './editorAccess.js';
import { errorMessages, sendError } from './errors.js';
import { areaCellsLegend, type LegendArea } from './universeExportLegend.js';
import { signExport } from './universeExportSignature.js';

/**
 * How many tilesets' images are read from storage at once
 */
const TILESETS_AT_ONCE = 8;

/**
 * The language the legend beside the areas' cells is written in (?locale=, the page's language)
 */
const exportLocale = z.string().max(MAX_LOCALE_LENGTH).regex(/^[A-Za-z0-9-]+$/);

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
	 * The races, classes, items, areas, translations and live IDs, ready for the archive
	 */
	files: ZipFile[];

	/**
	 * The uploaded tilesets and the tiles, when the export holds the world, written once the tilesets'
	 * images are read, since a tileset whose image storage no longer has has no file
	 */
	tilesets: ExportedTilesets | undefined;

	/**
	 * The areas, and their files' paths, for the legend
	 */
	legendAreas: LegendArea[];

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
		const snapshot = await inBulkSnapshot((executor) => readExport(version, playerId, exportedAt, executor));

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

		const images = await readTilesets(snapshot);
		const { manifest } = snapshot;
		const manifestFile = await zipFile(UNIVERSE_EXPORT_MANIFEST, [jsonText(manifest)]);
		const tilesetsFile = ((snapshot.tilesets === undefined) ? [] : [await zipFile(UNIVERSE_EXPORT_TILESETS, [jsonText(snapshot.tilesets)])]);
		const locale = exportLocale.safeParse(request.query.locale);
		const legend = await legendFiles(snapshot, (locale.success ? locale.data : SOURCE_LOCALE));
		const files = [manifestFile, ...tilesetsFile, ...snapshot.files, ...legend, ...images];

		response.attachment(universeExportFileName(universe.name, universe.version, exportedAt));
		response.send(zipArchive([...files, await signExport(manifest, files)], exportedAt));
	}
	finally
	{
		exporting.delete(playerId);
	}
}

/**
 * The legend beside an export's areas' files, for an export holding the world
 *
 * @param snapshot The export
 * @param locale The language the player exporting reads, by tag
 * @return The legend, ready for the archive, or nothing for an export without areas
 */
async function legendFiles(snapshot: ExportSnapshot, locale: string): Promise<ZipFile[]>
{
	const { manifest: { universe }, tilesets } = snapshot;

	if (tilesets === undefined)
	{
		return([]);
	}

	return([await zipFile(UNIVERSE_EXPORT_AREA_LEGEND, [areaCellsLegend(universe.name, universe.ruleset, tilesets.tiles, snapshot.legendAreas, emailTranslator(locale))])]);
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
		files: [],
		tilesets: undefined,
		legendAreas: [],
		tilesetKeys: new Map()
	};

	if (contents.settings)
	{
		await readSettings(snapshot, universe, version, executor);
	}

	if (contents.world)
	{
		await readWorld(snapshot, universe, version, executor);
	}

	await readText(snapshot, contents, version, executor);

	if (version.draft)
	{
		snapshot.files.push(await zipFile(UNIVERSE_EXPORT_LIVE_IDS, [jsonText(liveIdsOf(await findAllDraftOrigins(version.universeId, executor)))]));
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
 * Ruleset tab's settings and difficulty levels, themes and editors, and the races and classes in files
 * of their own
 *
 * @param snapshot The export
 * @param universe The universe, in the version exported
 * @param version The version
 * @param executor The snapshot
 */
async function readSettings(snapshot: ExportSnapshot, universe: EditableUniverseDetails, version: UniverseVersion, executor: Executor): Promise<void>
{
	const { manifest } = snapshot;
	const { ruleset } = universe;

	manifest.settings = universeSettingsOf(universe);
	manifest.rulesetSettings = await loadRulesetSettings(version, ruleset, executor);
	manifest.difficultyLevels = await listDifficultyLevels(version, executor);
	snapshot.files.push(await zipFile(UNIVERSE_EXPORT_RACES, [jsonText(await loadEditorRaces(version, ruleset, executor))]));
	snapshot.files.push(await zipFile(UNIVERSE_EXPORT_CLASSES, [jsonText(await loadEditorClasses(version, ruleset, executor))]));
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
		requireBuilderDraft: universe.requireBuilderDraft,
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
 * Reads the world into an export: the uploaded tilesets with the tiles, the items, and each area with its
 * links and cells, in files of their own
 *
 * @param snapshot The export
 * @param universe The universe, in the version exported
 * @param version The version
 * @param executor The snapshot
 */
async function readWorld(snapshot: ExportSnapshot, universe: EditableUniverseDetails, version: UniverseVersion, executor: Executor): Promise<void>
{
	const { ruleset } = universe;
	const graphics = await listTileGraphicFiles(version, executor);
	const links = await listVersionAreaLinks(version, executor);

	const tileGraphics = graphics.map(({ id, name, format, drawOrder, storageKey }): ExportedTileGraphic =>
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
	const tiles = (await loadEditorTiles(version, ruleset, executor)).map((tile): ExportedTile => ({
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

	snapshot.tilesets = {
		tileGraphics,
		tiles
	};
	snapshot.files.push(await zipFile(UNIVERSE_EXPORT_ITEMS, [jsonText(await loadEditorItems(version, ruleset, executor))]));

	const areas = await listEditorAreas(version, executor);

	snapshot.files.push(await zipFile(UNIVERSE_EXPORT_AREAS, [jsonText(areas.map((area) => universeExportAreaPath(area.id)))]));

	for (const area of areas)
	{
		const file = universeExportAreaPath(area.id);
		const areaLinks: EditorAreaLink[] = links
			.filter((link) => (link.areaId === area.id))
			.map(({ column, row, targetAreaId, targetColumn, targetRow, mode, requiresWholeGroup }) => ({
				column,
				row,
				targetAreaId,
				targetColumn,
				targetRow,
				mode,
				requiresWholeGroup
			}));

		snapshot.legendAreas.push({ ...area, file });
		snapshot.files.push(await zipFile(file, areaPieces(area, areaLinks, executor)));
	}
}

/**
 * JSON written as the export's files are: indented with tabs, ending with a line break
 *
 * @param value What to write
 * @return The JSON
 */
function jsonText(value: unknown): string
{
	return(`${JSON.stringify(value, null, '\t')}\n`);
}

/**
 * An area's file, an ExportedArea in JSON: its settings and links, then its rows of cells from north to
 * south, each from west to east, built from one band of stored chunks at a time so a large area is never
 * held whole. Indented with tabs like the manifest, with each row on one line of its own
 *
 * @param area The area
 * @param links The links on its cells
 * @param executor The snapshot
 * @return The JSON, in pieces
 */
async function* areaPieces(area: EditorArea, links: EditorAreaLink[], executor: Executor): AsyncGenerator<string>
{
	const { minColumn, minRow, maxColumn, maxRow } = area.bounds;
	let first = true;

	yield areaFileStart(area, links);

	for (let chunkRow = chunkCoordinate(minRow); chunkRow <= chunkCoordinate(maxRow); chunkRow++)
	{
		const chunks = new Map((await loadChunks(area.id, {
			minChunkColumn: chunkCoordinate(minColumn),
			minChunkRow: chunkRow,
			maxChunkColumn: chunkCoordinate(maxColumn),
			maxChunkRow: chunkRow
		}, executor)).map((chunk) => [chunk.chunkColumn, chunk.cells]));
		const rows: number[][] = [];

		for (let row = Math.max(minRow, (chunkRow * CHUNK_SIZE)); row <= Math.min(maxRow, ((chunkRow * CHUNK_SIZE) + CHUNK_SIZE - 1)); row++)
		{
			const cells: number[] = [];

			for (let column = minColumn; column <= maxColumn; column++)
			{
				cells.push(chunks.get(chunkCoordinate(column))?.[cellIndexInChunk(column, row)] ?? DEFAULT_TILE_CELL);
			}

			rows.push(cells);
		}

		yield areaRowsText(rows, first);
		first = false;
	}

	yield AREA_FILE_END;
}

/**
 * The end of an area's file, after its rows
 */
export const AREA_FILE_END = '\n\t]\n}\n';

/**
 * The start of an area's file, up to where its rows begin: its settings and links
 *
 * @param area The area
 * @param links The links on its cells
 * @return The JSON
 */
export function areaFileStart(area: EditorArea, links: EditorAreaLink[]): string
{
	const settings = JSON.stringify({ ...area, links }, null, '\t');

	// The settings' closing brace makes way for the rows
	return(`${settings.slice(0, settings.lastIndexOf('\n}'))},\n\t"rows": [`);
}

/**
 * Rows of an area's cells as its file writes them, each on a line of its own
 *
 * @param rows The rows, each its cells from west to east
 * @param first Whether they are the area's first rows, which nothing comes before
 * @return The JSON
 */
export function areaRowsText(rows: readonly (readonly number[])[], first: boolean): string
{
	const lines = rows.map((cells) => `[${cells.join(',')}]`);

	return(`${(first ? '' : ',')}\n\t\t${lines.join(',\n\t\t')}`);
}

/**
 * Reads the universe text's notes for translators, needs-no-translation marks and translations into a
 * file of their own, as far as the export's contents hold them, leaving the file out when they hold none
 *
 * @param snapshot The export
 * @param contents What the export holds
 * @param version The version
 * @param executor The snapshot
 */
async function readText(snapshot: ExportSnapshot, contents: UniverseExportContents, version: UniverseVersion, executor: Executor): Promise<void>
{
	const notes = ((contents.world || contents.noTranslation) ? (await listTranslatorNotes(version, executor)).sort(compareTextRefs) : []);
	const text: ExportedTranslations = {};

	if (contents.world)
	{
		text.translatorNotes = notes.flatMap(({ kind, thingId, field, note }) => ((note === null) ? [] : [{ kind, thingId, field, note }]));
	}

	if (contents.noTranslation)
	{
		text.noTranslation = notes
			.filter((note) => note.noTranslation)
			.map(({ kind, thingId, field }) => ({ kind, thingId, field }));
	}

	if (contents.translationLanguages !== undefined)
	{
		text.languages = contents.translationLanguages;
		text.translations = (await listTranslations(version, contents.translationLanguages, executor))
			.sort((a, b) => (compareTextRefs(a, b) || compareText(a.language, b.language)))
			.map(({ kind, thingId, field, language, text: translation, sourceHash }) => ({ kind, thingId, field, language, text: translation, sourceHash }));
	}

	if (Object.keys(text).length > 0)
	{
		snapshot.files.push(await zipFile(UNIVERSE_EXPORT_TRANSLATIONS, [jsonText(text)]));
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
	const graphics = (snapshot.tilesets?.tileGraphics ?? []);
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
