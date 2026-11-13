/**
 * Exporting a universe from its editor's Universe tab (see Exporting a universe in STRUCTURE-OVERVIEW.md)
 *
 * GET EDITOR_UNIVERSES_PATH/:universeId/export (UNIVERSE_EXPORT_PATH) answers a zip archive of what the
 * player's role may change (canExportUniverse(), universeExportContents()) in the version the request
 * names, as it is saved, holding:
 * - UNIVERSE_EXPORT_MANIFEST: a UniverseExport, as JSON
 * - UNIVERSE_EXPORT_RACES and UNIVERSE_EXPORT_CLASSES: the races and classes, as JSON arrays, when the
 *   export holds the settings
 * - UNIVERSE_EXPORT_TILESETS: the uploaded tilesets and the tiles, an ExportedTilesets as JSON, when the
 *   export holds the world
 * - UNIVERSE_EXPORT_ITEMS: the items, as a JSON array, when the export holds the world
 * - UNIVERSE_EXPORT_REGIONS: the regions, as a JSON array, when the export holds the world
 * - UNIVERSE_EXPORT_AREAS: the paths of the areas' files, as a JSON array, when the export holds the world
 * - universeExportAreaPath(): each area, an ExportedArea as JSON, when the export holds the world
 * - UNIVERSE_EXPORT_TRANSLATIONS: the notes for translators, the text needing no translation and the
 *   translations, an ExportedTranslations as JSON, when the export holds any of them
 * - UNIVERSE_EXPORT_LIVE_IDS: the live row each of the draft's rows was copied from, an ExportedLiveIds
 *   as JSON, when the export is of the draft
 * - UNIVERSE_EXPORT_AREA_LEGEND: how to read the areas' cells, which tile each number in them is and
 *   which area each file is, in Markdown, in the language of the player exporting; an import doesn't read it
 * - universeExportTilesetPath(): each uploaded tileset's PNG, when the export holds the world
 * - UNIVERSE_EXPORT_SIGNATURE: the server's signatures of where the export is from and of every other
 *   file, an ExportSignature as JSON, so an import can tell an export made on its site, unchanged, from
 *   one changed since or made elsewhere
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
import type { EditorArea, EditorAreaLink, EditorTheme, EditorTile, RegionSettings, RulesetSettings, UniverseSettings, UniverseVersionName, UploadedTileGraphic } from './editor.js';
import type { UniverseTextRef } from './universeText.js';
import { ADMIN_ROLE, canEditUniverseSettings, canEditWorld, canMarkNoTranslation, canTranslate, universeSlug, type BuilderPermissions, type EditorAccess, type EditorRole, type Ruleset, type UniverseRole } from './universes.js';

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
 * The path in the archive of the races, an EditorRace[]: every race the universe can use, the ruleset's
 * defaults included, by ID
 */
export const UNIVERSE_EXPORT_RACES = 'races.json';

/**
 * The path in the archive of the classes, an EditorClass[]: every class the universe can use, the
 * ruleset's defaults included, by ID
 */
export const UNIVERSE_EXPORT_CLASSES = 'classes.json';

/**
 * The path in the archive of the uploaded tilesets and the tiles, an ExportedTilesets
 */
export const UNIVERSE_EXPORT_TILESETS = 'tilesets.json';

/**
 * The path in the archive of the items, an EditorItem[]: every item the universe can use, the ruleset's
 * defaults included, by ID
 */
export const UNIVERSE_EXPORT_ITEMS = 'items.json';

/**
 * The path in the archive of the notes for translators, the text needing no translation and the
 * translations, an ExportedTranslations
 */
export const UNIVERSE_EXPORT_TRANSLATIONS = 'translations.json';

/**
 * The path in the archive of the list of the areas' files: each one's path (universeExportAreaPath()), by
 * the area's name
 */
export const UNIVERSE_EXPORT_AREAS = 'areas.json';

/**
 * The path in the archive of the regions, ExportedRegion[] by name, when the export holds the world
 */
export const UNIVERSE_EXPORT_REGIONS = 'regions.json';

/**
 * The path in the archive of an export of the draft's ExportedLiveIds
 */
export const UNIVERSE_EXPORT_LIVE_IDS = 'liveIds.json';

/**
 * The path in the archive of the legend beside the areas' files
 */
export const UNIVERSE_EXPORT_AREA_LEGEND = 'areas/legend.md';

/**
 * The path in the archive of the ExportSignature
 */
export const UNIVERSE_EXPORT_SIGNATURE = 'signature.json';

