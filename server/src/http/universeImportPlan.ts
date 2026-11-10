/**
 * Planning an import (see Importing a universe in STRUCTURE-OVERVIEW.md): the editor changes that make a
 * universe's draft hold what an export holds, for the parts of it the player's role may change, saved as
 * one save through saveChanges() (editorChanges.ts), so every change is checked and recorded as a save
 * from the editor would be
 *
 * Each part the import replaces leaves the draft holding what the file holds: the file's things are
 * matched with the draft's, changed to the file's settings, and what the draft has and the file doesn't is
 * deleted. The ruleset's defaults are matched by their keys. The universe's own things are matched only in
 * an export of the same universe, by the live row each was copied from (or for the same draft, by its
 * own ID), so they keep their place once the draft is applied: characters, groups and their positions
 * go on naming them. Everything else is made anew
 *
 * Settings that name things the same save makes (a race's starting area, the universe's starting items)
 * can only name saved things in a save from the editor, so the import makes those changes once the
 * changes before them are saved (PendingChange)
 */
import { ADMIN_ROLE, canEditUniverseSettings, canEditWorld, canMarkNoTranslation, canTranslate, CHUNK_SIZE, chunkKey, DEFAULT_TILE_CELL, defineMessages, hasLinkLikeText, isInBounds, NEW_AREA_BOUNDS, parseChunkKey, type AreaBounds, DIFFICULTY_LEVEL_NAMES, MAX_CELL_CHANGES, MAX_UNIVERSE_NAME_LENGTH, MAX_UPLOADED_TILE_GRAPHICS, RULESET_COINS, UNIVERSE_IMPORT_LEFT_OUT, type Translator, UNIVERSE_TEXT_KIND_FIELDS, VOID_CELL, type DifficultyLevel, type EditableUniverseDetails, type EditorAccess, type EditorArea, type EditorAreaLink, type EditorChange, type EditorClass, type EditorItem, type EditorRace, type EditorTheme, type EditorTile, type NewRef, type Ruleset, type UniverseImportCounts, type UniverseImportLeftOut, type UniverseImportPart, type UniverseImportPreview, type UniverseTextKind, type UniverseTextRef, type UploadedTileGraphic } from '@multiverse-kiln/shared';

import { findAreasUsingTile, listEditorAreas, listStartingAreaIds, listVersionAreaLinks, loadChunkPage } from '../db/areaRepo.js';
import { loadEditorClasses } from '../db/classRepo.js';
import type { Executor } from '../db/client.js';
import { listDifficultyLevels } from '../db/difficultyRepo.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { loadEditorThemes } from '../db/themeRepo.js';
import { listTileGraphics } from '../db/tileGraphicRepo.js';
import { loadEditorTiles } from '../db/tileRepo.js';
import { inBulkSnapshot } from '../db/transactions.js';
import { findAllDraftOrigins, type DraftOrigins } from '../db/universeDraftRepo.js';
import { findEditableUniverse, isUniverseNameTaken } from '../db/universeRepo.js';
import { listThingNames, listTranslations, listTranslatorNotes, type TranslatorNoteRecord, type UniverseTranslationRecord } from '../db/universeTextRepo.js';
import type { UniverseVersion } from '../db/universeVersions.js';
import { describeInvalidPayload } from '../rooms/payloads.js';
import { ChangeRefusal } from './editorChangeContext.js';
import type { PendingChange } from './editorChanges.js';
import { editorChange } from './editorPayloads.js';
import { tileGraphicMessages } from './editorTileGraphics.js';
import { ImportProblem, importMessages, type ImportFile, type ImportManifest } from './universeImportFile.js';

/**
 * A thing's ID in the draft, or the ref of the change in the import that makes it
 */
type Target<Id extends number | string> = Id | NewRef;

/**
 * The IDs the changes before one gave the things they made
 */
type SavedIds = ReadonlyMap<NewRef, number | string>;

/**
 * The settings each kind of thing is saved with, besides the ones naming other things, which the import
 * finds in the draft
 */
const TILE_FIELDS = ['name', 'indoors', 'outdoors', 'color', 'graphic', 'visionCost', 'walkSeconds', 'enabled'] as const;
const ITEM_FIELDS = ['name', 'type', 'enabled'] as const;
const OPTION_FIELDS = ['name', 'enabled', 'keepPlaying', 'rules', 'startingMoney', 'startingColumn', 'startingRow'] as const;
const THEME_FIELDS = ['name', 'enabled', 'rules'] as const;
const LEVEL_FIELDS = ['name', 'isDefault', 'mobScale', 'permadeath'] as const;
const AREA_FIELDS = ['name', 'enabled', 'indoors', 'lightLevel', 'passageOfTime', 'faerieMorning', 'loopsEastWest', 'loopsNorthSouth'] as const;
const UNIVERSE_FIELDS = ['shortDescription', 'longDescription', 'sourceLanguage', 'translationLanguages', 'passageOfTime', 'faerieMorning', 'displayTime', 'lobbyPassageOfTime', 'lobbyDayHours', 'lobbyFaerieMorning', 'lobbyNoVisionCost', 'groupSize', 'startingMoney', 'coinNames', 'coinAbbreviations', 'startingColumn', 'startingRow'] as const;

/**
 * The parts of an export that come together: an export holding one of them holds all of them
 */
const SETTINGS_SECTIONS = ['settings', 'rulesetSettings', 'difficultyLevels', 'races', 'classes', 'themes'] as const;
const WORLD_SECTIONS = ['tileGraphics', 'tiles', 'items', 'areas', 'translatorNotes'] as const;

/**
 * The draft an import goes into, as it is before the import's save
 */
export interface ImportTarget
{
	universe: EditableUniverseDetails;
	tiles: EditorTile[];
	items: EditorItem[];
	races: EditorRace[];
	classes: EditorClass[];
	themes: EditorTheme[];
	difficultyLevels: DifficultyLevel[];
	tileGraphics: UploadedTileGraphic[];
	areas: EditorArea[];
	links: (EditorAreaLink & { areaId: string })[];
	notes: TranslatorNoteRecord[];
	translations: UniverseTranslationRecord[];

	/**
	 * The universe text the draft holds, as "kind:thingId:field" (textKey())
	 */
	texts: Set<string>;

	origins: DraftOrigins;

	/**
	 * The areas characters start in: the universe's, its races' and classes'
	 */
	startingAreaIds: string[];

	/**
	 * The name the import gives the draft (importedName()), or undefined to keep the draft's, when the
	 * file has no name, its name holds text that could be made into a link, or every name the import
	 * would give it is taken
	 */
	name: string | undefined;

	/**
	 * The areas whose cells use each of the draft's own tiles, for keeping tiles the areas the import
	 * keeps use; only loaded when the import keeps areas
	 */
	tileUsage: Map<number, string[]>;

	/**
	 * The stored chunks of each of the draft's areas, by area and chunkKey(), which a matched area's cells
	 * are compared with so only those that differ are painted; only loaded for a file of the same universe,
	 * the only one whose areas are matched
	 */
	areaCells: Map<string, Map<string, number[]>>;
}

/**
 * What an import does
 */
export interface ImportPlan
{
	/**
	 * The changes, in the order they are saved
	 */
	changes: PendingChange[];

	preview: UniverseImportPreview;
}

/**
 * The key of a piece of universe text
 *
 * @param kind What it belongs to
 * @param thingId Its ID, or the ref of the change making it
 * @param field Which of its text it is
 * @return The key
 */
function textKey(kind: UniverseTextKind, thingId: string, field: string): string
{
	return(`${kind}:${thingId}:${field}`);
}

/**
 * Reads the draft an import goes into, in one snapshot
 *
 * @param version The universe's draft
 * @param file The file being imported, whose name is checked against other universes'
 * @param keepsAreas Whether the import may keep some of the draft's areas, so the tiles they use matter
 * @param translator The language the player importing reads, which a copy's name is written in
 * @return The draft, or undefined when the universe has no draft
 */
export async function loadImportTarget(version: UniverseVersion, file: ImportFile, keepsAreas: boolean, translator: Translator): Promise<ImportTarget | undefined>
{
	return(inBulkSnapshot(async (executor) =>
	{
		const universe = await findEditableUniverse(version, executor);

		if (!universe)
		{
			return(undefined);
		}

		const { ruleset } = universe;
		const tiles = await loadEditorTiles(version, ruleset, executor);
		const areas = await listEditorAreas(version, executor);

		return({
			universe,
			tiles,
			items: await loadEditorItems(version, ruleset, executor),
			races: await loadEditorRaces(version, ruleset, executor),
			classes: await loadEditorClasses(version, ruleset, executor),
			themes: await loadEditorThemes(version, ruleset, executor),
			difficultyLevels: await listDifficultyLevels(version, executor),
			tileGraphics: await listTileGraphics(version, executor),
			areas,
			links: await listVersionAreaLinks(version, executor),
			notes: await listTranslatorNotes(version, executor),
			translations: await listTranslations(version, universe.translationLanguages, executor),
			texts: await existingTexts(version, universe, executor),
			origins: await findAllDraftOrigins(version.universeId, executor),
			startingAreaIds: await listStartingAreaIds(version, executor),
			name: await importedName(file, universe, translator, executor),
			tileUsage: (keepsAreas ? await usageOf(version, tiles, executor) : new Map()),
			areaCells: ((file.manifest.universe.id === universe.id) ? await cellsOf(areas, executor) : new Map())
		});
	}));
}

