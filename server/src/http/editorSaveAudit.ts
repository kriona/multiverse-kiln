/**
 * What a save in the world editor changed, for the record of saves the Audit tab lists (universe_edits).
 * Each change is described just before it is saved, against what the universe holds then, so a
 * setting sent with the value it already has isn't listed, and a thing deleted is named as it was
 */
import { isDeepStrictEqual } from 'util';
import { AUDIT_FIELDS, chunkCoordinate, chunkKey, oppositeSide, parseChunkKey, type AreaNeighbors, type AuditAction, type AuditField, type AuditFieldChange, type AuditPassageOfTime, type AuditPlace, type AuditSubject, type ClassRaceArea, type EditorChange, type EditorRoleSettings, type ItemQuantity, type NumberRef, type MergedChange, type OptionName, type PlaceRef, type SavedEditDetail, type StringRef, type TileGraphic, type UniverseEditDetail } from '@multiverse-kiln/shared';

import { findEditorArea } from '../db/areaRepo.js';
import { listRegions } from '../db/regionRepo.js';
import { loadEditorClasses } from '../db/classRepo.js';
import { listDifficultyLevels } from '../db/difficultyRepo.js';
import { loadEditorItems } from '../db/itemRepo.js';
import { findPlayerByUsername } from '../db/playerRepo.js';
import { loadEditorRaces } from '../db/raceRepo.js';
import { loadRulesetSettings } from '../db/rulesetRepo.js';
import { loadEditorThemes } from '../db/themeRepo.js';
import { listTileGraphics } from '../db/tileGraphicRepo.js';
import { loadEditorTiles } from '../db/tileRepo.js';
import { listUniverseEditors } from '../db/universeEditorRepo.js';
import { isSameVersion } from '../db/universeVersions.js';
import { resolveNumberRef, resolveStringRef, type ChangeContext } from './editorChangeContext.js';

/**
 * Something with a name, or one of the ruleset's defaults, named by its key while its name is null
 */
interface Named
{
	key: string | null;
	name: string | null;
}

/**
 * A thing's settings, with its rules (a race's size, a class's key ability and so on) beside the others
 */
type FlatSettings = Record<string, unknown>;

/**
 * The audit field a setting is shown as for every subject, where it isn't its own key
 */
const SHARED_FIELD_KEYS: ReadonlyMap<string, AuditField> = new Map([
	['startingAreaId', 'startingArea'],
	['startingColumn', 'startingArea'],
	['startingRow', 'startingArea'],
	['lobbyRegionId', 'lobbyRegion'],
	['lobbyAreaId', 'lobbyArea'],
	['lobbyColumn', 'lobbyArea'],
	['lobbyRow', 'lobbyArea'],
	['faerieMorning', 'passageOfTime'],
	['lobbyFaerieMorning', 'lobbyPassageOfTime'],
	['uploadedGraphicId', 'graphic']
]);

/**
 * The audit field a setting is shown as for one subject, where it differs from SHARED_FIELD_KEYS
 */
const SUBJECT_FIELD_KEYS: Partial<Record<AuditSubject, ReadonlyMap<string, AuditField>>> = {
	area: new Map([
		['indoors', 'indoorsOrOutdoors'],
		['defaultTileId', 'defaultTile']
	]),
	region: new Map([
		['indoors', 'indoorsOrOutdoors'],
		['defaultTileId', 'defaultTile']
	]),
	class: new Map([
		['hitPoints', 'hitPointsPerLevel'],
		['staminaPoints', 'staminaPointsPerLevel']
	])
};

/**
 * Audit fields merged as part of another, by subject, where only some combinations of the two can be
 * saved: a class with its own starting area has no areas by race, and only a translator has languages.
 * Merged as one setting, a change saves both as it sent them or both as saved, never one of each
 */
const MERGED_WITH: Partial<Record<AuditSubject, ReadonlyMap<AuditField, AuditField>>> = {
	class: new Map([['raceAreas', 'startingArea']]),
	editor: new Map([
		['languages', 'role'],
		['permissions', 'role']
	])
};

/**
 * What each create change adds
 */
const LIST_SUBJECTS: Readonly<Record<'createTile' | 'createItem' | 'createRace' | 'createClass' | 'createTheme' | 'createDifficultyLevel', AuditSubject>> = {
	createTile: 'tile',
	createItem: 'item',
	createRace: 'race',
	createClass: 'class',
	createTheme: 'theme',
	createDifficultyLevel: 'difficultyLevel'
};

/**
 * A new region's or area's settings before it is given any, so adding one lists only the settings it sets
 */
