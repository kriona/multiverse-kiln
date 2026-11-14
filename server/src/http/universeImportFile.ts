/**
 * Reading a universe's export for importing it (see Importing a universe in STRUCTURE-OVERVIEW.md): the
 * zip archive, its UniverseExport, races, classes, tilesets, items, areas, translations and live IDs, checked for the shape
 * shared/src/universeExport.ts gives them, with what the site's signature says of it
 * (universeExportSignature.ts). What the things' settings hold is checked later, by the
 * validators a save's changes go through (editorChange in editorPayloads.ts), as the import makes its
 * changes from them
 */
import { cellIndexInChunk, CHUNK_SIZE, chunkCoordinate, chunkKey, DEFAULT_TILE_CELL, defineMessages, EDITOR_ROLES, MAX_AREA_LINKS, MAX_AREA_SIDE, MAX_AREAS_PER_UNIVERSE, MAX_UNIVERSE_IMPORT_CONTENT_BYTES, MAX_UNIVERSE_IMPORT_JSON_BYTES, MAX_UNIVERSE_IMPORT_JSON_FILE_BYTES, MAX_UPLOADED_TILE_GRAPHICS, MAX_PLACE_PARENTS, RULESETS, TILE_GRAPHIC_FORMATS, AREA_LINK_MODES, UNIVERSE_EXPORT_AREAS, UNIVERSE_EXPORT_REGIONS, UNIVERSE_EXPORT_CLASSES, UNIVERSE_EXPORT_FORMAT, UNIVERSE_EXPORT_FORMAT_VERSION, UNIVERSE_EXPORT_ITEMS, UNIVERSE_EXPORT_LIVE_IDS, UNIVERSE_EXPORT_MANIFEST, UNIVERSE_EXPORT_RACES, UNIVERSE_EXPORT_TILESETS, UNIVERSE_EXPORT_TRANSLATIONS, UNIVERSE_TEXT_FIELDS, UNIVERSE_TEXT_KINDS, UNIVERSE_VERSIONS, type AreaBounds, type MessageDescriptor, type MessageValues, type UniverseImportSignature } from '@multiverse-kiln/shared';
import { setImmediate as yieldToEventLoop } from 'timers/promises';
import { z } from 'zod';

import { readZip, ZipError } from '../archives/zip.js';
import { describeInvalidPayload } from '../rooms/payloads.js';
import { errorMessages } from './errors.js';
import { checkExportSignature, MACOS_METADATA_FOLDER } from './universeExportSignature.js';

/**
 * Why a file can't be imported (see shared/src/localization.ts)
 */
export const importMessages = defineMessages({
	notAnExport: {
		id: 'error.importNotAnExport',
		defaultMessage: 'This file isn\'t a universe export, or it\'s damaged ({problem}).',
		description: 'Why a file couldn\'t be imported into a universe\'s draft: it isn\'t a zip file Export Universe made, or it was changed or damaged since; {problem} is a technical description in English'
	},
	newerFormat: {
		id: 'error.importNewerFormat',
		defaultMessage: 'This file was exported by a newer version of the editor, so it can\'t be imported here.',
		description: 'Why a file couldn\'t be imported into a universe\'s draft: it was made by a later version of the site\'s software, in a format this one can\'t read'
	},
	otherRuleset: {
		id: 'error.importOtherRuleset',
		defaultMessage: 'This file is of a universe with a different ruleset, so it can\'t be imported into this one.',
		description: 'Why a file couldn\'t be imported into a universe\'s draft: the universe it was exported from plays Pathfinder and this one Starfinder, or the other way round'
	},
	fileTooLarge: {
		id: 'error.importFileTooLarge',
		defaultMessage: 'This file can\'t be imported: {path} in it holds more than {max, number} MB, the most one of its files can.',
		description: 'Why a file couldn\'t be imported into a universe\'s draft: one of the files inside the zip file, such as a very large area\'s, is too big; {path} is that file\'s path inside the zip file, such as areas/1234.json, and {max} is the most it can hold, in megabytes'
	},
	dataTooLarge: {
		id: 'error.importDataTooLarge',
		defaultMessage: 'This file can\'t be imported: its areas and settings hold more than {max, number} MB in all.',
		description: 'Why a file couldn\'t be imported into a universe\'s draft: the files inside the zip file describing the universe (its areas, settings and so on, apart from its tilesets\' images) are too big in all; {max} is the most they can hold, in megabytes'
	}
});