/**
 * The most copies importedName() tries numbering before keeping the draft's own name
 */
const MAX_COPY_NUMBER = 20;

/**
 * The names a universe made from another universe's file is given (see shared/src/localization.ts)
 */
const copyNames = defineMessages({
	copy: {
		id: 'universe.copyName',
		defaultMessage: '{name} (copy)',
		description: 'Name importing a file into a universe\'s draft gives the universe when the file was exported from another universe, whose name is taken; {name} is that universe\'s name. The creator can rename it'
	},
	numbered: {
		id: 'universe.copyNameNumbered',
		defaultMessage: '{name} (copy {number, number})',
		description: 'Name importing a file into a universe\'s draft gives the universe when the file was exported from another universe and the name "{name} (copy)" is taken too; {number} counts up from 2 until a name is free'
	}
});

/**
 * The name importing a file gives the draft: the file's own for a file of the same universe, and for
 * another universe's, the first of "Kilnhaven (copy)", "Kilnhaven (copy 2)" and so on that no other
 * universe has, in the importing player's language and cut short to fit MAX_UNIVERSE_NAME_LENGTH
 *
 * @param file The file
 * @param universe The universe it is imported into, in its draft
 * @param translator The player's language
 * @param executor The snapshot
 * @return The name, or undefined to keep the draft's: the file has none, its name holds text that could
 * be made into a link (hasLinkLikeText()), or every name tried is taken
 */
async function importedName(file: ImportFile, universe: EditableUniverseDetails, translator: Translator, executor: Executor): Promise<string | undefined>
{
	const name = file.manifest.settings?.name;

	if ((typeof name !== 'string') || hasLinkLikeText(name))
	{
		return(undefined);
	}

	if (file.manifest.universe.id === universe.id)
	{
		return((((name === universe.name) || !await isUniverseNameTaken(name, universe.id, executor)) ? name : undefined));
	}

	for (let number = 1; number <= MAX_COPY_NUMBER; number++)
	{
		const copy = copyName(name, number, translator);

		if ((copy === universe.name) || !await isUniverseNameTaken(copy, universe.id, executor))
		{
			return(copy);
		}
	}

	return(undefined);
}

/**
 * A copy's name, with the universe's name cut short so the whole fits MAX_UNIVERSE_NAME_LENGTH
 *
 * @param name The universe's name
 * @param number Which copy: 1 for "(copy)", then "(copy 2)" and so on
 * @param translator The player's language
 * @return The name
 */
function copyName(name: string, number: number, translator: Translator): string
{
	const format = (base: string): string => ((number === 1) ? translator.format(copyNames.copy, { name: base }) : translator.format(copyNames.numbered, { name: base, number }));
	const characters = [...name];
	const over = ([...format(name)].length - MAX_UNIVERSE_NAME_LENGTH);

	return(((over > 0) ? format(characters.slice(0, Math.max(1, (characters.length - over))).join('').trim()) : format(name)));
}

/**
 * The universe text a version holds, as keys (textKey())
 *
 * @param version The version
 * @param universe The universe, in the version
 * @param executor The snapshot
 * @return The keys
 */
async function existingTexts(version: UniverseVersion, universe: EditableUniverseDetails, executor: Executor): Promise<Set<string>>
{
	const texts = new Set((await listThingNames(version, executor)).map((thing) => textKey(thing.kind, thing.thingId, 'name')));

	for (const key of universeTextKeys(universe.id, universe))
	{
		texts.add(key);
	}

	return(texts);
}

/**
 * The keys of the text a universe's settings hold: its name and the descriptions it has written, and
 * the names and abbreviations it gives its coins
 *
 * @param universeId The universe's ID
 * @param settings The settings
 * @return The keys
 */
function universeTextKeys(universeId: string, settings: Record<string, unknown>): string[]
{
	const keys = [textKey('universe', universeId, 'name')];

	for (const field of ['shortDescription', 'longDescription'])
	{
		if ((typeof settings[field] === 'string') && (settings[field] !== ''))
		{
			keys.push(textKey('universe', universeId, field));
		}
	}

	for (const [field, setting] of [['name', 'coinNames'], ['abbreviation', 'coinAbbreviations']] as const)
	{
		const coins = settings[setting];

		if ((typeof coins === 'object') && (coins !== null))
		{
			keys.push(...Object.keys(coins).map((coin) => textKey('coin', coin, field)));
		}
	}

	return(keys);
}

/**
 * How many chunks of an area cellsOf() reads at once
 */
const CHUNKS_PER_PAGE = 500;

/**
 * The stored chunks of each of a draft's areas
 *
 * @param areas The draft's areas
 * @param executor The snapshot
 * @return Each area's chunks' cells, by area and chunkKey()
 */
async function cellsOf(areas: readonly EditorArea[], executor: Executor): Promise<Map<string, Map<string, number[]>>>
{
	const cells = new Map<string, Map<string, number[]>>();

	for (const area of areas)
	{
		const chunks = new Map<string, number[]>();
		let after: { chunkColumn: number; chunkRow: number } | undefined;

		for (;;)
		{
			const page = await loadChunkPage(area.id, after, CHUNKS_PER_PAGE, executor);

			for (const chunk of page)
			{
				chunks.set(chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells);
			}

			if (page.length < CHUNKS_PER_PAGE)
			{
				break;
			}

			after = page[page.length - 1];
		}

		cells.set(area.id, chunks);
	}

	return(cells);
}

/**
 * The areas whose cells use each of a draft's own tiles
 *
 * @param version The draft
 * @param tiles The draft's tiles
 * @param executor The snapshot
 * @return The areas' IDs, by tile
 */
async function usageOf(version: UniverseVersion, tiles: readonly EditorTile[], executor: Executor): Promise<Map<number, string[]>>
{
	const usage = new Map<number, string[]>();

	for (const tile of tiles.filter((each) => each.custom))
	{
		usage.set(tile.id, (await findAreasUsingTile(version, tile.id, executor)).map((area) => area.id));
	}

	return(usage);
}

/**
 * Whether an import may keep some of the draft's areas: one that replaces the world but not the
 * settings, which may name areas the file doesn't have
 *
 * @param file The file
 * @param access The player's role in the editor
 * @return True when it may
 */
export function mayKeepAreas(file: ImportFile, access: EditorAccess): boolean
{
	return((file.manifest.areas !== undefined) && canEditWorld(access.role) && ((file.manifest.settings === undefined) || !canEditUniverseSettings(access.role)));
}

/**
 * Finds the draft's thing that one of the file's things is, in an export of the same universe
 */
class Matcher<Id extends number | string>
{
	private readonly byOrigin = new Map<Id, Id>();
	private readonly ids: Set<Id>;
	private readonly taken = new Set<Id>();

	/**
	 * @param draftIds The IDs of the draft's things of the kind
	 * @param origins The live row each was copied from, by its ID
	 * @param source Whether the file is of the same universe, whether of its draft, and for the draft, the
	 * live row each of its things was copied from, by the file's ID
	 */
	constructor(draftIds: Iterable<Id>, origins: ReadonlyMap<Id, Id>, private readonly source: { sameUniverse: boolean; fromDraft: boolean; liveIds: Record<string, Id> | undefined })
	{
		this.ids = new Set(draftIds);

		for (const [draftId, liveId] of origins)
		{
			this.byOrigin.set(liveId, draftId);
		}
	}

	/**
	 * The draft's thing one of the file's things is: the same row of the same draft, or the draft's copy
	 * of the live row it is, or was copied from
	 *
	 * @param fileId The thing's ID in the file
	 * @return The draft's thing's ID, or undefined for none
	 */
	find(fileId: Id): Id | undefined
	{
		if (!this.source.sameUniverse)
		{
			return(undefined);
		}

		if (this.source.fromDraft && this.ids.has(fileId))
		{
			return(fileId);
		}

		const liveId = (this.source.fromDraft ? (this.source.liveIds?.[String(fileId)] ?? fileId) : fileId);
		const found = this.byOrigin.get(liveId);

		return(((found !== undefined) && this.ids.has(found)) ? found : undefined);
	}