const NEW_PLACE = {
	enabled: null,
	indoors: null,
	lightLevel: null,
	defaultTileId: null,
	passageOfTime: null,
	faerieMorning: null,
	fogOfWar: null,
	parents: []
};

/**
 * Every audit field, to check a setting's key against
 */
const AUDIT_FIELD_SET: ReadonlySet<string> = new Set(AUDIT_FIELDS);

/**
 * A list a save's changes are compared against: loaded the first time a change needs it, and again when
 * it lacks what a change names (something made earlier in the save). Each change described updates its
 * entry, so a later change to the same thing is compared against it. Lookups made at the same time (the
 * starting items a class lists, say) share one load
 */
export class CachedList<Id, Entry>
{
	private entries: Map<Id, Entry> | undefined;

	/**
	 * The load in progress, which lookups that miss while it runs wait for rather than loading again
	 */
	private loading: Promise<void> | undefined;

	/**
	 * @param load Loads the list, by ID
	 */
	constructor(private readonly load: () => Promise<Map<Id, Entry>>)
	{
	}

	/**
	 * One of the list's entries
	 *
	 * @param id Its ID
	 * @return The entry, or undefined when the list has none with that ID
	 */
	async find(id: Id): Promise<Entry | undefined>
	{
		if (!this.entries?.has(id))
		{
			await this.reload();
		}

		return(this.entries?.get(id));
	}

	/**
	 * Loads the list again, or joins the load already in progress
	 *
	 * @return Resolves once the list is loaded
	 */
	private reload(): Promise<void>
	{
		this.loading ??= this.load()
			.then((entries) =>
			{
				this.entries = entries;
			})
			.finally(() =>
			{
				this.loading = undefined;
			});

		return(this.loading);
	}

	/**
	 * Replaces one of the list's entries with how a change left it
	 *
	 * @param id Its ID
	 * @param entry The entry
	 */
	set(id: Id, entry: Entry): void
	{
		this.entries?.set(id, entry);
	}
}

/**
 * A list of things with IDs, by ID
 *
 * @param entries The things
 * @return The things by ID
 */
function byId<Id, Entry extends { id: Id }>(entries: readonly Entry[]): Map<Id, Entry>
{
	return(new Map(entries.map((entry) => [entry.id, entry])));
}

/**
 * Whether a value is an object whose settings can be compared one by one
 *
 * @param value The value
 * @return True when it is
 */
function isRecord(value: unknown): value is Record<string, unknown>
{
	return((typeof value === 'object') && (value !== null) && !Array.isArray(value));
}

/**
 * A thing's settings with its rules beside the others, so each rule is compared and read on its own
 *
 * @param settings The settings
 * @return The settings, flattened
 */
function flatten(settings: object): FlatSettings
{
	const { rules, ...others } = settings as Record<string, unknown>;

	return({ ...others, ...(isRecord(rules) ? rules : {}) });
}

/**
 * The audit field a setting is shown as
 *
 * @param subject What the setting belongs to
 * @param key The setting's key
 * @return The field, or undefined for a setting the Audit tab doesn't name
 */
function fieldOf(subject: AuditSubject, key: string): AuditField | undefined
{
	const field = (SUBJECT_FIELD_KEYS[subject]?.get(key) ?? SHARED_FIELD_KEYS.get(key) ?? key);

	return((AUDIT_FIELD_SET.has(field) ? (field as AuditField) : undefined));
}

/**
 * The setting the editor shows that a setting is part of, for merging a change's settings a setting at a
 * time (mergeSettings()): its audit field, or the one MERGED_WITH merges that with, or its own key for
 * a setting the Audit tab doesn't name
 *
 * @param subject What the setting belongs to
 * @param key The setting's key
 * @return The group's name
 */
export function settingGroup(subject: AuditSubject, key: string): string
{
	const field = fieldOf(subject, key);

	if (field === undefined)
	{
		return(key);
	}

	return((MERGED_WITH[subject]?.get(field) ?? field));
}

/**
 * Whether a group of settings is one the Audit tab names
 *
 * @param group The group, from settingGroup()
 * @return True when it is an audit field
 */
export function isAuditField(group: string): group is AuditField
{
	return(AUDIT_FIELD_SET.has(group));
}

/**
 * An editor's role, and a translator's languages, listed under adding or removing them
 *
 * @param settings Their role and languages
 * @return The fields
 */
function roleFields(settings: EditorRoleSettings): AuditFieldChange[]
{
	const fields: AuditFieldChange[] = [{ field: 'role', value: settings.role }];

	if (settings.languages.length > 0)
	{
		fields.push({ field: 'languages', value: [...settings.languages] });
	}

	if ((settings.role === 'builder') && (settings.permissions !== undefined))
	{
		fields.push({ field: 'permissions', value: { ...settings.permissions } });
	}

	return(fields);
}