/**
 * How much more JSON the archive's files may hold, from MAX_UNIVERSE_IMPORT_JSON_BYTES
 */
interface JsonBudget
{
	remaining: number;
}

/**
 * Why a file can't be imported: the message, and its values
 */
export class ImportProblem extends Error
{
	/**
	 * @param reason Why
	 * @param values The message's arguments' values
	 */
	constructor(readonly reason: MessageDescriptor, readonly values?: MessageValues)
	{
		super(reason.id);
		this.name = 'ImportProblem';
	}
}

/**
 * A numeric ID, as a tile's, item's, race's, class's, theme's or difficulty level's
 */
const numericId = z.number().int().min(1).max(2147483647);

/**
 * A cell's column or row
 */
const cellCoordinate = z.number().int().min(-MAX_AREA_SIDE).max(MAX_AREA_SIDE);

/**
 * A thing the universe can use that may be one of the ruleset's defaults: its ID, a default's key, and
 * whether the universe edited it, with the rest of its settings as they are
 */
const exportedOption = z.looseObject({
	id: numericId,
	key: z.string().min(1).max(64).nullable(),
	edited: z.boolean()
});

/**
 * A piece of universe text
 */
const textRef = z.object({
	kind: z.enum(UNIVERSE_TEXT_KINDS),
	thingId: z.string().min(1).max(64),
	field: z.enum(UNIVERSE_TEXT_FIELDS)
});

/**
 * An export's IDs written as JSON object keys, and the IDs they map to
 *
 * @param id The IDs' validator
 * @return The validator
 */
function idRecord<T extends z.ZodType>(id: T)
{
	return(z.record(z.string().max(64), id));
}

/**
 * The parts of a UniverseExport an import reads
 */
const universeExport = z.object({
	format: z.literal(UNIVERSE_EXPORT_FORMAT),
	formatVersion: z.number().int().min(1),
	exportedAt: z.string().max(64),
	exportedBy: z.object({
		username: z.string().max(200),
		displayName: z.string().max(200)
	}),
	role: z.enum(EDITOR_ROLES),
	universe: z.object({
		id: z.uuid(),
		version: z.enum(UNIVERSE_VERSIONS),
		name: z.string().max(200),
		ruleset: z.enum(RULESETS),
		sourceLanguage: z.string().max(64)
	}),
	settings: z.looseObject({}).optional(),
	rulesetSettings: z.unknown().optional(),
	difficultyLevels: z.array(z.looseObject({
		id: numericId,
		key: z.string().min(1).max(64).nullable(),
		isDefault: z.boolean()
	})).optional(),
	themes: z.array(exportedOption).optional(),
	editors: z.array(z.unknown()).optional()
});

/**
 * The archive's list of the areas' files. An export is of one version, which holds no more areas than its
 * site allows, and no site allows more than MAX_AREAS_PER_UNIVERSE
 */
const areaPaths = z.array(z.string().max(200)).max(MAX_AREAS_PER_UNIVERSE);

/**
 * The archive's live IDs, an ExportedLiveIds
 */
const exportedLiveIds = z.object({
	tileGraphics: idRecord(z.uuid()),
	tiles: idRecord(numericId),
	items: idRecord(numericId),
	regions: idRecord(z.uuid()),
	areas: idRecord(z.uuid()),
	races: idRecord(numericId),
	classes: idRecord(numericId),
	themes: idRecord(numericId),
	difficultyLevels: idRecord(numericId)
}).partial();

/**
 * The archive's races, classes or items
 */
const exportedOptions = z.array(exportedOption);

/**
 * The archive's uploaded tilesets and tiles, an ExportedTilesets. An export is of one version, which holds
 * at most MAX_UPLOADED_TILE_GRAPHICS tilesets
 */
const exportedTilesets = z.object({
	tileGraphics: z.array(z.object({
		id: z.uuid(),
		name: z.string(),
		format: z.enum(TILE_GRAPHIC_FORMATS),
		drawOrder: z.number().int().nullable(),
		file: z.string().max(200).nullable()
	})).max(MAX_UPLOADED_TILE_GRAPHICS),
	tiles: exportedOptions
});