	/**
	 * As find(), taking the draft's thing for one of the file's, so no two of the file's things are
	 * matched with the same one
	 *
	 * @param fileId The thing's ID in the file
	 * @return The draft's thing's ID, or undefined for none
	 */
	take(fileId: Id): Id | undefined
	{
		const found = this.find(fileId);

		if ((found === undefined) || this.taken.has(found))
		{
			return(undefined);
		}

		this.taken.add(found);

		return(found);
	}
}

/**
 * The ID a target stands for, once the change making it is saved
 *
 * @param ids The IDs the save gave the things it made so far
 * @param target The target
 * @return The ID
 */
function savedNumber(ids: SavedIds, target: Target<number>): number
{
	if (typeof target === 'number')
	{
		return(target);
	}

	const id = ids.get(target);

	if (typeof id !== 'number')
	{
		throw new Error(`${target} wasn't made before a change naming it`);
	}

	return(id);
}

/**
 * The ID a target stands for, once the change making it is saved
 *
 * @param ids The IDs the save gave the things it made so far
 * @param target The target
 * @return The ID
 */
function savedString(ids: SavedIds, target: Target<string>): string
{
	if (!target.startsWith('new:'))
	{
		return(target);
	}

	const id = ids.get(target as NewRef);

	if (typeof id !== 'string')
	{
		throw new Error(`${target} wasn't made before a change naming it`);
	}

	return(id);
}

/**
 * Whether two areas' bounds are the same
 *
 * @param a One area's bounds
 * @param b The other's
 * @return True when they are
 */
function sameBounds(a: AreaBounds, b: AreaBounds): boolean
{
	return((a.minColumn === b.minColumn) && (a.minRow === b.minRow) && (a.maxColumn === b.maxColumn) && (a.maxRow === b.maxRow));
}

/**
 * Some of a thing's settings
 *
 * @param thing The thing, as the file holds it
 * @param fields The settings
 * @return The settings
 */
function pick(thing: Record<string, unknown>, fields: readonly string[]): Record<string, unknown>
{
	return(Object.fromEntries(fields.map((field) => [field, thing[field]])));
}

/**
 * Refuses a file whose content doesn't add up, such as a race naming an item the file doesn't have
 *
 * @param problem What is wrong, in English
 */
function refuseFile(problem: string): never
{
	throw new ImportProblem(importMessages.notAnExport, { problem });
}

/**
 * Makes the changes importing a file into a draft saves
 */
class ImportPlanner
{
	readonly changes: PendingChange[] = [];

	readonly counts: UniverseImportCounts = {
		areas: 0,
		tileGraphics: 0,
		tiles: 0,
		items: 0,
		races: 0,
		classes: 0,
		themes: 0,
		difficultyLevels: 0,
		translatorNotes: 0,
		noTranslation: 0,
		translations: 0
	};

	readonly leftOut = new Set<UniverseImportLeftOut>();
	readonly parts: UniverseImportPart[] = [];
	translationLanguages: string[] = [];
	tilesetUploads = 0;

	/**
	 * The name the import gives the draft, or undefined when it keeps the draft's
	 */
	newName: string | undefined;

	private readonly manifest: ImportManifest;
	private readonly ruleset: Ruleset;
	private readonly sameUniverse: boolean;
	private refs = 0;

	// Where each of the file's things goes in the draft, by its ID in the file
	private readonly graphicTargets = new Map<string, Target<string> | null>();
	private readonly tileTargets = new Map<number, Target<number>>();
	private readonly itemTargets = new Map<number, Target<number>>();
	private readonly areaTargets = new Map<string, Target<string>>();
	private readonly raceTargets = new Map<number, Target<number>>();
	private readonly classTargets = new Map<number, Target<number>>();
	private readonly themeTargets = new Map<number, Target<number>>();
	private readonly levelTargets = new Map<number, Target<number>>();

	// The draft's things the import deletes
	private readonly deleted = new Set<string>();

	// The universe text the draft holds once the import is saved, as text keys
	private readonly texts = new Set<string>();

	private readonly matchers: {
		tileGraphics: Matcher<string>;
		tiles: Matcher<number>;
		items: Matcher<number>;
		areas: Matcher<string>;
		races: Matcher<number>;
		classes: Matcher<number>;
		themes: Matcher<number>;
		difficultyLevels: Matcher<number>;
	};

	/**
	 * @param file The file
	 * @param target The draft it goes into
	 * @param access The player's role in the editor, and their languages
	 */
	constructor(private readonly file: ImportFile, private readonly target: ImportTarget, private readonly access: EditorAccess)
	{
		const { manifest } = file;
		const { origins } = target;
		const liveIds = manifest.liveIds;
		const source = {
			sameUniverse: (manifest.universe.id === target.universe.id),
			fromDraft: (manifest.universe.version === 'draft')
		};
		const custom = <T extends { id: number; key: string | null }>(things: readonly T[]): number[] => things
			.filter((thing) => (thing.key === null))
			.map((thing) => thing.id);

		this.manifest = manifest;
		this.ruleset = target.universe.ruleset;
		this.sameUniverse = source.sameUniverse;
		this.matchers = {
			tileGraphics: new Matcher(target.tileGraphics.map((graphic) => graphic.id), origins.tileGraphics, { ...source, liveIds: liveIds?.tileGraphics }),
			tiles: new Matcher(custom(target.tiles), origins.tiles, { ...source, liveIds: liveIds?.tiles }),
			items: new Matcher(custom(target.items), origins.items, { ...source, liveIds: liveIds?.items }),
			areas: new Matcher(target.areas.map((area) => area.id), origins.areas, { ...source, liveIds: liveIds?.areas }),
			races: new Matcher(custom(target.races), origins.races, { ...source, liveIds: liveIds?.races }),
			classes: new Matcher(custom(target.classes), origins.classes, { ...source, liveIds: liveIds?.classes }),
			themes: new Matcher(custom(target.themes), origins.themes, { ...source, liveIds: liveIds?.themes }),
			difficultyLevels: new Matcher(custom(target.difficultyLevels), origins.difficultyLevels, { ...source, liveIds: liveIds?.difficultyLevels })
		};
	}

	/**
	 * Plans the import, part by part, in the order the changes are saved: the world first, since the
	 * settings name its areas and items, then the settings, then deleting what the file doesn't have,
	 * then the universe text
	 */
	plan(): void
	{
		const { manifest } = this;
		const role = this.access.role;
		const settings = this.partPresent(SETTINGS_SECTIONS);
		const world = this.partPresent(WORLD_SECTIONS);
		const importsSettings = (settings && canEditUniverseSettings(role));
		const importsWorld = (world && canEditWorld(role));

		if ((manifest.editors !== undefined) || settings)
		{
			this.leftOut.add('universeOnly');
		}

		if (settings && !importsSettings)
		{
			this.leftOut.add('settingsRole');
		}

		if (world && !importsWorld)
		{
			this.leftOut.add('worldRole');
		}

		if (importsSettings)
		{
			this.parts.push('settings');
		}

		if (importsWorld)
		{
			this.parts.push('world');
			this.planGraphics();
			this.planTiles();
			this.planItems();
			this.planAreas();
		}

		if (importsSettings)
		{
			this.planSettings();
		}

		this.planDeletions(importsSettings, importsWorld);
		this.noteTexts(importsSettings, importsWorld);

		if (importsWorld)
		{
			this.planNotes();
		}

		this.planNoTranslation();
		this.planTranslations(importsSettings);
	}

	/**
	 * Whether the file holds a part, refusing one holding some of its sections without the others
	 *
	 * @param sections The part's sections
	 * @return True when it holds them
	 */
	private partPresent(sections: readonly (keyof ImportManifest)[]): boolean
	{
		const present = sections.filter((section) => (this.manifest[section] !== undefined));

		if ((present.length > 0) && (present.length < sections.length))
		{
			refuseFile(`${sections.filter((section) => !present.includes(section)).join(', ')} missing beside ${present.join(', ')}`);
		}

		return(present.length > 0);
	}

	/**
	 * A ref for a thing the import makes
	 *
	 * @param kind What it is
	 * @return The ref
	 */
	private newRef(kind: string): NewRef
	{
		this.refs++;

		return(`new:${kind}${this.refs}`);
	}

	/**
	 * Adds a change, checked as a save's would be
	 *
	 * @param change The change
	 * @param where What in the file it comes from, for the problem
	 */
	private add(change: Record<string, unknown>, where: string): void
	{
		this.changes.push(this.valid(change, where, (problem) => refuseFile(problem)));
	}

	/**
	 * Adds a change made once the changes before it are saved, checked as a save's would be when it is made
	 *
	 * @param make Makes the change from the IDs the save gave the things it made so far
	 * @param where What in the file it comes from, for the problem
	 */
	private addLater(make: (ids: SavedIds) => Record<string, unknown>, where: string): void
	{
		this.changes.push((ids) => this.valid(make(ids), where, (problem) =>
		{
			throw new ChangeRefusal({
				status: 400,
				message: importMessages.notAnExport,
				values: { problem }
			});
		}));
	}