/**
 * A passage of time as the Audit tab shows it
 *
 * @param time The passage of time, or null for a region or area that inherits it
 * @param morning Where morning is in faerie time
 * @return The passage of time, with where morning is only when it is faerie, or null for inherit
 */
function passageOf(time: unknown, morning: unknown): AuditPassageOfTime | null
{
	if ((time === null) || (time === undefined))
	{
		return(null);
	}

	return({
		time: time as AuditPassageOfTime['time'],
		morning: ((time === 'faerie') ? ((morning ?? null) as AuditPassageOfTime['morning']) : null)
	});
}

/**
 * Builds the record of what one save changes, change by change, as they are saved
 */
export class SaveAudit
{
	/**
	 * What the save changed, thing by thing
	 */
	readonly details: UniverseEditDetail[] = [];

	/**
	 * The ID of what each of the details changed, in the same order (SavedEditDetail.id)
	 */
	private readonly ids: (number | string | null)[] = [];

	/**
	 * The ID of what the change being described changes, which the details it adds take
	 */
	private changeId: number | string | null = null;

	private readonly editors: CachedList<string, EditorRoleSettings & { username: string }>;
	private readonly tileGraphics: CachedList<string, { name: string }>;
	private readonly tiles: CachedList<number, Named & { custom: boolean }>;
	private readonly items: CachedList<number, Named & { custom: boolean }>;
	private readonly races: CachedList<number, Named & { custom: boolean }>;
	private readonly classes: CachedList<number, Named & { custom: boolean }>;
	private readonly themes: CachedList<number, Named & { custom: boolean }>;
	private readonly difficultyLevels: CachedList<number, Named>;

	/**
	 * The areas changes have named, as they were before each change
	 */
	private readonly areas = new Map<string, Record<string, unknown> & { name: string }>();

	/**
	 * The chunks of each area the save painted, by chunkKey(), by the area's ID
	 */
	private readonly paintedChunks = new Map<string, Set<string>>();

	/**
	 * @param context The save
	 */
	constructor(private readonly context: ChangeContext)
	{
		const { id, ruleset } = context.universe;
		const { version, transaction } = context;

		this.editors = new CachedList(async () => new Map((await listUniverseEditors(id, transaction)).map((editor) => [editor.playerId, editor])));
		this.tileGraphics = new CachedList(async () => byId(await listTileGraphics(version, transaction)));
		this.tiles = new CachedList(async () => byId(await loadEditorTiles(version, ruleset, transaction)));
		this.items = new CachedList(async () => byId(await loadEditorItems(version, ruleset, transaction)));
		this.races = new CachedList(async () => byId(await loadEditorRaces(version, ruleset, transaction)));
		this.classes = new CachedList(async () => byId(await loadEditorClasses(version, ruleset, transaction)));
		this.themes = new CachedList(async () => byId(await loadEditorThemes(version, ruleset, transaction)));
		this.difficultyLevels = new CachedList(async () => byId(await listDifficultyLevels(version, transaction)));
	}

	/**
	 * Whether the save has changed anything so far
	 *
	 * @return True when it has
	 */
	hasChanges(): boolean
	{
		return(this.details.length > 0);
	}

	/**
	 * What the save changed, thing by thing, each with the ID of what it changed, for the editor windows
	 * told of the save
	 *
	 * @return The details
	 */
	savedDetails(): SavedEditDetail[]
	{
		return(this.details.map((detail, index) => ({ ...detail, id: (this.ids[index] ?? null) })));
	}

	/**
	 * What the save changed, as savedDetails() has it, with the chunks each area's painting touched, for
	 * telling the editor windows of the save
	 *
	 * @return The details
	 */
	noticedDetails(): SavedEditDetail[]
	{
		return(this.savedDetails().map((detail) =>
		{
			const chunks = (((detail.subject === 'cells') && (typeof detail.id === 'string')) ? this.paintedChunks.get(detail.id) : undefined);

			return(((chunks === undefined) ? detail : { ...detail, chunks: [...chunks].map(parseChunkKey) }));
		}));
	}