/**
 * The path in the archive of an area's file
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
	 * into. Undefined for a role that translates into none, whose export has no UNIVERSE_EXPORT_TRANSLATIONS
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

	/**
	 * A builder's permissions; none for other roles
	 */
	permissions: BuilderPermissions;

	/**
	 * The regions a builder is assigned to, by the export's IDs for them; none for other roles
	 */
	regions: string[];
}

/**
 * A region, as the export names it (see Regions in STRUCTURE-OVERVIEW.md): its settings, each null for
 * inherit, and the regions it is inside by their IDs in the export
 */
export interface ExportedRegion extends RegionSettings
{
	id: string;
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
 * What the Tilesets tab shows: the archive's UNIVERSE_EXPORT_TILESETS
 */
export interface ExportedTilesets
{
	/**
	 * The uploaded tilesets, by name
	 */
	tileGraphics: ExportedTileGraphic[];

	/**
	 * Every tile the universe can use, the ruleset's defaults included, by ID
	 */
	tiles: ExportedTile[];
}

/**
 * An area's file in the archive (universeExportAreaPath()): its settings, its links and its cells
 */
export interface ExportedArea extends EditorArea
{
	/**
	 * The links on its cells, by row then column
	 */
	links: EditorAreaLink[];

	/**
	 * Every cell of its ground, and nothing outside it: its rows from north to south (bounds.minRow to
	 * bounds.maxRow), each its cells from west to east (bounds.minColumn to bounds.maxColumn), so
	 * rows[r][c] is the cell at column bounds.minColumn + c, row bounds.minRow + r. Each cell holds a tile
	 * the export lists, DEFAULT_TILE_CELL or VOID_CELL
	 */
	rows: number[][];
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
 * What an export holds for translating the universe's text: its UNIVERSE_EXPORT_TRANSLATIONS, there when
 * any of its sections is. Each section is there exactly when the role may change it, even when empty
 */
export interface ExportedTranslations
{
	/**
	 * The notes for translators, with the world, by what they describe
	 */
	translatorNotes?: ExportedTranslatorNote[];

	/**
	 * The text marked as needing no translation, when the role may mark it (canMarkNoTranslation())
	 */
	noTranslation?: UniverseTextRef[];

	/**
	 * The languages it holds every translation into, by tag (UniverseExportContents.translationLanguages),
	 * and the translations, by what they translate, then by language; both there, or neither
	 */
	languages?: string[];
	translations?: ExportedTranslation[];
}

/**
 * The archive's UNIVERSE_EXPORT_MANIFEST. The optional sections are there exactly when the role may
 * change them (universeExportContents()): settings through editors with settings (and the archive's
 * UNIVERSE_EXPORT_RACES and UNIVERSE_EXPORT_CLASSES with them). The world is in the archive's
 * UNIVERSE_EXPORT_TILESETS, UNIVERSE_EXPORT_ITEMS and UNIVERSE_EXPORT_AREAS, and its text's notes, marks
 * and translations in its UNIVERSE_EXPORT_TRANSLATIONS
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
	 * Every theme the universe can use, the ruleset's defaults included, by ID
	 */
	themes?: EditorTheme[];

	/**
	 * By username
	 */
	editors?: ExportedEditor[];
}

/**
 * The archive's UNIVERSE_EXPORT_SIGNATURE: keyed hashes only the server that made the export can make,
 * since they take its secret key
 */
export interface ExportSignature
{
	/**
	 * The keyed hash (base64) of where the export is from: its universe's ID, version and name, when it
	 * was made and who made it, as its UniverseExport says. It holds even when other files are changed
	 */
	origin: string;

	/**
	 * The SHA-256 (hex) of each of the archive's other files, by its path
	 */
	files: Record<string, string>;

	/**
	 * The keyed hash (base64) of files, so the files hold what the export made when each one's SHA-256
	 * matches
	 */
	contents: string;
}

/**
 * The live row each of a draft's rows was copied from, by kind, by the draft's ID: the archive's
 * UNIVERSE_EXPORT_LIVE_IDS, for an export of the draft, so an import finds each thing once the draft is
 * applied and the draft's IDs are gone. What the draft added isn't listed: it keeps its ID when the
 * draft is applied. An edited copy of one of the ruleset's defaults is listed too, though nothing names
 * it: everything names the default's ID
 */
export interface ExportedLiveIds
{
	tileGraphics: Record<string, string>;
	tiles: Record<string, number>;
	items: Record<string, number>;
	regions: Record<string, string>;
	areas: Record<string, string>;
	races: Record<string, number>;
	classes: Record<string, number>;
	themes: Record<string, number>;
	difficultyLevels: Record<string, number>;
}