/**
 * The archive's notes for translators, needs-no-translation marks and translations, an
 * ExportedTranslations
 */
const exportedTranslations = z.object({
	translatorNotes: z.array(textRef.extend({ note: z.string() })).optional(),
	noTranslation: z.array(textRef).optional(),
	languages: z.array(z.string().max(64)).optional(),
	translations: z.array(textRef.extend({
		language: z.string().max(64),
		text: z.string(),
		sourceHash: z.string()
	})).optional()
});

/**
 * A region's or area's parents, by their IDs in the file
 */
const importParents = z.array(z.object({
	kind: z.enum(['region', 'area']),
	id: z.uuid()
})).max(MAX_PLACE_PARENTS);

/**
 * A region, as the archive's regions file has it
 */
const importRegion = z.looseObject({
	id: z.uuid(),
	name: z.string(),
	parents: importParents,
	defaultTileId: numericId.nullable()
});

/**
 * The archive's regions. An export holds no more regions than areas
 */
const importRegions = z.array(importRegion).max(MAX_AREAS_PER_UNIVERSE);

/**
 * A region as an import reads it
 */
export type ImportRegion = z.infer<typeof importRegion>;

/**
 * An area, as its file has it apart from its cells
 */
const importArea = z.looseObject({
	id: z.uuid(),
	parents: importParents,
	defaultTileId: numericId.nullable(),
	bounds: z.object({
		minColumn: cellCoordinate,
		minRow: cellCoordinate,
		maxColumn: cellCoordinate,
		maxRow: cellCoordinate
	})
		.refine((bounds) => ((bounds.maxColumn - bounds.minColumn) < MAX_AREA_SIDE), `An area can be at most ${MAX_AREA_SIDE} cells wide`)
		.refine((bounds) => ((bounds.maxRow - bounds.minRow) < MAX_AREA_SIDE), `An area can be at most ${MAX_AREA_SIDE} cells tall`),
	links: z.array(z.object({
		column: cellCoordinate,
		row: cellCoordinate,
		targetAreaId: z.uuid(),
		targetColumn: cellCoordinate,
		targetRow: cellCoordinate,
		mode: z.enum(AREA_LINK_MODES),
		requiresWholeGroup: z.boolean()
	})).max(MAX_AREA_LINKS),

	/**
	 * Left out by exports made before areas had neighbors, which have none
	 */
	neighbors: z.object({
		north: z.uuid().nullable(),
		east: z.uuid().nullable(),
		south: z.uuid().nullable(),
		west: z.uuid().nullable()
	}).optional()
});

/**
 * An area's file, an ExportedArea. Its rows' cells are checked by chunksOfRows(), which reads them where
 * they are, since a schema checking them would copy every row
 */
const exportedArea = importArea.extend({
	rows: z.array(z.unknown())
});

/**
 * An area as an import reads it: its file, without its cells, which ImportFile.cells holds
 */
export type ImportArea = z.infer<typeof importArea>;

/**
 * An export as an import reads it: its UniverseExport, with the races, classes, uploaded tilesets, tiles,
 * items, areas, notes for translators, needs-no-translation marks, translations and live IDs from their
 * own files where it has them
 */
export type ImportManifest = z.infer<typeof universeExport> & {
	translatorNotes?: z.infer<typeof exportedTranslations>['translatorNotes'];
	noTranslation?: z.infer<typeof exportedTranslations>['noTranslation'];
	races?: z.infer<typeof exportedOptions>;
	classes?: z.infer<typeof exportedOptions>;
	tileGraphics?: z.infer<typeof exportedTilesets>['tileGraphics'];
	tiles?: z.infer<typeof exportedOptions>;
	items?: z.infer<typeof exportedOptions>;
	regions?: ImportRegion[];
	areas?: ImportArea[];
	translations?: { languages: string[]; entries: NonNullable<z.infer<typeof exportedTranslations>['translations']> };
	liveIds?: z.infer<typeof exportedLiveIds>;
};

/**
 * An area's cells, as an import reads them: the chunks of its ground holding anything but its default
 * tile, made from the file's rows (chunksOfRows())
 */