	/**
	 * Records what a change is about to do. Call it just before the change is saved; a change it can't
	 * describe (one naming something that doesn't exist, which the save then refuses) records nothing
	 *
	 * @param change The change
	 */
	async describe(change: EditorChange): Promise<void>
	{
		this.changeId = this.idOf(change);

		switch (change.kind)
		{
			case 'startDraft':
				this.add('draft', 'added', null);
				return;

			case 'applyDraft':
				this.add('draft', 'applied', null);
				return;

			case 'discardDraft':
				this.add('draft', 'deleted', null);
				return;

			case 'addEditor':
				// Unlike other things added, the player already has an ID, which the data export finds the save by
				this.changeId = ((await findPlayerByUsername(change.username, this.context.transaction))?.id ?? null);
				this.add('editor', 'added', { key: null, name: change.username }, 1, roleFields(change.settings));
				return;

			case 'saveEditor':
			{
				const before = await this.editors.find(change.playerId);

				if (before)
				{
					this.addChanged('editor', { key: null, name: before.username }, await this.changedFields('editor', before, change.settings));
					this.editors.set(change.playerId, { ...before, ...change.settings });
				}

				return;
			}

			case 'removeEditor':
			{
				const before = await this.editors.find(change.playerId);

				if (before)
				{
					this.add('editor', 'deleted', { key: null, name: before.username }, 1, roleFields(before));
				}

				return;
			}

			case 'universe':
				this.addChanged('settings', null, await this.changedFields('settings', this.context.universe, change.update));
				return;

			case 'ruleset':
			{
				const saved = await loadRulesetSettings(this.context.version, this.context.universe.ruleset, this.context.transaction);

				this.addChanged('ruleset', null, await this.changedFields('ruleset', saved.settings, change.settings.settings));
				return;
			}

			case 'uploadTileGraphic':
				this.add('tileset', 'added', { key: null, name: change.upload.name });
				return;

			case 'deleteTileGraphic':
			{
				const before = await this.tileGraphics.find(change.graphicId);

				if (before)
				{
					this.add('tileset', 'deleted', { key: null, name: before.name });
				}

				return;
			}

			case 'createTile':
			case 'createItem':
			case 'createRace':
			case 'createClass':
			case 'createTheme':
			case 'createDifficultyLevel':
				this.add(LIST_SUBJECTS[change.kind], 'added', { key: null, name: change.settings.name });
				return;

			case 'saveTile':
				return(this.saveListed('tile', this.tiles, change.id, change.settings));
			case 'saveItem':
				return(this.saveListed('item', this.items, change.id, change.settings));
			case 'saveRace':
				return(this.saveListed('race', this.races, change.id, change.settings));
			case 'saveClass':
				return(this.saveListed('class', this.classes, change.id, change.settings));
			case 'saveTheme':
				return(this.saveListed('theme', this.themes, change.id, change.settings));
			case 'saveDifficultyLevel':
				return(this.saveListed('difficultyLevel', this.difficultyLevels, change.id, change.settings));

			case 'removeTile':
				return(this.removeListed('tile', this.tiles, change.id));
			case 'removeItem':
				return(this.removeListed('item', this.items, change.id));
			case 'removeRace':
				return(this.removeListed('race', this.races, change.id));
			case 'removeClass':
				return(this.removeListed('class', this.classes, change.id));
			case 'removeTheme':
				return(this.removeListed('theme', this.themes, change.id));
			case 'removeDifficultyLevel':
			{
				// A difficulty level is deleted even when it is one of the defaults
				const before = await this.difficultyLevels.find(resolveNumberRef(this.context, change.id));

				if (before)
				{
					this.add('difficultyLevel', 'deleted', { key: before.key, name: before.name });
				}

				return;
			}

			case 'createRegion':
				this.add('region', 'added', { key: null, name: change.region.name }, 1, await this.changedFields('region', { ...NEW_PLACE, name: change.region.name }, change.region));
				return;

			case 'updateRegion':
			{
				const before = (await this.context.places.load()).region(resolveStringRef(this.context, change.regionId));

				if (before)
				{
					this.addChanged('region', { key: null, name: (change.update.name ?? before.name) }, await this.changedFields('region', before, change.update));
				}

				return;
			}

			case 'deleteRegion':
			{
				const before = (await this.context.places.load()).region(resolveStringRef(this.context, change.regionId));

				if (before)
				{
					this.add('region', 'deleted', { key: null, name: before.name });
				}

				return;
			}

			case 'assignBuilders':
			{
				const regionId = resolveStringRef(this.context, change.regionId);
				const before = (await this.context.places.load()).region(regionId);
				const assigned = (await listRegions(this.context.version, this.context.transaction)).find((region) => (region.id === regionId))?.builderIds;

				if (before && !isDeepStrictEqual(new Set(assigned), new Set(change.builderIds)))
				{
					const usernames = await Promise.all(change.builderIds.map(async (playerId) => ((await this.editors.find(playerId))?.username ?? '')));

					this.addChanged('region', { key: null, name: before.name }, [{ field: 'assignments', value: usernames }]);
				}

				return;
			}

			case 'createArea':
				this.add('area', 'added', { key: null, name: change.area.name }, 1, await this.changedFields('area', { ...NEW_PLACE, name: change.area.name, loopsEastWest: false, loopsNorthSouth: false }, change.area));
				return;

			case 'updateArea':
			{
				const areaId = resolveStringRef(this.context, change.areaId);
				const before = await this.findArea(areaId);

				if (before)
				{
					const name = (change.update.name ?? before.name);

					this.addChanged('area', { key: null, name }, await this.changedFields('area', before, change.update));
					this.areas.set(areaId, { ...before, ...change.update, name });
				}

				return;
			}

			case 'deleteArea':
				return(this.changeArea(change.areaId, 'area', 'deleted', 1));
			case 'resizeArea':
				return(this.changeArea(change.areaId, 'area', 'resized', 1));
			case 'setNeighbor':
			{
				const areaId = resolveStringRef(this.context, change.areaId);
				const before = await this.findArea(areaId);
				const neighborId = ((change.neighborId === null) ? null : resolveStringRef(this.context, change.neighborId));
				const neighbor = ((neighborId === null) ? undefined : await this.findArea(neighborId));
				const neighbors = (before?.neighbors as AreaNeighbors | undefined);

				if (before && neighbors && (neighbors[change.side] !== neighborId))
				{
					this.addChanged('area', { key: null, name: before.name }, [{ field: 'neighbor', value: { side: change.side, area: (neighbor?.name ?? null) } }]);
					this.areas.set(areaId, { ...before, neighbors: { ...neighbors, [change.side]: neighborId } });

					if (neighbor && (neighborId !== null))
					{
						this.areas.set(neighborId, { ...neighbor, neighbors: { ...(neighbor.neighbors as AreaNeighbors), [oppositeSide(change.side)]: areaId } });
					}
				}

				return;
			}
			case 'editCells':
			{
				const areaId = resolveStringRef(this.context, change.areaId);
				const chunks = (this.paintedChunks.get(areaId) ?? new Set<string>());

				for (const [column, row] of change.changes)
				{
					chunks.add(chunkKey(chunkCoordinate(column), chunkCoordinate(row)));
				}

				this.paintedChunks.set(areaId, chunks);

				return(this.changeArea(change.areaId, 'cells', 'changed', change.changes.length));
			}
			case 'saveLink':
				return(this.changeArea(change.areaId, 'links', 'changed', 1));
			case 'deleteLink':
				return(this.changeArea(change.areaId, 'links', 'deleted', 1));

			// Counted together, one line for each language, one for the notes, and one each for marking
			// text as needing no translation and as needing one again
			case 'saveTranslation':
				this.count('translations', 'changed', change.language);
				return;
			case 'saveTranslatorNote':
				this.count('translatorNotes', 'changed', null);
				return;
			case 'saveNoTranslation':
				this.count('noTranslation', (change.noTranslation ? 'added' : 'deleted'), null);
				return;
		}
	}