	/**
	 * A change checked as a save's would be
	 *
	 * @param change The change
	 * @param where What in the file it comes from, for the problem
	 * @param refuse Refuses the change, given what is wrong with it
	 * @return The change as a save's is read
	 */
	private valid(change: Record<string, unknown>, where: string, refuse: (problem: string) => never): EditorChange
	{
		const result = editorChange[this.ruleset].safeParse(change);

		if (!result.success)
		{
			refuse(`${where}: ${describeInvalidPayload(result.error)}`);
		}

		return(result.data);
	}

	/**
	 * Uploads the file's tilesets the draft doesn't have, refusing the file when the draft has no room for
	 * them
	 */
	private planGraphics(): void
	{
		const uploads: { graphic: NonNullable<ImportManifest['tileGraphics']>[number]; image: Buffer }[] = [];

		for (const graphic of (this.manifest.tileGraphics ?? []))
		{
			const matched = this.matchers.tileGraphics.take(graphic.id);
			const image = this.file.images.get(graphic.id);

			if (matched !== undefined)
			{
				this.graphicTargets.set(graphic.id, matched);
				continue;
			}

			// A tileset whose image the export couldn't find leaves its tiles drawn in their colors
			if (!image)
			{
				this.graphicTargets.set(graphic.id, null);
				continue;
			}

			uploads.push({ graphic, image });
		}

		// The save uploads before it deletes the draft's tilesets the file doesn't have, so every one the
		// draft has counts towards the limit, as the save's transaction counts them
		if ((this.target.tileGraphics.length + uploads.length) > MAX_UPLOADED_TILE_GRAPHICS)
		{
			throw new ImportProblem(tileGraphicMessages.limit, {
				max: MAX_UPLOADED_TILE_GRAPHICS
			});
		}

		for (const { graphic, image } of uploads)
		{
			const ref = this.newRef('graphic');

			this.add({
				kind: 'uploadTileGraphic',
				ref,
				upload: {
					name: graphic.name,
					format: graphic.format,
					drawOrder: graphic.drawOrder,
					image: image.toString('base64'),
					rightsConfirmed: true
				}
			}, `tileset ${graphic.name}`);
			this.graphicTargets.set(graphic.id, ref);
			this.counts.tileGraphics++;
			this.tilesetUploads++;
		}
	}

	/**
	 * Adds, changes and restores the draft's tiles to the file's
	 */
	private planTiles(): void
	{
		const defaults = new Map(this.target.tiles
			.filter((tile) => (tile.key !== null))
			.map((tile) => [tile.key, tile]));

		for (const tile of (this.manifest.tiles ?? []))
		{
			const graphicId = tile.uploadedGraphicId;
			const settings = {
				...pick(tile, TILE_FIELDS),
				uploadedGraphicId: ((typeof graphicId === 'string') ? (this.graphicTargets.get(graphicId) ?? null) : null)
			};
			const where = `tile ${tile.id}`;

			if (tile.key !== null)
			{
				const found = defaults.get(tile.key);

				if (!found)
				{
					refuseFile(`${where} is the ruleset's tile ${tile.key}, which this site doesn't have`);
				}

				this.tileTargets.set(tile.id, found.id);

				if (tile.edited)
				{
					this.add({ kind: 'saveTile', id: found.id, settings }, where);
					this.counts.tiles++;
				}
				else if (found.edited)
				{
					this.add({ kind: 'removeTile', id: found.id, replaceWith: null }, where);
				}

				continue;
			}

			const matched = this.matchers.tiles.take(tile.id);
			const ref = ((matched === undefined) ? this.newRef('tile') : undefined);

			this.add(((ref === undefined) ? { kind: 'saveTile', id: matched, settings } : { kind: 'createTile', ref, settings }), where);
			this.tileTargets.set(tile.id, (ref ?? matched as number));
			this.counts.tiles++;
		}
	}

	/**
	 * Adds, changes and restores the draft's items to the file's
	 */
	private planItems(): void
	{
		const defaults = new Map(this.target.items
			.filter((item) => (item.key !== null))
			.map((item) => [item.key, item]));

		for (const item of (this.manifest.items ?? []))
		{
			const settings = pick(item, ITEM_FIELDS);
			const where = `item ${item.id}`;

			if (item.key !== null)
			{
				const found = defaults.get(item.key);

				if (!found)
				{
					refuseFile(`${where} is the ruleset's item ${item.key}, which this site doesn't have`);
				}

				this.itemTargets.set(item.id, found.id);

				if (item.edited)
				{
					this.add({ kind: 'saveItem', id: found.id, settings }, where);
					this.counts.items++;
				}
				else if (found.edited)
				{
					this.add({ kind: 'removeItem', id: found.id }, where);
				}

				continue;
			}

			const matched = this.matchers.items.take(item.id);
			const ref = ((matched === undefined) ? this.newRef('item') : undefined);

			this.add(((ref === undefined) ? { kind: 'saveItem', id: matched, settings } : { kind: 'createItem', ref, settings }), where);
			this.itemTargets.set(item.id, (ref ?? matched as number));
			this.counts.items++;
		}
	}

	/**
	 * Adds and changes the draft's areas to the file's, with their cells and links. A matched area is
	 * compared with the file's, so only what differs is changed and recorded: its bounds, the cells that
	 * hold another tile, and the links that go elsewhere, are new or are gone
	 */
	private planAreas(): void
	{
		const areas = (this.manifest.areas ?? []);
		const draftAreas = new Map(this.target.areas.map((area) => [area.id, area]));

		// The bounds each matched area has once the import is saved, by its ID in the draft
		const bounds = new Map<string, AreaBounds>();

		for (const area of areas)
		{
			const matched = this.matchers.areas.take(area.id);

			if (matched === undefined)
			{
				const ref = this.newRef('area');

				this.add({
					kind: 'createArea',
					ref,
					area: {
						...pick(area, AREA_FIELDS),
						defaultTileId: this.tileTarget(area.defaultTileId, `area ${area.id}`)
					}
				}, `area ${area.id}`);
				this.areaTargets.set(area.id, ref);
			}
			else
			{
				bounds.set(matched, area.bounds);
				this.areaTargets.set(area.id, matched);
			}

			this.counts.areas++;
		}

		for (const area of areas)
		{
			const target = this.areaTarget(area.id, `area ${area.id}`);
			const where = `area ${area.id}`;
			const parentAreaId = ((area.parentAreaId === null) ? null : this.areaTarget(area.parentAreaId, where));
			const draftArea = draftAreas.get(target);

			// The save records only the settings that differ
			if (draftArea)
			{
				this.add({
					kind: 'updateArea',
					areaId: target,
					update: {
						...pick(area, AREA_FIELDS),
						defaultTileId: this.tileTarget(area.defaultTileId, where),
						parentAreaId
					}
				}, where);
			}
			else if (parentAreaId !== null)
			{
				this.add({ kind: 'updateArea', areaId: target, update: { parentAreaId } }, where);
			}

			// Making an area smaller discards its cells and links outside the new bounds, and links into them
			if (!sameBounds((draftArea?.bounds ?? NEW_AREA_BOUNDS), area.bounds))
			{
				this.add({ kind: 'resizeArea', areaId: target, bounds: area.bounds, discard: true }, where);
			}

			if (draftArea)
			{
				this.planChangedCells(area.id, draftArea, area.bounds);
			}
			else
			{
				this.planCells(area.id, target, area.bounds);
			}
		}

		this.planLinks(bounds);
	}

	/**
	 * Saves the file's links that the draft doesn't have as they are, and deletes the matched areas'
	 * links the file doesn't have, leaving out those making an area smaller already deleted
	 *
	 * @param bounds The bounds each matched area has once the import is saved, by its ID in the draft
	 */
	private planLinks(bounds: ReadonlyMap<string, AreaBounds>): void
	{
		const kept = new Map<string, EditorAreaLink & { areaId: string }>();

		for (const link of this.target.links.filter((each) => bounds.has(each.areaId)))
		{
			const own = bounds.get(link.areaId);
			const target = bounds.get(link.targetAreaId);

			if ((!own || isInBounds(own, link.column, link.row)) && (!target || isInBounds(target, link.targetColumn, link.targetRow)))
			{
				kept.set(`${link.areaId}:${link.column}:${link.row}`, link);
			}
		}

		const saved = new Set<string>();

		for (const area of (this.manifest.areas ?? []))
		{
			const where = `area ${area.id}`;
			const areaId = this.areaTarget(area.id, where);

			for (const link of area.links)
			{
				const key = `${areaId}:${link.column}:${link.row}`;
				const draftLink = kept.get(key);
				const target = {
					targetAreaId: this.areaTarget(link.targetAreaId, where),
					targetColumn: link.targetColumn,
					targetRow: link.targetRow,
					mode: link.mode,
					requiresWholeGroup: link.requiresWholeGroup
				};

				saved.add(key);

				if (draftLink && (draftLink.targetAreaId === target.targetAreaId) && (draftLink.targetColumn === target.targetColumn) && (draftLink.targetRow === target.targetRow) && (draftLink.mode === target.mode) && (draftLink.requiresWholeGroup === target.requiresWholeGroup))
				{
					continue;
				}

				this.add({ kind: 'saveLink', areaId, column: link.column, row: link.row, target }, where);
			}
		}

		for (const [key, link] of kept)
		{
			if (!saved.has(key))
			{
				this.add({ kind: 'deleteLink', areaId: link.areaId, column: link.column, row: link.row }, `area ${link.areaId}`);
			}
		}
	}

