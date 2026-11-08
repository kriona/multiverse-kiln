/**
 * Exporting a universe from its editor's Universe tab (see Exporting a universe in STRUCTURE-OVERVIEW.md)
 *
 * GET EDITOR_UNIVERSES_PATH/:universeId/export (UNIVERSE_EXPORT_PATH) answers a zip archive of what the
 * player's role may change (canExportUniverse(), universeExportContents()) in the version the request
 * names, as it is saved, holding:
 * - UNIVERSE_EXPORT_MANIFEST: a UniverseExport, as JSON
 * - universeExportAreaPath(): each area's cells, an ExportedAreaCells as JSON, when the export holds the world
 * - universeExportTilesetPath(): each uploaded tileset's PNG, when the export holds the world
 *
 * Things are named by the IDs the version gives them, as the editor names them: a default tile, item,
 * race, class or theme by the ruleset's ID for it, which the lists give with its key, so an import into
 * another database finds it by its key, and everything the universe added by its own row's ID. A draft's
 * export uses the draft's IDs
 *
 * A section is left out when the role may not change what it holds, and present (if empty) when it may,
 * so an import can tell "has none" from "wasn't exported"
 */
import { SITE_NAME } from './constants.js';
import type { DifficultyLevel } from './difficulty.js';
import type { EditorArea, EditorAreaLink, EditorClass, EditorItem, EditorRace, EditorTheme, EditorTile, RulesetSettings, UniverseSettings, UniverseVersionName, UploadedTileGraphic } from './editor.js';
import type { AreaChunk } from './messages.js';
import type { UniverseTextRef } from './universeText.js';
import { ADMIN_ROLE, canEditUniverseSettings, canEditWorld, canMarkNoTranslation, canTranslate, universeSlug, type EditorAccess, type EditorRole, type Ruleset, type UniverseRole } from './universes.js';

/**
 * The path under a universe's editor route (EDITOR_UNIVERSES_PATH/:universeId) that exports it
 */
export const UNIVERSE_EXPORT_PATH = '/export';

/**
 * What a UniverseExport's format field says, so an import can tell an export from other JSON
 */
export const UNIVERSE_EXPORT_FORMAT = 'universe-export';

/**
 * The version of the format a UniverseExport is written in, raised whenever a change to it would make an
 * older import read it wrongly
 */
export const UNIVERSE_EXPORT_FORMAT_VERSION = 1;

/**
 * The path in the archive of the UniverseExport
 */
export const UNIVERSE_EXPORT_MANIFEST = 'universe.json';

/**
 * The path in the archive of an area's cells
 *
 * @param areaId The area's ID
 * @return The path
 */
export function universeExportAreaPath(areaId: string): string
{
	return(`areas/${areaId}.json`);
}

/**
 * The path in the archive of an uploaded tileset's image
 *
 * @param graphicId The tileset's ID
 * @return The path
 */
export function universeExportTilesetPath(graphicId: string): string
{
	return(`tilesets/${graphicId}.png`);
}

/**
 * What an export holds, from the role it is made with
 */
export interface UniverseExportContents
{
	/**
	 * The universe's settings, the Ruleset tab's settings and difficulty levels, its races, classes and
	 * themes, and its editors: what only creators (and the site admin role) change
	 */
	settings: boolean;

	/**
	 * Its tilesets, tiles, items, areas with their cells and links, and notes for translators: what
	 * builders change too
	 */
	world: boolean;

	/**
	 * The text marked as needing no translation
	 */
	noTranslation: boolean;

	/**
	 * The languages whose translations it holds, by tag: the universe's that the role may translate
	 * into. Undefined for a role that translates into none, whose export has no translations section
	 */
	translationLanguages: string[] | undefined;
}

/**
 * What an export made with a role holds: what the role may change
 *
 * @param access The role in the editor, and a translator's languages
 * @param translationLanguages The languages the universe is translated into, by tag
 * @return What the export holds
 */
export function universeExportContents(access: EditorAccess, translationLanguages: readonly string[]): UniverseExportContents
{
	const translates = ((access.role === 'creator') || (access.role === ADMIN_ROLE) || (access.role === 'translator'));

	return({
		settings: canEditUniverseSettings(access.role),
		world: canEditWorld(access.role),
		noTranslation: canMarkNoTranslation(access),
		translationLanguages: (translates ? translationLanguages.filter((language) => canTranslate(access, language)) : undefined)
	});
}

/**
 * The name of the file an export downloads as: the game engine's name, the universe's slug, "draft" for
 * the draft's, and the date, such as MultiverseKiln.kilnhaven.2026-11-08.zip. Only letters, digits,
 * underscores and hyphens of the engine's name are kept, as for the account's data export
 *
 * @param name The universe's name
 * @param version The version exported
 * @param date When it was exported, written in the computer's time zone
 * @return The file name
 */