	/**
	 * The settings a change to settings meets, as saved now (earlier changes in the save included), for
	 * merging it with them
	 *
	 * @param change The change
	 * @return What it changes, by name and ID, with its settings; undefined when the universe has no such
	 * thing, which the change's own module then refuses
	 */
	async savedSettings(change: MergedChange): Promise<{ subject: AuditSubject; target: OptionName | null; id: number | string | null; saved: Record<string, unknown> } | undefined>
	{
		const id = this.idOf(change);

		/**
		 * One of the lists' things, as the merge needs it
		 *
		 * @param subject What it is
		 * @param entry The thing, or undefined when the list has none
		 * @return What the merge needs, or undefined
		 */
		const listed = (subject: AuditSubject, entry: (Named & object) | undefined): { subject: AuditSubject; target: OptionName | null; id: number | string | null; saved: Record<string, unknown> } | undefined => ((entry === undefined)
			? undefined
			: {
				subject,
				target: {
					key: entry.key,
					name: entry.name
				},
				id,
				saved: { ...entry }
			});

		switch (change.kind)
		{
			case 'saveEditor':
			{
				const editor = await this.editors.find(change.playerId);

				return(editor && {
					subject: 'editor',
					target: { key: null, name: editor.username },
					id,
					saved: { role: editor.role, languages: editor.languages }
				});
			}
			case 'universe':
				return({ subject: 'settings', target: null, id, saved: { ...this.context.universe } });
			case 'ruleset':
			{
				const saved = await loadRulesetSettings(this.context.version, this.context.universe.ruleset, this.context.transaction);

				return({ subject: 'ruleset', target: null, id, saved: { ...saved.settings } });
			}
			case 'saveTile':
				return(listed('tile', await this.tiles.find(Number(id))));
			case 'saveItem':
				return(listed('item', await this.items.find(Number(id))));
			case 'saveRace':
				return(listed('race', await this.races.find(Number(id))));
			case 'saveClass':
				return(listed('class', await this.classes.find(Number(id))));
			case 'saveTheme':
				return(listed('theme', await this.themes.find(Number(id))));
			case 'saveDifficultyLevel':
				return(listed('difficultyLevel', await this.difficultyLevels.find(Number(id))));
			case 'updateArea':
			{
				const area = await this.findArea(String(id));

				return(area && { subject: 'area', target: { key: null, name: area.name }, id, saved: { ...area } });
			}
			case 'updateRegion':
			{
				const region = (await this.context.places.load()).region(String(id));

				return(region && { subject: 'region', target: { key: null, name: region.name }, id, saved: { ...region } });
			}
		}
	}