	/**
	 * Paints the cells of a matched area that hold something other than the file has, MAX_CELL_CHANGES at
	 * a time, comparing the file's chunks with the draft's inside the area's new bounds. A cell the area
	 * grows to include holds the default tile
	 *
	 * @param fileAreaId The area's ID in the file
	 * @param draftArea The draft's area, as it was before the import
	 * @param bounds Its bounds once the import is saved
	 */
	private planChangedCells(fileAreaId: string, draftArea: EditorArea, bounds: AreaBounds): void
	{
		const where = `area ${fileAreaId}'s cells`;
		const fileChunks = new Map((this.file.cells.get(fileAreaId)?.chunks ?? []).map((chunk) => [chunkKey(chunk.chunkColumn, chunk.chunkRow), chunk.cells]));
		const draftChunks = (this.target.areaCells.get(draftArea.id) ?? new Map<string, number[]>());
		const changes: [number, number, Target<number>][] = [];

		for (const key of new Set([...fileChunks.keys(), ...draftChunks.keys()]))
		{
			const { chunkColumn, chunkRow } = parseChunkKey(key);
			const fileCells = fileChunks.get(key);
			const draftCells = draftChunks.get(key);

			for (let cell = 0; cell < (CHUNK_SIZE * CHUNK_SIZE); cell++)
			{
				const column = ((chunkColumn * CHUNK_SIZE) + (cell % CHUNK_SIZE));
				const row = ((chunkRow * CHUNK_SIZE) + Math.floor(cell / CHUNK_SIZE));

				if (!isInBounds(bounds, column, row))
				{
					continue;
				}

				const value = (fileCells?.[cell] ?? DEFAULT_TILE_CELL);
				const wanted = (((value === DEFAULT_TILE_CELL) || (value === VOID_CELL)) ? value : this.tileTarget(value, where));
				const current = (isInBounds(draftArea.bounds, column, row) ? (draftCells?.[cell] ?? DEFAULT_TILE_CELL) : DEFAULT_TILE_CELL);

				if (wanted !== current)
				{
					changes.push([column, row, wanted]);
				}
			}
		}

		for (let start = 0; start < changes.length; start += MAX_CELL_CHANGES)
		{
			const batch = changes.slice(start, (start + MAX_CELL_CHANGES));

			this.addLater((ids) => ({
				kind: 'editCells',
				areaId: draftArea.id,
				changes: batch.map(([column, row, value]) => [column, row, savedNumber(ids, value)])
			}), where);
		}
	}

	/**
	 * Paints a new area's cells as the file has them, MAX_CELL_CHANGES at a time, each made as it is
	 * saved so the import never holds every cell's change at once. Only cells other than the default tile
	 * are painted, as a new area holds nothing else
	 *
	 * @param fileAreaId The area's ID in the file
	 * @param target The area in the draft
	 * @param bounds Its bounds
	 */
	private planCells(fileAreaId: string, target: Target<string>, bounds: AreaBounds): void
	{
		const cells = this.file.cells.get(fileAreaId);
		const inBounds = (column: number, row: number): boolean => isInBounds(bounds, column, row);
		// Each change's chunks, by their place in the file's list
		const batches: number[][] = [];
		let batch: number[] = [];
		let size = 0;

		for (const [index, chunk] of (cells?.chunks ?? []).entries())
		{
			let painted = 0;

			for (const [cell, value] of chunk.cells.entries())
			{
				const column = ((chunk.chunkColumn * CHUNK_SIZE) + (cell % CHUNK_SIZE));
				const row = ((chunk.chunkRow * CHUNK_SIZE) + Math.floor(cell / CHUNK_SIZE));

				if (!inBounds(column, row) || (value === DEFAULT_TILE_CELL))
				{
					continue;
				}

				if ((value !== VOID_CELL) && !this.tileTargets.has(value))
				{
					refuseFile(`area ${fileAreaId}'s cells name tile ${value}, which the file doesn't list`);
				}

				painted++;
			}

			if (painted === 0)
			{
				continue;
			}

			if ((batch.length > 0) && ((size + painted) > MAX_CELL_CHANGES))
			{
				batches.push(batch);
				batch = [];
				size = 0;
			}

			batch.push(index);
			size += painted;
		}

		if (batch.length > 0)
		{
			batches.push(batch);
		}

		for (const chunks of batches)
		{
			this.addLater((ids) => ({
				kind: 'editCells',
				areaId: savedString(ids, target),
				changes: chunks.flatMap((chunk) => this.cellChanges(cells?.chunks[chunk], inBounds, ids))
			}), `area ${fileAreaId}'s cells`);
		}
	}

	/**
	 * One chunk's painted cells as an editCells change's
	 *
	 * @param chunk The chunk, as the file has it
	 * @param inBounds Whether a cell is inside the area
	 * @param ids The IDs the save gave the things it made so far, such as tiles
	 * @return Each painted cell's column, row and tile
	 */
	private cellChanges(chunk: { chunkColumn: number; chunkRow: number; cells: number[] } | undefined, inBounds: (column: number, row: number) => boolean, ids: SavedIds): [number, number, number][]
	{
		const changes: [number, number, number][] = [];

		for (const [cell, value] of (chunk?.cells ?? []).entries())
		{
			const column = (((chunk?.chunkColumn ?? 0) * CHUNK_SIZE) + (cell % CHUNK_SIZE));
			const row = (((chunk?.chunkRow ?? 0) * CHUNK_SIZE) + Math.floor(cell / CHUNK_SIZE));

			if ((value !== DEFAULT_TILE_CELL) && inBounds(column, row))
			{
				changes.push([column, row, ((value === VOID_CELL) ? VOID_CELL : savedNumber(ids, this.tileTarget(value, 'cells')))]);
			}
		}

		return(changes);
	}

	/**
	 * Changes the universe's settings, the Ruleset tab's, the difficulty levels, races, classes and themes
	 * to the file's. The lobby goes last, once nothing starts in the area that becomes it, and is taken
	 * away first, so no starting area is refused for being the lobby on the way
	 */
	private planSettings(): void
	{
		const settings = (this.manifest.settings ?? {});
		const { universe, name } = this.target;
		const startingItems = this.itemQuantities(settings.startingItems, 'settings');
		const startingAreaId = ((typeof settings.startingAreaId === 'string') ? this.areaTarget(settings.startingAreaId, 'settings') : null);
		const lobbyAreaId = ((typeof settings.lobbyAreaId === 'string') ? this.areaTarget(settings.lobbyAreaId, 'settings') : null);

		if ((name === undefined) && (typeof settings.name === 'string'))
		{
			this.leftOut.add((hasLinkLikeText(settings.name) ? 'nameLinkLike' : 'nameTaken'));
		}

		this.newName = name;

		// A lobby moving to another area is taken away while the starting areas change, and set last
		const lobbyMoves = (lobbyAreaId !== universe.lobbyAreaId);

		if (lobbyMoves && (universe.lobbyAreaId !== null))
		{
			this.add({ kind: 'universe', update: { lobbyAreaId: null } }, 'settings');
		}

		this.addLater((ids) => ({
			kind: 'universe',
			update: {
				...pick(settings, UNIVERSE_FIELDS),
				...((name === undefined) ? {} : { name }),
				startingItems: startingItems.map(({ itemId, quantity }) => ({ itemId: savedNumber(ids, itemId), quantity })),
				startingAreaId: ((startingAreaId === null) ? null : savedString(ids, startingAreaId))
			}
		}), 'settings');
		this.add({ kind: 'ruleset', settings: this.manifest.rulesetSettings }, 'ruleset settings');
		this.planDifficultyLevels();
		this.planRaces();
		this.planClasses();
		this.planThemes();

		if ((lobbyAreaId !== null) && (lobbyMoves || (settings.lobbyColumn !== universe.lobbyColumn) || (settings.lobbyRow !== universe.lobbyRow)))
		{
			this.addLater((ids) => ({
				kind: 'universe',
				update: {
					lobbyAreaId: savedString(ids, lobbyAreaId),
					lobbyColumn: settings.lobbyColumn,
					lobbyRow: settings.lobbyRow
				}
			}), 'settings');
		}
	}

