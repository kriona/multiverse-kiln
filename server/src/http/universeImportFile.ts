/**
 * Reading a universe's export for importing it (see Importing a universe in STRUCTURE-OVERVIEW.md): the
 * zip archive, its UniverseExport and each area's cells, checked for the shape shared/src/universeExport.ts
 * gives them. What the things' settings hold is checked later, by the validators a save's changes go
 * through (editorChange in editorPayloads.ts), as the import makes its changes from them
 */
import { CHUNK_SIZE, defineMessages, EDITOR_ROLES, MAX_AREA_SIDE, MAX_UNIVERSE_IMPORT_CONTENT_BYTES, RULESETS, TILE_GRAPHIC_FORMATS, AREA_LINK_MODES, UNIVERSE_EXPORT_FORMAT, UNIVERSE_EXPORT_FORMAT_VERSION, UNIVERSE_EXPORT_MANIFEST, UNIVERSE_TEXT_FIELDS, UNIVERSE_TEXT_KINDS, UNIVERSE_VERSIONS, type MessageDescriptor, type MessageValues } from '@multiverse-kiln/shared';
import { z } from 'zod';

import { readZip, ZipError } from '../archives/zip.js';
import { describeInvalidPayload } from '../rooms/payloads.js';

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
	}
});

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
	races: z.array(exportedOption).optional(),
	classes: z.array(exportedOption).optional(),
	themes: z.array(exportedOption).optional(),
	editors: z.array(z.unknown()).optional(),
	tileGraphics: z.array(z.object({
		id: z.uuid(),
		name: z.string(),
		format: z.enum(TILE_GRAPHIC_FORMATS),
		drawOrder: z.number().int().nullable(),
		file: z.string().max(200).nullable()
	})).optional(),
	tiles: z.array(exportedOption).optional(),
	items: z.array(exportedOption).optional(),
	areas: z.array(z.looseObject({
		id: z.uuid(),
		parentAreaId: z.uuid().nullable(),
		defaultTileId: numericId,
		bounds: z.object({
			minColumn: cellCoordinate,
			minRow: cellCoordinate,
			maxColumn: cellCoordinate,
			maxRow: cellCoordinate
		}),
		links: z.array(z.object({
			column: cellCoordinate,
			row: cellCoordinate,
			targetAreaId: z.uuid(),
			targetColumn: cellCoordinate,
			targetRow: cellCoordinate,
			mode: z.enum(AREA_LINK_MODES),
			requiresWholeGroup: z.boolean()
		})),
		file: z.string().max(200)
	})).optional(),
	translatorNotes: z.array(textRef.extend({ note: z.string() })).optional(),
	noTranslation: z.array(textRef).optional(),
	translations: z.object({
		languages: z.array(z.string().max(64)),
		entries: z.array(textRef.extend({
			language: z.string().max(64),
			text: z.string(),
			sourceHash: z.string()
		}))
	}).optional(),
	liveIds: z.object({
		tileGraphics: idRecord(z.uuid()),
		tiles: idRecord(numericId),
		items: idRecord(numericId),
		areas: idRecord(z.uuid()),
		races: idRecord(numericId),
		classes: idRecord(numericId),
		themes: idRecord(numericId),
		difficultyLevels: idRecord(numericId)
	}).partial().optional()
});

/**
 * An export's UniverseExport, as an import reads it
 */
export type ImportManifest = z.infer<typeof universeExport>;

/**
 * An area's cells, an ExportedAreaCells
 */
const areaCells = z.object({
	chunkSize: z.literal(CHUNK_SIZE),
	chunks: z.array(z.object({
		chunkColumn: z.number().int(),
		chunkRow: z.number().int(),
		cells: z.array(z.number().int()).length(CHUNK_SIZE * CHUNK_SIZE)
	}))
});

/**
 * An area's cells, as an import reads them
 */
export type ImportAreaCells = z.infer<typeof areaCells>;

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
}

/**
 * Reads an export's zip archive
 *
 * @param archive The archive
 * @param ruleset The ruleset of the universe it is imported into
 * @return The export
 * @throws ImportProblem when it isn't an export, is damaged, is in a newer format, or is of a universe
 * with another ruleset
 */
export async function readImportFile(archive: Buffer, ruleset: string): Promise<ImportFile>
{
	let files: Map<string, Buffer>;

	try
	{
		files = await readZip(archive, MAX_UNIVERSE_IMPORT_CONTENT_BYTES);
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

	const raw = parseJson(files, UNIVERSE_EXPORT_MANIFEST);
	const format = z.object({ formatVersion: z.number() }).safeParse(raw);

	// Checked first, so a newer file isn't refused for a part this version doesn't know
	if (format.success && (format.data.formatVersion > UNIVERSE_EXPORT_FORMAT_VERSION))
	{
		throw new ImportProblem(importMessages.newerFormat);
	}

	const manifest = checked(universeExport, raw, UNIVERSE_EXPORT_MANIFEST);

	if (manifest.universe.ruleset !== ruleset)
	{
		throw new ImportProblem(importMessages.otherRuleset);
	}

	const cells = new Map<string, ImportAreaCells>();
	const images = new Map<string, Buffer>();

	for (const area of (manifest.areas ?? []))
	{
		cells.set(area.id, checked(areaCells, parseJson(files, area.file), area.file));
	}

	for (const graphic of (manifest.tileGraphics ?? []))
	{
		const image = ((graphic.file === null) ? undefined : files.get(graphic.file));

		if (image)
		{
			images.set(graphic.id, image);
		}
	}

	return({
		manifest,
		cells,
		images
	});
}

/**
 * A JSON file of the archive
 *
 * @param files The archive's files, by path
 * @param path The file's path
 * @return What it holds
 * @throws ImportProblem when the archive doesn't have it, or it isn't JSON
 */
function parseJson(files: Map<string, Buffer>, path: string): unknown
{
	const file = files.get(path);

	if (!file)
	{
		throw new ImportProblem(importMessages.notAnExport, {
			problem: `${path} is missing`
		});
	}

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