	/**
	 * Some settings as the Audit tab shows them, by the setting the editor shows: for a conflict, the
	 * change's values and the ones saved
	 *
	 * @param subject What the settings belong to
	 * @param base Every setting of the thing, which the values are read against
	 * @param values The settings to show, by key, flattened
	 * @return The settings that the Audit tab names, with their values
	 */
	describeSettings(subject: AuditSubject, base: Record<string, unknown>, values: Record<string, unknown>): Promise<AuditFieldChange[]>
	{
		return(this.namedFields(subject, Object.keys(values), { ...flatten(base), ...values }));
	}

	/**
	 * The ID of what a change changes, for the editor windows told of the save to find it by
	 *
	 * @param change The change
	 * @return The ID of the tile, item, race, class, theme, difficulty level, area (the one whose cells or
	 * links it changes, for cells and links), uploaded tileset or editor (their player ID); null for
	 * a change adding something, and one to the settings, the ruleset, translations or the draft
	 */
	private idOf(change: EditorChange): number | string | null
	{
		switch (change.kind)
		{
			case 'saveEditor':
			case 'removeEditor':
				return(change.playerId);
			case 'deleteTileGraphic':
				return(change.graphicId);
			case 'saveTile':
			case 'removeTile':
			case 'saveItem':
			case 'removeItem':
			case 'saveRace':
			case 'removeRace':
			case 'saveClass':
			case 'removeClass':
			case 'saveTheme':
			case 'removeTheme':
			case 'saveDifficultyLevel':
			case 'removeDifficultyLevel':
				return(resolveNumberRef(this.context, change.id));
			case 'updateArea':
			case 'deleteArea':
			case 'resizeArea':
			case 'setNeighbor':
			case 'editCells':
			case 'saveLink':
			case 'deleteLink':
				return(resolveStringRef(this.context, change.areaId));
			case 'updateRegion':
			case 'deleteRegion':
			case 'assignBuilders':
				return(resolveStringRef(this.context, change.regionId));
			default:
				return(null);
		}
	}

	/**
	 * Counts one more translation into a language, note for translators, or piece of text marked, on the
	 * save's line for them
	 *
	 * @param subject translations, translatorNotes or noTranslation
	 * @param action What was done to it
	 * @param language The translations' language, or null for the others
	 */
	private count(subject: 'translations' | 'translatorNotes' | 'noTranslation', action: AuditAction, language: string | null): void
	{
		const target = ((language === null) ? null : { key: null, name: language });
		const counted = this.details.find((detail) => ((detail.subject === subject) && (detail.action === action) && (detail.target?.name === target?.name)));

		if (counted)
		{
			counted.count++;
			return;
		}

		this.add(subject, action, target, 1);
	}

	/**
	 * Records a change to a tile, item, race, class, theme or difficulty level's settings
	 *
	 * @param subject What it changes
	 * @param list The things of its kind
	 * @param ref The thing
	 * @param settings Its settings once saved
	 */
	private async saveListed<Entry extends Named>(subject: AuditSubject, list: CachedList<number, Entry>, ref: NumberRef, settings: object & { name: string | null }): Promise<void>
	{
		const id = resolveNumberRef(this.context, ref);
		const before = await list.find(id);

		if (before)
		{
			this.addChanged(subject, { key: before.key, name: settings.name }, await this.changedFields(subject, before, settings));
			list.set(id, { ...before, ...settings });
		}
	}