	/**
	 * Adds and changes the draft's difficulty levels to the file's, its default first, which takes over
	 * from the draft's
	 */
	private planDifficultyLevels(): void
	{
		const byKey = new Map(this.target.difficultyLevels
			.filter((level) => (level.key !== null))
			.map((level) => [level.key, level.id]));
		const levels = [...(this.manifest.difficultyLevels ?? [])].sort((a, b) => (Number(b.isDefault) - Number(a.isDefault)));

		for (const level of levels)
		{
			const where = `difficulty level ${level.id}`;
			const matched = ((level.key === null) ? this.matchers.difficultyLevels.take(level.id) : byKey.get(level.key));
			const settings = pick(level, LEVEL_FIELDS);

			if (matched !== undefined)
			{
				this.add({ kind: 'saveDifficultyLevel', id: matched, settings }, where);
				this.levelTargets.set(level.id, matched);
			}
			else
			{
				const ref = this.newRef('level');
				const defaultName = ((level.key === null) ? undefined : DIFFICULTY_LEVEL_NAMES[level.key]?.defaultMessage);

				// A default level the draft no longer has comes back as one of the universe's own, named as it was
				this.add({ kind: 'createDifficultyLevel', ref, settings: { ...settings, name: (settings.name ?? defaultName ?? level.key) } }, where);
				this.levelTargets.set(level.id, ref);
			}

			this.counts.difficultyLevels++;
		}
	}

	/**
	 * Adds, changes and restores the draft's races to the file's, the enabled ones first, so the draft
	 * always has an enabled race
	 */
	private planRaces(): void
	{
		this.planOptions('Race', 'race', (this.manifest.races ?? []), this.target.races, this.matchers.races, this.raceTargets, (race, ids) => ({
			...pick(race, OPTION_FIELDS),
			...this.startingExtras(race, `race ${race.id}`, ids)
		}));
	}

	/**
	 * Adds, changes and restores the draft's classes to the file's, the enabled ones first, with where
	 * each class's characters of each race start
	 */
	private planClasses(): void
	{
		this.planOptions('Class', 'class', (this.manifest.classes ?? []), this.target.classes, this.matchers.classes, this.classTargets, (option, ids) => ({
			...pick(option, OPTION_FIELDS),
			...this.startingExtras(option, `class ${option.id}`, ids),
			raceAreas: (Array.isArray(option.raceAreas) ? option.raceAreas : []).map((raceArea: unknown) =>
			{
				const entry = ((typeof raceArea === 'object') && (raceArea !== null)) ? raceArea as Record<string, unknown> : {};
				const raceId = ((typeof entry.raceId === 'number') ? this.raceTargets.get(entry.raceId) : undefined);

				if ((raceId === undefined) || (typeof entry.areaId !== 'string'))
				{
					throw new ChangeRefusal({
						status: 400,
						message: importMessages.notAnExport,
						values: { problem: `class ${option.id} names a race or area the file doesn't list` }
					});
				}

				return({
					raceId: savedNumber(ids, raceId),
					areaId: savedString(ids, this.areaTarget(entry.areaId, `class ${option.id}`)),
					column: entry.column,
					row: entry.row
				});
			})
		}));
	}

	/**
	 * Adds, changes and restores the draft's themes to the file's, the enabled ones first
	 */
	private planThemes(): void
	{
		this.planOptions('Theme', 'theme', (this.manifest.themes ?? []), this.target.themes, this.matchers.themes, this.themeTargets, (theme) => pick(theme, THEME_FIELDS));
	}

	/**
	 * Adds, changes and restores the draft's races, classes or themes to the file's, the enabled ones
	 * first. One of the ruleset's defaults is matched by its key: edited in the file, it is saved with the
	 * file's settings, and otherwise restored if the draft edited it
	 *
	 * @param name The kinds' name in the changes' kinds, e.g. Race
	 * @param kind What they are, for refs and problems
	 * @param fileThings The file's
	 * @param draftThings The draft's
	 * @param matcher Finds the draft's own that the file's are
	 * @param targets Where each of the file's goes
	 * @param settingsOf A thing's settings, once the changes before it are saved
	 */
	private planOptions<T extends { id: number; key: string | null; edited: boolean; enabled?: unknown }>(name: 'Race' | 'Class' | 'Theme', kind: string, fileThings: readonly T[], draftThings: readonly { id: number; key: string | null; edited: boolean }[], matcher: Matcher<number>, targets: Map<number, Target<number>>, settingsOf: (thing: T, ids: SavedIds) => Record<string, unknown>): void
	{
		const defaults = new Map(draftThings
			.filter((thing) => (thing.key !== null))
			.map((thing) => [thing.key, thing]));
		const ordered = [...fileThings].sort((a, b) => (Number(b.enabled === true) - Number(a.enabled === true)));

		// Every target first, since a class names races, and races and classes may come in any order
		for (const thing of ordered)
		{
			if (thing.key !== null)
			{
				const found = defaults.get(thing.key);

				if (!found)
				{
					refuseFile(`${kind} ${thing.id} is the ruleset's ${kind} ${thing.key}, which this site doesn't have`);
				}

				targets.set(thing.id, found.id);
			}
			else
			{
				targets.set(thing.id, (matcher.take(thing.id) ?? this.newRef(kind)));
			}
		}

		for (const thing of ordered)
		{
			const where = `${kind} ${thing.id}`;
			const target = targets.get(thing.id) ?? refuseFile(where);

			if (thing.key !== null)
			{
				if (thing.edited)
				{
					this.addLater((ids) => ({ kind: `save${name}`, id: target, settings: settingsOf(thing, ids) }), where);
					this.count(kind);
				}
				else if (defaults.get(thing.key)?.edited)
				{
					this.add({ kind: `remove${name}`, id: target }, where);
				}

				continue;
			}

			this.addLater((ids) => ((typeof target === 'number')
				? { kind: `save${name}`, id: target, settings: settingsOf(thing, ids) }
				: { kind: `create${name}`, ref: target, settings: settingsOf(thing, ids) }), where);
			this.count(kind);
		}
	}

	/**
	 * Counts one of the races, classes or themes the import brings in
	 *
	 * @param kind race, class or theme
	 */
	private count(kind: string): void
	{
		switch (kind)
		{
			case 'race':
				this.counts.races++;
				break;

			case 'class':
				this.counts.classes++;
				break;

			default:
				this.counts.themes++;
		}
	}

	/**
	 * A race's or class's starting equipment and starting area, naming the draft's things
	 *
	 * @param option The race or class, as the file has it
	 * @param where What it is, for the problem
	 * @param ids The IDs the save gave the things it made so far
	 * @return The settings
	 */
	private startingExtras(option: Record<string, unknown>, where: string, ids: SavedIds): Record<string, unknown>
	{
		return({
			startingItems: this.itemQuantities(option.startingItems, where).map(({ itemId, quantity }) => ({ itemId: savedNumber(ids, itemId), quantity })),
			startingAreaId: ((typeof option.startingAreaId === 'string') ? savedString(ids, this.areaTarget(option.startingAreaId, where)) : null)
		});
	}

	/**
	 * Starting equipment naming the draft's items
	 *
	 * @param value The equipment, as the file has it
	 * @param where What it belongs to, for the problem
	 * @return The equipment
	 */
	private itemQuantities(value: unknown, where: string): { itemId: Target<number>; quantity: unknown }[]
	{
		return((Array.isArray(value) ? value : []).map((entry: unknown) =>
		{
			const quantity = (((typeof entry === 'object') && (entry !== null)) ? entry as Record<string, unknown> : {});

			if (typeof quantity.itemId !== 'number')
			{
				refuseFile(`${where} has starting equipment without an item`);
			}

			return({
				itemId: this.itemTarget(quantity.itemId, where),
				quantity: quantity.quantity
			});
		}));
	}

	/**
	 * Where one of the file's tiles is in the draft
	 *
	 * @param fileId Its ID in the file
	 * @param where What names it, for the problem
	 * @return The tile
	 */
	private tileTarget(fileId: number, where: string): Target<number>
	{
		return(this.tileTargets.get(fileId) ?? refuseFile(`${where} names tile ${fileId}, which the file doesn't list`));
	}

	/**
	 * Where one of the file's items is in the draft
	 *
	 * @param fileId Its ID in the file
	 * @param where What names it, for the problem
	 * @return The item
	 */
	private itemTarget(fileId: number, where: string): Target<number>
	{
		return(this.itemTargets.get(fileId) ?? this.existing('item', fileId) ?? refuseFile(`${where} names item ${fileId}, which the file doesn't list`));
	}