export interface ImportAreaCells
{
	chunks: { chunkColumn: number; chunkRow: number; cells: number[] }[];
}

/**
 * An export, read and checked for its shape
 */
export interface ImportFile
{
	manifest: ImportManifest;

	/**
	 * Each area's cells, by the area's ID in the file
	 */
	cells: Map<string, ImportAreaCells>;

	/**
	 * Each uploaded tileset's image, by the tileset's ID in the file, for those the file holds
	 */
	images: Map<string, Buffer>;

	/**
	 * What the site's signature says of where it is from and of its files
	 */
	signature: UniverseImportSignature;
}

/**
 * Reads an export's zip archive
 *
 * @param archive The archive
 * @param ruleset The ruleset of the universe it is imported into
 * @param areasPerUniverse The most areas the site lets a universe have (SiteSettings)
 * @return The export
 * @throws ImportProblem when it isn't an export, is damaged, is in a newer format, is of a universe
 * with another ruleset, or has more areas than the site allows
 */
export async function readImportFile(archive: Buffer, ruleset: string, areasPerUniverse: number): Promise<ImportFile>
{
	let files: Map<string, Buffer>;

	try
	{
		files = filesAtRoot(await readZip(archive, MAX_UNIVERSE_IMPORT_CONTENT_BYTES));
	}
	catch (error)
	{
		if (error instanceof ZipError)
		{
			throw new ImportProblem(importMessages.notAnExport, {
				problem: error.message
			});
		}

		throw error;
	}

	const budget: JsonBudget = { remaining: MAX_UNIVERSE_IMPORT_JSON_BYTES };
	const raw = parseJson(files, budget, UNIVERSE_EXPORT_MANIFEST);
	const format = z.object({ formatVersion: z.number() }).safeParse(raw);

	// Checked first, so a newer file isn't refused for a part this version doesn't know
	if (format.success && (format.data.formatVersion > UNIVERSE_EXPORT_FORMAT_VERSION))
	{
		throw new ImportProblem(importMessages.newerFormat);
	}

	const manifest: ImportManifest = checked(universeExport, raw, UNIVERSE_EXPORT_MANIFEST);

	if (manifest.universe.ruleset !== ruleset)
	{
		throw new ImportProblem(importMessages.otherRuleset);
	}

	const cells = new Map<string, ImportAreaCells>();
	const images = new Map<string, Buffer>();

	// The races and classes are there exactly when the settings are
	if (manifest.settings !== undefined)
	{
		manifest.races = checked(exportedOptions, parseJson(files, budget, UNIVERSE_EXPORT_RACES), UNIVERSE_EXPORT_RACES);
		manifest.classes = checked(exportedOptions, parseJson(files, budget, UNIVERSE_EXPORT_CLASSES), UNIVERSE_EXPORT_CLASSES);
	}

	// An export made with a role that may change none of the universe's text has none
	if (files.has(UNIVERSE_EXPORT_TRANSLATIONS))
	{
		const { translatorNotes, noTranslation, languages, translations } = checked(exportedTranslations, parseJson(files, budget, UNIVERSE_EXPORT_TRANSLATIONS), UNIVERSE_EXPORT_TRANSLATIONS);

		if ((languages === undefined) !== (translations === undefined))
		{
			throw new ImportProblem(importMessages.notAnExport, {
				problem: `${UNIVERSE_EXPORT_TRANSLATIONS} has ${((languages === undefined) ? 'translations' : 'languages')} without ${((languages === undefined) ? 'languages' : 'translations')}`
			});
		}

		manifest.translatorNotes = translatorNotes;
		manifest.noTranslation = noTranslation;
		manifest.translations = (((languages === undefined) || (translations === undefined)) ? undefined : { languages, entries: translations });
	}

	// The tilesets, tiles, items and areas are there exactly when the areas' list is, with the rest of the
	// world, whose notes for translators the planner checks are there too
	if (files.has(UNIVERSE_EXPORT_AREAS))
	{
		const tilesets = checked(exportedTilesets, parseJson(files, budget, UNIVERSE_EXPORT_TILESETS), UNIVERSE_EXPORT_TILESETS);

		manifest.tileGraphics = tilesets.tileGraphics;
		manifest.tiles = tilesets.tiles;
		manifest.items = checked(exportedOptions, parseJson(files, budget, UNIVERSE_EXPORT_ITEMS), UNIVERSE_EXPORT_ITEMS);
		manifest.regions = checked(importRegions, parseJson(files, budget, UNIVERSE_EXPORT_REGIONS), UNIVERSE_EXPORT_REGIONS);

		const areas: ImportArea[] = [];
		const paths = new Set<string>();
		const listed = checked(areaPaths, parseJson(files, budget, UNIVERSE_EXPORT_AREAS), UNIVERSE_EXPORT_AREAS);

		if (listed.length > areasPerUniverse)
		{
			throw new ImportProblem(errorMessages.areaLimit, {
				max: areasPerUniverse
			});
		}

		for (const path of listed)
		{
			// Each area has a file of its own, so no file is read more than once
			if (paths.has(path))
			{
				throw new ImportProblem(importMessages.notAnExport, {
					problem: `${UNIVERSE_EXPORT_AREAS} lists ${path} more than once`
				});
			}

			paths.add(path);

			// Each area file is parsed in one go, so other requests and the rooms' ticks run between them
			await yieldToEventLoop();

			const { rows, ...area } = checked(exportedArea, parseJson(files, budget, path), path);

			if (cells.has(area.id))
			{
				throw new ImportProblem(importMessages.notAnExport, {
					problem: `${path} is area ${area.id}, as another area's file is`
				});
			}

			cells.set(area.id, chunksOfRows(rows, area.bounds, path));
			areas.push(area);
		}

		manifest.areas = areas;
	}

	if (manifest.universe.version === 'draft')
	{
		manifest.liveIds = checked(exportedLiveIds, parseJson(files, budget, UNIVERSE_EXPORT_LIVE_IDS), UNIVERSE_EXPORT_LIVE_IDS);
	}

	// Each tileset has an image file of its own, so one image can't be uploaded as many tilesets
	const graphicFiles = new Set<string>();

	for (const graphic of (manifest.tileGraphics ?? []))
	{
		if (graphic.file !== null)
		{
			if (graphicFiles.has(graphic.file))
			{
				throw new ImportProblem(importMessages.notAnExport, {
					problem: `${UNIVERSE_EXPORT_TILESETS} names ${graphic.file} for more than one tileset`
				});
			}

			graphicFiles.add(graphic.file);
		}

		const image = ((graphic.file === null) ? undefined : files.get(graphic.file));

		if (image)
		{
			images.set(graphic.id, image);
		}
	}

	return({
		manifest,
		cells,
		images,
		signature: await checkExportSignature(manifest, files)
	});
}