	/**
	 * Records deleting a tile, item, race, class or theme the universe added, or restoring one of the
	 * ruleset's defaults
	 *
	 * @param subject What it changes
	 * @param list The things of its kind
	 * @param ref The thing
	 */
	private async removeListed(subject: AuditSubject, list: CachedList<number, Named & { custom: boolean }>, ref: NumberRef): Promise<void>
	{
		const before = await list.find(resolveNumberRef(this.context, ref));

		if (before)
		{
			this.add(subject, (before.custom ? 'deleted' : 'restored'), { key: before.key, name: before.name });
		}
	}

	/**
	 * Records a change to an area or its cells. Cells painted and links changed in the same area are
	 * counted together
	 *
	 * @param ref The area
	 * @param subject What it changes
	 * @param action What it does
	 * @param count How many cells or links it changes
	 */
	private async changeArea(ref: string, subject: AuditSubject, action: AuditAction, count: number): Promise<void>
	{
		const area = await this.findArea(resolveStringRef(this.context, ref));

		if (!area)
		{
			return;
		}

		const existing = (((subject === 'cells') || (subject === 'links'))
			? this.details.find((detail) => ((detail.subject === subject) && (detail.action === action) && (detail.target?.name === area.name)))
			: undefined);

		if (existing)
		{
			existing.count += count;
			return;
		}

		this.add(subject, action, { key: null, name: area.name }, count);
	}

	/**
	 * An area as it is before the change being described
	 *
	 * @param areaId The area's ID
	 * @return Its settings and name, or undefined when the universe has no such area
	 */
	private async findArea(areaId: string): Promise<(Record<string, unknown> & { name: string }) | undefined>
	{
		const known = this.areas.get(areaId);

		if (known)
		{
			return(known);
		}

		const found = await findEditorArea(areaId, this.context.transaction);

		if (!found || !isSameVersion(found.version, this.context.version))
		{
			return(undefined);
		}

		const area = { ...found.area };

		this.areas.set(areaId, area);

		return(area);
	}

	/**
	 * The settings a change sends with values other than those saved, each with the value it is
	 * changed to
	 *
	 * @param subject What the settings belong to
	 * @param saved The settings saved
	 * @param sent The settings the change sends; those left out (undefined) keep their values
	 * @return The fields that differ, each once, in the order the change holds them
	 */
	private async changedFields(subject: AuditSubject, saved: object, sent: object): Promise<AuditFieldChange[]>
	{
		const before = flatten(saved);
		const after: FlatSettings = { ...before };
		const changed: string[] = [];

		for (const [key, value] of Object.entries(flatten(sent)))
		{
			if (value === undefined)
			{
				continue;
			}

			after[key] = value;

			if (!isDeepStrictEqual(before[key], value))
			{
				changed.push(key);
			}
		}

		return(this.namedFields(subject, changed, after));
	}

	/**
	 * The fields some settings are shown as, each once, with their values
	 *
	 * @param subject What the settings belong to
	 * @param keys The settings, by key, in order
	 * @param after Every setting of the thing, with the values to show
	 * @return The fields the Audit tab names, in the order of the settings
	 */
	private async namedFields(subject: AuditSubject, keys: readonly string[], after: FlatSettings): Promise<AuditFieldChange[]>
	{
		const fields = new Map<AuditField, string>();

		for (const key of keys)
		{
			const field = fieldOf(subject, key);

			if ((field !== undefined) && !fields.has(field))
			{
				fields.set(field, key);
			}
		}

		return(Promise.all([...fields].map(([field, key]) => this.fieldValue(field, key, after))));
	}