	/**
	 * Where one of the file's areas is in the draft
	 *
	 * @param fileId Its ID in the file
	 * @param where What names it, for the problem
	 * @return The area
	 */
	private areaTarget(fileId: string, where: string): Target<string>
	{
		return(this.areaTargets.get(fileId) ?? this.existing('area', fileId) ?? refuseFile(`${where} names area ${fileId}, which the file doesn't list`));
	}

	/**
	 * The draft's thing one of the file's things is, for the parts the import doesn't replace: the same
	 * thing in an export of the same universe
	 *
	 * @param kind What it is
	 * @param fileId Its ID in the file
	 * @return Its ID in the draft, or undefined when the draft doesn't have it
	 */
	private existing<Id extends number | string>(kind: 'item' | 'area' | 'tile' | 'race' | 'class' | 'theme' | 'difficultyLevel', fileId: Id): Id | undefined
	{
		if (!this.sameUniverse)
		{
			return(undefined);
		}

		const lists: Record<typeof kind, { ids: readonly (number | string)[]; matcher: Matcher<number> | Matcher<string> }> = {
			item: { ids: this.target.items.map((each) => each.id), matcher: this.matchers.items },
			area: { ids: this.target.areas.map((each) => each.id), matcher: this.matchers.areas },
			tile: { ids: this.target.tiles.map((each) => each.id), matcher: this.matchers.tiles },
			race: { ids: this.target.races.map((each) => each.id), matcher: this.matchers.races },
			class: { ids: this.target.classes.map((each) => each.id), matcher: this.matchers.classes },
			theme: { ids: this.target.themes.map((each) => each.id), matcher: this.matchers.themes },
			difficultyLevel: { ids: this.target.difficultyLevels.map((each) => each.id), matcher: this.matchers.difficultyLevels }
		};
		const { ids, matcher } = lists[kind];

		// The ruleset's defaults have the same IDs in every version of the universe
		if ((typeof fileId === 'number') && ids.includes(fileId) && ((kind === 'area') || this.isDefault(kind, fileId)))
		{
			return(fileId);
		}

		return((matcher as Matcher<Id>).find(fileId));
	}

	/**
	 * Whether one of the draft's tiles, items, races, classes or themes is one of the ruleset's defaults
	 *
	 * @param kind What it is
	 * @param id Its ID
	 * @return True for a default
	 */
	private isDefault(kind: string, id: number): boolean
	{
		const lists: Record<string, readonly { id: number; key: string | null }[]> = {
			tile: this.target.tiles,
			item: this.target.items,
			race: this.target.races,
			class: this.target.classes,
			theme: this.target.themes
		};

		return((lists[kind] ?? []).some((thing) => ((thing.id === id) && (thing.key !== null))));
	}

	/**
	 * Deletes the draft's things the file doesn't have, in the parts the import replaces: classes before
	 * the races they name, areas before the tiles their cells hold, tiles before the tilesets they are
	 * drawn with. An import that doesn't replace the settings keeps the areas and items the settings name,
	 * and the tiles those areas use
	 *
	 * @param settings Whether the import replaces the settings
	 * @param world Whether it replaces the world
	 */
	private planDeletions(settings: boolean, world: boolean): void
	{
		const { target } = this;

		if (settings)
		{
			this.deleteUnmatched('class', target.classes, this.classTargets, (id) => ({ kind: 'removeClass', id }));
			this.deleteUnmatched('race', target.races, this.raceTargets, (id) => ({ kind: 'removeRace', id }));
			this.deleteUnmatched('theme', target.themes, this.themeTargets, (id) => ({ kind: 'removeTheme', id }));
			this.deleteUnmatched('difficultyLevel', target.difficultyLevels, this.levelTargets, (id) => ({ kind: 'removeDifficultyLevel', id }));
		}

		if (!world)
		{
			return;
		}

		const keptAreas = new Set<string>();
		const keptItems = new Set<number>();
		const keptTiles = new Set<number>();
		const keptGraphics = new Set<string>();
		const areaTargets = new Set(this.areaTargets.values());

		if (!settings)
		{
			for (const areaId of [target.universe.lobbyAreaId, target.universe.startingAreaId, ...target.startingAreaIds])
			{
				if ((areaId !== null) && !areaTargets.has(areaId))
				{
					keptAreas.add(areaId);
				}
			}

			for (const { itemId } of [...target.universe.startingItems, ...target.races.flatMap((race) => race.startingItems), ...target.classes.flatMap((each) => each.startingItems)])
			{
				keptItems.add(itemId);
			}
		}

		for (const area of target.areas.filter((each) => keptAreas.has(each.id)))
		{
			keptTiles.add(area.defaultTileId);
		}

		for (const [tileId, areaIds] of target.tileUsage)
		{
			if (areaIds.some((areaId) => keptAreas.has(areaId)))
			{
				keptTiles.add(tileId);
			}
		}

		for (const tile of target.tiles.filter((each) => keptTiles.has(each.id)))
		{
			if (tile.uploadedGraphicId !== null)
			{
				keptGraphics.add(tile.uploadedGraphicId);
			}
		}

		const itemTargets = new Set(this.itemTargets.values());

		if ((keptAreas.size > 0) || [...keptItems].some((itemId) => !itemTargets.has(itemId)))
		{
			this.leftOut.add('keptForSettings');
		}

		for (const area of target.areas.filter((each) => (!areaTargets.has(each.id) && !keptAreas.has(each.id))))
		{
			this.add({ kind: 'deleteArea', areaId: area.id }, `the draft's area ${area.name}`);
			this.deleted.add(textKey('area', area.id, 'name'));
		}

		this.deleteUnmatched('item', target.items.filter((item) => !keptItems.has(item.id)), this.itemTargets, (id) => ({ kind: 'removeItem', id }));
		this.deleteUnmatched('tile', target.tiles.filter((tile) => !keptTiles.has(tile.id)), this.tileTargets, (id) => ({ kind: 'removeTile', id, replaceWith: null }));

		const graphicTargets = new Set(this.graphicTargets.values());

		for (const graphic of target.tileGraphics.filter((each) => (!graphicTargets.has(each.id) && !keptGraphics.has(each.id))))
		{
			this.add({ kind: 'deleteTileGraphic', graphicId: graphic.id }, `the draft's tileset ${graphic.name}`);
		}
	}

	/**
	 * Deletes the universe's own things of a kind that no thing in the file is
	 *
	 * @param kind What they are
	 * @param things The draft's things of the kind
	 * @param targets Where each of the file's things of the kind goes
	 * @param change The change deleting one
	 */
	private deleteUnmatched(kind: UniverseTextKind, things: readonly { id: number; key: string | null }[], targets: ReadonlyMap<number, Target<number>>, change: (id: number) => Record<string, unknown>): void
	{
		const kept = new Set(targets.values());

		for (const thing of things.filter((each) => ((each.key === null) && !kept.has(each.id))))
		{
			this.add(change(thing.id), `the draft's ${kind} ${thing.id}`);
			this.deleted.add(textKey(kind, String(thing.id), 'name'));
		}
	}

	/**
	 * Works out the universe text the draft holds once the import is saved, which the notes, marks and
	 * translations may name: for the parts it replaces, the file's, and for the rest, the draft's
	 *
	 * @param settings Whether the import replaces the settings
	 * @param world Whether it replaces the world
	 */
	private noteTexts(settings: boolean, world: boolean): void
	{
		const { manifest, target } = this;
		const replaced: Record<string, boolean> = {
			universe: settings,
			coin: settings,
			race: settings,
			class: settings,
			theme: settings,
			difficultyLevel: settings,
			area: world,
			tile: world,
			item: world
		};

		for (const key of target.texts)
		{
			if (!replaced[key.split(':')[0]] && !this.deleted.has(key))
			{
				this.texts.add(key);
			}
		}

		if (settings)
		{
			for (const key of universeTextKeys(target.universe.id, (manifest.settings ?? {})))
			{
				this.texts.add(key);
			}

			this.noteNames('race', (manifest.races ?? []), this.raceTargets);
			this.noteNames('class', (manifest.classes ?? []), this.classTargets);
			this.noteNames('theme', (manifest.themes ?? []), this.themeTargets);
			this.noteNames('difficultyLevel', (manifest.difficultyLevels ?? []), this.levelTargets);
		}

		if (world)
		{
			this.noteNames('tile', (manifest.tiles ?? []), this.tileTargets);
			this.noteNames('item', (manifest.items ?? []), this.itemTargets);

			for (const area of (manifest.areas ?? []))
			{
				this.texts.add(textKey('area', String(this.areaTargets.get(area.id)), 'name'));
			}
		}
	}