/**
 * An archive's files by their paths in the export: as they are when UNIVERSE_EXPORT_MANIFEST is at the
 * archive's root, and otherwise, when every file is in one folder, by their paths in that folder, as
 * zipping the folder an export was extracted into makes them. The metadata macOS adds is left out
 *
 * @param files The archive's files, by their paths in it
 * @return The files, by their paths in the export
 */
function filesAtRoot(files: Map<string, Buffer>): Map<string, Buffer>
{
	if (files.has(UNIVERSE_EXPORT_MANIFEST))
	{
		return(files);
	}

	const contents = [...files].filter(([path]) => !path.startsWith(MACOS_METADATA_FOLDER));
	const folders = new Set(contents.map(([path]) => path.slice(0, (path.indexOf('/') + 1))));
	const [folder] = folders;

	// A file at the root has no folder, which is ''
	if ((folders.size !== 1) || (folder === undefined) || (folder === ''))
	{
		return(files);
	}

	return(new Map(contents.map(([path, data]) => [path.slice(folder.length), data])));
}

/**
 * An area's rows of cells as the chunks of its ground that hold anything but its default tile, refusing
 * rows that don't cover exactly the area's columns and rows, or cells that aren't whole numbers
 *
 * @param rows The rows, as the area's file has them
 * @param bounds The area's bounds, as its file gives them
 * @param path The file's path, for the problem
 * @return The chunks
 * @throws ImportProblem when the rows don't match the area's bounds, or a cell isn't a whole number
 */