export function universeExportFileName(name: string, version: UniverseVersionName, date: Date): string
{
	const site = SITE_NAME.replace(/[^\p{L}\p{N}_-]+/gu, '');
	const day = [date.getFullYear(), (date.getMonth() + 1), date.getDate()]
		.map((part) => String(part).padStart(2, '0'))
		.join('-');
	const parts = [site, universeSlug(name), ((version === 'draft') ? 'draft' : ''), day]
		.filter((part) => (part !== ''));

	return(`${parts.join('.')}.zip`);
}

/**
 * Which universe an export is of
 */
export interface ExportedUniverse
{
	id: string;

	/**
	 * The version exported, whose IDs the export uses
	 */
	version: UniverseVersionName;

	name: string;

	/**
	 * Which ruleset its default tiles, items, races, classes and themes are from, which their keys name
	 */
	ruleset: Ruleset;

	/**
	 * The language its text is written in, which translations are made from, by tag
	 */
	sourceLanguage: string;
}

/**
 * The player who made an export
 */
export interface ExportedBy
{
	username: string;
	displayName: string;
}

/**
 * Someone with a role in the universe, by username
 */
export interface ExportedEditor
{
	username: string;
	role: UniverseRole;

	/**
	 * A translator's languages, by tag; empty for other roles
	 */
	languages: string[];
}

/**
 * An uploaded tileset, and where its image is in the archive
 */
export interface ExportedTileGraphic extends UploadedTileGraphic
{
	/**
	 * The image's path in the archive (universeExportTilesetPath()), or null when storage no longer had it
	 */
	file: string | null;
}

/**
 * A tile the universe can use, as the Tilesets tab lists it. uploadedGraphicId names one of the
 * export's tileGraphics
 */
export type ExportedTile = Omit<EditorTile, 'uploadedGraphic'>;

/**
 * An area, its links, and where its cells are in the archive
 */
export interface ExportedArea extends EditorArea
{
	/**
	 * The links on its cells, by row then column
	 */
	links: EditorAreaLink[];

	/**
	 * Its cells' path in the archive (universeExportAreaPath())
	 */
	file: string;
}

/**
 * An area's cells: the stored chunks of its ground. A chunk that isn't listed is all the area's default
 * tile. Each cell holds a tile the export lists, DEFAULT_TILE_CELL or VOID_CELL
 */
export interface ExportedAreaCells
{
	/**
	 * Cells along each side of a chunk (CHUNK_SIZE)
	 */
	chunkSize: number;

	chunks: AreaChunk[];
}

/**
 * A note for translators on a piece of universe text
 */
export interface ExportedTranslatorNote extends UniverseTextRef
{
	note: string;
}

/**
 * A translation of a piece of universe text
 */
export interface ExportedTranslation extends UniverseTextRef
{
	/**
	 * By tag
	 */
	language: string;

	text: string;

	/**
	 * The hash of the source text it was made from, or last confirmed against (sourceTextHash()), which
	 * tells whether it is out of date
	 */
	sourceHash: string;
}

/**
 * The translations an export holds
 */
export interface ExportedTranslations
{
	/**
	 * The languages it holds every translation into, by tag (UniverseExportContents.translationLanguages)
	 */
	languages: string[];

	entries: ExportedTranslation[];
}

/**
 * The archive's UNIVERSE_EXPORT_MANIFEST. The optional sections are there exactly when the role may
 * change them (universeExportContents()): settings through editors with settings, tileGraphics through
 * translatorNotes with the world, noTranslation with it, and translations with translationLanguages
 */
export interface UniverseExport
{
	format: typeof UNIVERSE_EXPORT_FORMAT;

	/**
	 * UNIVERSE_EXPORT_FORMAT_VERSION when it was made
	 */
	formatVersion: number;

	/**
	 * When it was made (ISO 8601)
	 */
	exportedAt: string;

	/**
	 * Who made it
	 */
	exportedBy: ExportedBy;

	/**
	 * The role it was made with, which decided what it holds
	 */
	role: EditorRole;

	universe: ExportedUniverse;

	settings?: UniverseSettings;
	rulesetSettings?: RulesetSettings;

	/**
	 * Easiest first
	 */
	difficultyLevels?: DifficultyLevel[];

	/**
	 * Every race, class and theme the universe can use, the ruleset's defaults included, by ID
	 */
	races?: EditorRace[];
	classes?: EditorClass[];
	themes?: EditorTheme[];

	/**
	 * By username
	 */
	editors?: ExportedEditor[];

	/**
	 * By name
	 */
	tileGraphics?: ExportedTileGraphic[];

	/**
	 * Every tile and item the universe can use, the ruleset's defaults included, by ID
	 */
	tiles?: ExportedTile[];
	items?: EditorItem[];

	/**
	 * By name
	 */
	areas?: ExportedArea[];

	translatorNotes?: ExportedTranslatorNote[];

	/**
	 * The text marked as needing no translation
	 */
	noTranslation?: UniverseTextRef[];

	translations?: ExportedTranslations;
}