	/**
	 * A field's value once a change is saved
	 *
	 * @param field The field
	 * @param key The setting it was changed by
	 * @param after The thing's settings once the change is saved
	 * @return The field and its value
	 */
	private async fieldValue(field: AuditField, key: string, after: FlatSettings): Promise<AuditFieldChange>
	{
		switch (field)
		{
			case 'longDescription':
				return({ field, value: (after.longDescription as string).length });

			case 'passageOfTime':
				return({ field, value: passageOf(after.passageOfTime, after.faerieMorning) });

			case 'lobbyPassageOfTime':
				return({ field, value: passageOf(after.lobbyPassageOfTime, after.lobbyFaerieMorning) as AuditPassageOfTime });

			case 'parents':
				return({
					field,
					value: await Promise.all((after.parents as PlaceRef[]).map(async (parent) => ((parent.kind === 'region')
						? await this.regionName(resolveStringRef(this.context, parent.id))
						: await this.areaName(resolveStringRef(this.context, parent.id)))))
				});

			case 'startingArea':
			{
				const areaId = after.startingAreaId;

				return({
					field,
					value: ((typeof areaId === 'string') ? await this.place(areaId, Number(after.startingColumn), Number(after.startingRow)) : null)
				});
			}

			case 'lobbyRegion':
			{
				const regionId = after.lobbyRegionId;

				return({
					field,
					value: ((typeof regionId === 'string') ? await this.regionName(regionId) : null)
				});
			}

			case 'lobbyArea':
			{
				const areaId = after.lobbyAreaId;

				return({
					field,
					value: ((typeof areaId === 'string') ? await this.place(areaId, Number(after.lobbyColumn), Number(after.lobbyRow)) : null)
				});
			}

			case 'startingItems':
				return({
					field,
					value: await Promise.all((after.startingItems as ItemQuantity[]).map(async (entry) => ({
						item: await this.nameIn(this.items, entry.itemId),
						quantity: entry.quantity
					})))
				});

			case 'raceAreas':
				return({
					field,
					value: await Promise.all((after.raceAreas as ClassRaceArea[]).map(async (entry) => ({
						race: await this.nameIn(this.races, entry.raceId),
						place: await this.place(entry.areaId, entry.column, entry.row)
					})))
				});

			case 'graphic':
			{
				const uploadedId = after.uploadedGraphicId as StringRef | null;
				const uploaded = ((uploadedId === null) ? undefined : await this.tileGraphics.find(resolveStringRef(this.context, uploadedId)));

				return({
					field,
					value: {
						graphic: ((after.graphic ?? null) as TileGraphic | null),
						uploaded: (uploaded?.name ?? null)
					}
				});
			}

			case 'parentArea':
			{
				const parentId = after.parentAreaId as StringRef | null;

				return({
					field,
					value: ((parentId === null) ? null : await this.areaName(resolveStringRef(this.context, parentId)))
				});
			}

			case 'defaultTile':
				return({
					field,
					value: ((after.defaultTileId === null) ? null : await this.nameIn(this.tiles, resolveNumberRef(this.context, after.defaultTileId as NumberRef)))
				});

			default:
				// Every other field holds its setting's value as saved
				return({ field, value: after[key] } as AuditFieldChange);
		}
	}

	/**
	 * A place in an area, by the area's name
	 *
	 * @param areaId The area's ID
	 * @param column The cell's column
	 * @param row The cell's row
	 * @return The place
	 */
	private async place(areaId: string, column: number, row: number): Promise<AuditPlace>
	{
		return({
			area: await this.areaName(areaId),
			column,
			row
		});
	}

	/**
	 * An area's name
	 *
	 * @param areaId The area's ID
	 * @return Its name, or an empty string for an area the universe doesn't have
	 */
	private async areaName(areaId: string): Promise<string>
	{
		return((await this.findArea(areaId))?.name ?? '');
	}

	/**
	 * A region's name, as it is before the change being described
	 *
	 * @param regionId The region's ID
	 * @return Its name, or empty for a region the universe doesn't have
	 */
	private async regionName(regionId: string): Promise<string>
	{
		return((await this.context.places.load()).region(regionId)?.name ?? '');
	}

	/**
	 * A tile, item or race's name
	 *
	 * @param list The things of its kind
	 * @param id Its ID
	 * @return Its name, with its key for one of the ruleset's defaults; both null for one the list doesn't have
	 */
	private async nameIn(list: CachedList<number, Named>, id: number): Promise<OptionName>
	{
		const entry = await list.find(id);

		return({
			key: (entry?.key ?? null),
			name: (entry?.name ?? null)
		});
	}

	/**
	 * Records a change that changed settings, when it changed any
	 *
	 * @param subject What it changes
	 * @param target What it changes, by name
	 * @param fields The settings that differ
	 */
	private addChanged(subject: AuditSubject, target: OptionName | null, fields: AuditFieldChange[]): void
	{
		if (fields.length > 0)
		{
			this.details.push({ subject, action: 'changed', target, fields, count: 1 });
			this.ids.push(this.changeId);
		}
	}

	/**
	 * Records a change
	 *
	 * @param subject What it changes
	 * @param action What it does
	 * @param target What it changes, by name
	 * @param count How many cells or links it changes, for cells and links
	 * @param fields Settings to list under it, such as the role of an editor added or removed
	 */
	private add(subject: AuditSubject, action: AuditAction, target: OptionName | null, count: number = 1, fields: AuditFieldChange[] = []): void
	{
		this.details.push({ subject, action, target, fields, count });
		this.ids.push(this.changeId);
	}
}