	/**
	 * Notes the names of the file's things of a kind as universe text, for those that have one: the
	 * universe's own things, and the ruleset's defaults it renamed
	 *
	 * @param kind What they are
	 * @param things The file's things of the kind
	 * @param targets Where each goes
	 */
	private noteNames(kind: UniverseTextKind, things: readonly Record<string, unknown>[], targets: ReadonlyMap<number, Target<number>>): void
	{
		for (const thing of things)
		{
			const target = ((typeof thing.id === 'number') ? targets.get(thing.id) : undefined);

			if ((target !== undefined) && (typeof thing.name === 'string'))
			{
				this.texts.add(textKey(kind, String(target), 'name'));
			}
		}
	}

	/**
	 * The draft's piece of text one of the file's names, once the import is saved, for text it holds then
	 *
	 * @param ref The file's piece of text
	 * @return Its kind, the draft's thing (or the ref making it) and its field, or undefined when the draft
	 * won't hold it
	 */
	private textTarget(ref: UniverseTextRef): { kind: UniverseTextKind; thingId: string | number; field: UniverseTextRef['field'] } | undefined
	{
		const { kind, thingId, field } = ref;

		// A thing's ID in the draft, or the ref of the change making it
		let target: string | number | undefined;

		if (!UNIVERSE_TEXT_KIND_FIELDS[kind].includes(field))
		{
			return(undefined);
		}

		switch (kind)
		{
			case 'universe':
				target = ((thingId === this.manifest.universe.id) ? this.target.universe.id : undefined);
				break;

			case 'coin':
				target = (RULESET_COINS[this.ruleset].some((coin) => (coin === thingId)) ? thingId : undefined);
				break;

			case 'area':
				target = (this.areaTargets.get(thingId) ?? this.existing('area', thingId));
				break;

			default:
			{
				const id = Number(thingId);
				const targets: Record<string, ReadonlyMap<number, Target<number>>> = {
					tile: this.tileTargets,
					item: this.itemTargets,
					race: this.raceTargets,
					class: this.classTargets,
					theme: this.themeTargets,
					difficultyLevel: this.levelTargets
				};

				target = (Number.isInteger(id) ? (targets[kind].get(id) ?? this.existing(kind, id)) : undefined);
			}
		}

		if ((target === undefined) || !this.texts.has(textKey(kind, String(target), field)))
		{
			return(undefined);
		}

		return({ kind, thingId: target, field });
	}

	/**
	 * Saves the file's notes for translators the draft doesn't have as they are, and deletes the draft's
	 * the file doesn't have
	 */
	private planNotes(): void
	{
		const written = new Set<string>();
		const draftNotes = new Map(this.target.notes.map((note) => [textKey(note.kind, note.thingId, note.field), note.note]));

		for (const note of (this.manifest.translatorNotes ?? []))
		{
			const text = this.textTarget(note);

			if (text)
			{
				const key = textKey(text.kind, String(text.thingId), text.field);

				written.add(key);
				this.counts.translatorNotes++;

				if (draftNotes.get(key) !== note.note)
				{
					this.addLater((ids) => ({ kind: 'saveTranslatorNote', text: this.savedText(ids, text), note: note.note }), 'notes for translators');
				}
			}
		}

		for (const note of this.target.notes.filter((each) => (each.note !== null)))
		{
			const key = textKey(note.kind, note.thingId, note.field);

			if (!written.has(key) && this.texts.has(key))
			{
				this.add({ kind: 'saveTranslatorNote', text: { kind: note.kind, thingId: note.thingId, field: note.field }, note: null }, 'the draft\'s notes for translators');
			}
		}
	}

	/**
	 * Marks the file's text needing no translation that the draft doesn't mark, and unmarks the draft's
	 * the file doesn't mark
	 */
	private planNoTranslation(): void
	{
		const marks = this.manifest.noTranslation;

		if (marks === undefined)
		{
			return;
		}

		if (!canMarkNoTranslation(this.access))
		{
			this.leftOut.add('noTranslationRole');
			return;
		}

		const marked = new Set<string>();
		const draftMarked = new Set(this.target.notes
			.filter((note) => note.noTranslation)
			.map((note) => textKey(note.kind, note.thingId, note.field)));

		this.parts.push('noTranslation');

		for (const mark of marks)
		{
			const text = this.textTarget(mark);

			if (text)
			{
				const key = textKey(text.kind, String(text.thingId), text.field);

				marked.add(key);
				this.counts.noTranslation++;

				if (!draftMarked.has(key))
				{
					this.addLater((ids) => ({ kind: 'saveNoTranslation', text: this.savedText(ids, text), noTranslation: true }), 'text needing no translation');
				}
			}
		}

		for (const note of this.target.notes.filter((each) => each.noTranslation))
		{
			const key = textKey(note.kind, note.thingId, note.field);

			if (!marked.has(key) && this.texts.has(key))
			{
				this.add({ kind: 'saveNoTranslation', text: { kind: note.kind, thingId: note.thingId, field: note.field }, noTranslation: false }, 'the draft\'s text needing no translation');
			}
		}
	}

	/**
	 * Saves the file's translations into the languages the player may translate the universe into, once
	 * the import is saved, that the draft doesn't have as they are, and deletes the draft's into them the
	 * file doesn't have
	 *
	 * @param settings Whether the import replaces the settings, and with them the languages
	 */
	private planTranslations(settings: boolean): void
	{
		const translations = this.manifest.translations;
		const universeLanguages = ((settings && Array.isArray(this.manifest.settings?.translationLanguages)) ? this.manifest.settings.translationLanguages.map(String) : this.target.universe.translationLanguages);

		if (translations === undefined)
		{
			return;
		}

		const translates = ((this.access.role === 'creator') || (this.access.role === ADMIN_ROLE) || (this.access.role === 'translator'));
		const languages = translations.languages.filter((language) => (translates && canTranslate(this.access, language) && universeLanguages.some((each) => (each.toLowerCase() === language.toLowerCase()))));

		if (languages.length < translations.languages.length)
		{
			this.leftOut.add('translationLanguages');
		}

		if (languages.length === 0)
		{
			return;
		}

		const written = new Set<string>();
		const draftTranslations = new Map(this.target.translations.map((translation) => [`${textKey(translation.kind, translation.thingId, translation.field)}:${translation.language}`, translation]));

		this.parts.push('translations');
		this.translationLanguages = languages;

		for (const entry of translations.entries.filter((each) => languages.includes(each.language)))
		{
			const text = this.textTarget(entry);

			if (text)
			{
				const key = `${textKey(text.kind, String(text.thingId), text.field)}:${entry.language}`;
				const draft = draftTranslations.get(key);

				written.add(key);
				this.counts.translations++;

				if ((draft?.text !== entry.text) || (draft.sourceHash !== entry.sourceHash))
				{
					this.addLater((ids) => ({ kind: 'saveTranslation', text: this.savedText(ids, text), language: entry.language, translation: entry.text, sourceHash: entry.sourceHash }), `translations into ${entry.language}`);
				}
			}
		}

		for (const translation of this.target.translations.filter((each) => languages.includes(each.language)))
		{
			const key = textKey(translation.kind, translation.thingId, translation.field);

			if (!written.has(`${key}:${translation.language}`) && this.texts.has(key))
			{
				this.add({ kind: 'saveTranslation', text: { kind: translation.kind, thingId: translation.thingId, field: translation.field }, language: translation.language, translation: null, sourceHash: translation.sourceHash }, `the draft's translations into ${translation.language}`);
			}
		}
	}

	/**
	 * A piece of text naming the thing it belongs to by its saved ID
	 *
	 * @param ids The IDs the save gave the things it made so far
	 * @param text The piece of text, whose thing may be made by the import
	 * @return The piece of text
	 */
	private savedText(ids: SavedIds, text: NonNullable<ReturnType<ImportPlanner['textTarget']>>): UniverseTextRef
	{
		const { kind, thingId, field } = text;

		return({
			kind,
			thingId: ((typeof thingId === 'number') ? String(thingId) : String(ids.get(thingId as NewRef) ?? thingId)),
			field
		});
	}
}

/**
 * Plans importing a file into a draft
 *
 * @param file The file
 * @param target The draft, as it is
 * @param access The player's role in the editor, and their languages
 * @return The changes, and what they do
 * @throws ImportProblem when the file's content doesn't add up or isn't what a save would take
 */
export function planImport(file: ImportFile, target: ImportTarget, access: EditorAccess): ImportPlan
{
	const planner = new ImportPlanner(file, target, access);
	const { manifest } = file;

	planner.plan();

	return({
		changes: planner.changes,
		preview: {
			universe: manifest.universe,
			exportedAt: manifest.exportedAt,
			exportedBy: manifest.exportedBy,
			signature: file.signature,
			sameUniverse: (manifest.universe.id === target.universe.id),
			parts: planner.parts,
			counts: planner.counts,
			translationLanguages: planner.translationLanguages,
			tilesetUploads: planner.tilesetUploads,
			name: (planner.newName ?? null),
			leftOut: UNIVERSE_IMPORT_LEFT_OUT.filter((reason) => planner.leftOut.has(reason))
		}
	});
}
