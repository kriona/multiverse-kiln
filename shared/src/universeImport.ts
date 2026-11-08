/**
 * Importing a universe's export into its draft, from the editor's Universe tab (see Importing a
 * universe in STRUCTURE-OVERVIEW.md). Both routes take the export's zip archive as the request's body
 * (Content-Type application/zip), and answer 409 unless the request names the draft
 *
 * - POST EDITOR_UNIVERSES_PATH/:universeId/import/preview answers UniverseImportPreview: what importing
 *   the file would change, without changing anything
 * - POST EDITOR_UNIVERSES_PATH/:universeId/import imports it into the draft, as one save, answering 204.
 *   A file with tilesets to upload needs UNIVERSE_IMPORT_RIGHTS_PARAM=true, as uploading one does
 *
 * Each part of the file the player's role may change replaces that part of the draft: what the draft has
 * and the file doesn't is deleted. Parts the role may not change, and what belongs to the universe
 * rather than to its draft (its editors, stage and two-factor setting), are left out
 */
import type { ExportedBy, ExportedUniverse } from './universeExport.js';

/**
 * The path under a universe's editor route that imports a file into its draft
 */
export const UNIVERSE_IMPORT_PATH = '/import';

/**
 * The path under a universe's editor route that says what importing a file would change
 */
export const UNIVERSE_IMPORT_PREVIEW_PATH = '/import/preview';

/**
 * The query parameter saying the player has the rights to use the tilesets' images the file uploads
 */
export const UNIVERSE_IMPORT_RIGHTS_PARAM = 'rightsConfirmed';

/**
 * The largest file the routes take. A universe's export is mostly its uploaded tilesets' images, at most
 * MAX_UPLOADED_TILE_GRAPHICS of MAX_TILE_GRAPHIC_BYTES, with room for its other files
 */
export const MAX_UNIVERSE_IMPORT_BYTES = 80 * 1024 * 1024;

/**
 * The most the file's contents may hold once inflated
 */
export const MAX_UNIVERSE_IMPORT_CONTENT_BYTES = 256 * 1024 * 1024;

/**
 * The parts of an export an import can replace (UniverseExportContents)
 *
 * - settings: the universe's settings, the Ruleset tab, races, classes and themes
 * - world: tilesets, tiles, items, areas with their cells and links, and notes for translators
 * - noTranslation: the text marked as needing no translation
 * - translations: the translations into UniverseImportPreview.translationLanguages
 */
export const UNIVERSE_IMPORT_PARTS = ['settings', 'world', 'noTranslation', 'translations'] as const;

export type UniverseImportPart = typeof UNIVERSE_IMPORT_PARTS[number];

/**
 * Why something in a file isn't imported
 *
 * - universeOnly: its editors, stage or two-factor setting, which belong to the universe, not the draft
 * - settingsRole, worldRole, noTranslationRole: the player's role can't change that part
 * - translationLanguages: translations into languages the universe isn't translated into, or the
 *   player can't translate into
 * - nameTaken: its name, which another universe has
 * - keptForSettings: areas and items the draft's settings still name, kept since the settings aren't imported
 */
export const UNIVERSE_IMPORT_LEFT_OUT = ['universeOnly', 'settingsRole', 'worldRole', 'noTranslationRole', 'translationLanguages', 'nameTaken', 'keptForSettings'] as const;

export type UniverseImportLeftOut = typeof UNIVERSE_IMPORT_LEFT_OUT[number];

/**
 * How many of each kind of thing an import brings in, for the parts it replaces
 */
export interface UniverseImportCounts
{
	areas: number;
	tileGraphics: number;

	/**
	 * The universe's own, and the ruleset's defaults it edited
	 */
	tiles: number;
	items: number;
	races: number;
	classes: number;
	themes: number;

	difficultyLevels: number;
	translatorNotes: number;
	noTranslation: number;
	translations: number;
}

/**
 * Response of POST EDITOR_UNIVERSES_PATH/:universeId/import/preview
 */
export interface UniverseImportPreview
{
	/**
	 * Which universe and version the file is of
	 */
	universe: ExportedUniverse;

	/**
	 * When it was exported (ISO 8601), and by whom
	 */
	exportedAt: string;
	exportedBy: ExportedBy;

	/**
	 * Whether it is of this universe, so the draft's things are matched with the file's and keep their
	 * place: characters, groups and their positions go on naming them once the draft is applied
	 */
	sameUniverse: boolean;

	/**
	 * The parts it replaces, in UNIVERSE_IMPORT_PARTS order
	 */
	parts: UniverseImportPart[];

	counts: UniverseImportCounts;

	/**
	 * The languages whose translations it replaces, by tag
	 */
	translationLanguages: string[];

	/**
	 * How many of its tilesets' images it uploads, which needs the player to confirm their rights to them
	 */
	tilesetUploads: number;

	/**
	 * What it leaves out, and why, in UNIVERSE_IMPORT_LEFT_OUT order
	 */
	leftOut: UniverseImportLeftOut[];
}