function chunksOfRows(rows: unknown[], bounds: AreaBounds, path: string): ImportAreaCells
{
	const width = (bounds.maxColumn - bounds.minColumn + 1);
	const height = (bounds.maxRow - bounds.minRow + 1);
	const chunks = new Map<string, { chunkColumn: number; chunkRow: number; cells: number[] }>();

	if (rows.length !== height)
	{
		throw new ImportProblem(importMessages.notAnExport, {
			problem: `${path} has ${rows.length} rows, but its bounds have ${height} (rows ${bounds.minRow} to ${bounds.maxRow})`
		});
	}

	for (const [index, cellRow] of rows.entries())
	{
		const row = (bounds.minRow + index);

		if (!Array.isArray(cellRow))
		{
			throw new ImportProblem(importMessages.notAnExport, {
				problem: `${path}'s row ${row} isn't a list of cells`
			});
		}

		if (cellRow.length !== width)
		{
			throw new ImportProblem(importMessages.notAnExport, {
				problem: `${path}'s row ${row} has ${cellRow.length} cells, but its bounds have ${width} columns (${bounds.minColumn} to ${bounds.maxColumn})`
			});
		}

		const cells: unknown[] = cellRow;

		for (let offset = 0; offset < width; offset++)
		{
			const column = (bounds.minColumn + offset);
			const value = cells[offset];

			if ((typeof value !== 'number') || !Number.isInteger(value))
			{
				throw new ImportProblem(importMessages.notAnExport, {
					problem: `${path}'s cell at column ${column}, row ${row} isn't a whole number`
				});
			}

			if (value === DEFAULT_TILE_CELL)
			{
				continue;
			}

			const key = chunkKey(chunkCoordinate(column), chunkCoordinate(row));
			let chunk = chunks.get(key);

			if (!chunk)
			{
				chunk = { chunkColumn: chunkCoordinate(column), chunkRow: chunkCoordinate(row), cells: new Array<number>(CHUNK_SIZE * CHUNK_SIZE).fill(DEFAULT_TILE_CELL) };
				chunks.set(key, chunk);
			}

			chunk.cells[cellIndexInChunk(column, row)] = value;
		}
	}

	return({ chunks: [...chunks.values()] });
}

/**
 * A JSON file of the archive, refused before it is parsed when it holds more than one file or the rest of
 * the budget may
 *
 * @param files The archive's files, by path
 * @param budget How much more JSON the archive may hold, which the file is taken from
 * @param path The file's path
 * @return What it holds
 * @throws ImportProblem when the archive doesn't have it, it is too large, or it isn't JSON
 */
function parseJson(files: Map<string, Buffer>, budget: JsonBudget, path: string): unknown
{
	const file = files.get(path);

	if (!file)
	{
		throw new ImportProblem(importMessages.notAnExport, {
			problem: `${path} is missing`
		});
	}

	if (file.length > MAX_UNIVERSE_IMPORT_JSON_FILE_BYTES)
	{
		throw new ImportProblem(importMessages.fileTooLarge, {
			path,
			max: MAX_UNIVERSE_IMPORT_JSON_FILE_BYTES / (1024 * 1024)
		});
	}

	if (file.length > budget.remaining)
	{
		throw new ImportProblem(importMessages.dataTooLarge, {
			max: MAX_UNIVERSE_IMPORT_JSON_BYTES / (1024 * 1024)
		});
	}

	budget.remaining -= file.length;

	try
	{
		return(JSON.parse(file.toString('utf8')));
	}
	catch
	{
		throw new ImportProblem(importMessages.notAnExport, {
			problem: `${path} isn't JSON`
		});
	}
}

/**
 * What one of the archive's files holds, checked for its shape
 *
 * @param schema The shape
 * @param value What the file holds
 * @param path The file's path, for the problem
 * @return The checked value
 * @throws ImportProblem when it doesn't have the shape
 */
function checked<T extends z.ZodType>(schema: T, value: unknown, path: string): z.infer<T>
{
	const result = schema.safeParse(value);

	if (!result.success)
	{
		throw new ImportProblem(importMessages.notAnExport, {
			problem: `${path}: ${describeInvalidPayload(result.error)}`
		});
	}

	return(result.data);
}
