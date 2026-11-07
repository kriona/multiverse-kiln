/**
 * Saving only what an editor changed (see Editing together in STRUCTURE-OVERVIEW.md): a change to
 * settings carries the settings as the editor loaded them, and the server saves only the settings the
 * editor changed from those, keeping what is saved for the rest. A setting another editor changed since
 * it was loaded, to something other than this change's value, conflicts
 */
import type { EditorChange } from './editorChanges.js';

/**
 * The settings of a thing as the editor loaded them, before the change's own: an object like the change's
 * settings, with a thing's rules among the others or under rules
 */
export type LoadedSettings = Record<string, unknown>;

/**
 * A thing's settings as loaded, copied for a change made from them
 *
 * @param settings The thing as loaded, such as a race from the editor's list, or undefined for none
 * @return The loaded settings, or undefined
 */
export function loadedFrom(settings: object | undefined): LoadedSettings | undefined
{
	return(((settings === undefined) ? undefined : Object.fromEntries(Object.entries(settings))));
}

/**
 * The settings a change sends as they were loaded, for a form that sends some of a thing's settings,
 * such as one of the forms holding the universe's settings
 *
 * @param loaded The thing as loaded, or undefined for none
 * @param settings The settings the change sends
 * @return Each of those settings as loaded, or undefined
 */
export function loadedFor(loaded: object | undefined, settings: object): LoadedSettings | undefined
{
	const all = loadedFrom(loaded);

	return(((all === undefined) ? undefined : Object.fromEntries(Object.keys(settings).map((key) => [key, all[key]]))));
}

/**
 * Settings with a thing's rules beside the others, by key
 */
export type FlatSettings = Record<string, unknown>;

/**
 * The kinds of change whose settings are merged with what is saved
 */
export const MERGED_CHANGE_KINDS = ['saveEditor', 'universe', 'ruleset', 'saveTile', 'saveItem', 'saveRace', 'saveClass', 'saveTheme', 'saveDifficultyLevel', 'updateArea'] as const;

export type MergedChange = Extract<EditorChange, { kind: typeof MERGED_CHANGE_KINDS[number] }>;

/**
 * Whether a change's settings are merged with what is saved
 *
 * @param change The change
 * @return True when they are
 */
export function isMergedChange(change: EditorChange): change is MergedChange
{
	return(MERGED_CHANGE_KINDS.some((kind) => (kind === change.kind)));
}

/**
 * A change to a translation or a note for translators, which conflicts as a whole rather than a setting
 * at a time
 */
export type MergedTextChange = Extract<EditorChange, { kind: 'saveTranslation' | 'saveTranslatorNote' }>;

/**
 * Whether a change is to a translation or a note for translators
 *
 * @param change The change
 * @return True when it is
 */
export function isMergedTextChange(change: EditorChange): change is MergedTextChange
{
	return((change.kind === 'saveTranslation') || (change.kind === 'saveTranslatorNote'));
}

/**
 * The text a translation or a note for translators saves
 *
 * @param change The change
 * @return The translation or note, or null to delete it
 */
export function changeText(change: MergedTextChange): string | null
{
	return(((change.kind === 'saveTranslation') ? change.translation : change.note));
}

/**
 * Whether a value is an object whose settings can be read one by one
 *
 * @param value The value
 * @return True when it is
 */
function isRecord(value: unknown): value is Record<string, unknown>
{
	return((typeof value === 'object') && (value !== null) && !Array.isArray(value));
}

/**
 * Whether two settings' values are the same, as JSON holds them: lists in the same order, and objects
 * with the same settings whatever their order. A setting left out is the same as one undefined
 *
 * @param first One value
 * @param second The other
 * @return True when they are the same
 */
export function sameValue(first: unknown, second: unknown): boolean
{
	if (first === second)
	{
		return(true);
	}

	if (Array.isArray(first) && Array.isArray(second))
	{
		return((first.length === second.length) && first.every((value, index) => sameValue(value, second[index])));
	}

	if (isRecord(first) && isRecord(second))
	{
		const keys = new Set([...Object.keys(first), ...Object.keys(second)]);

		return([...keys].every((key) => sameValue(first[key], second[key])));
	}

	return(false);
}

/**
 * The settings a change saves, as it holds them: a universe or area change's update, the ruleset's
 * settings, and every other change's settings
 *
 * @param change The change
 * @return The settings
 */
export function changeSettings(change: MergedChange): Record<string, unknown>
{
	switch (change.kind)
	{
		case 'universe':
		case 'updateArea':
			return(change.update);
		case 'ruleset':
			return(change.settings.settings as unknown as Record<string, unknown>);
		default:
			return(change.settings as unknown as Record<string, unknown>);
	}
}

/**
 * A change with other settings and loaded settings, where changeSettings() finds them
 *
 * @param change The change
 * @param settings Its settings, shaped as changeSettings() returned them
 * @param loaded The settings as the editor loaded them
 * @return The change
 */
export function withChangeSettings<Change extends MergedChange>(change: Change, settings: Record<string, unknown>, loaded: LoadedSettings | undefined): Change
{
	switch (change.kind)
	{
		case 'universe':
		case 'updateArea':
			return({ ...change, update: settings, loaded });
		case 'ruleset':
			return({ ...change, settings: { ...change.settings, settings }, loaded });
		default:
			return({ ...change, settings, loaded });
	}
}

/**
 * Settings with a thing's rules beside the others, so each rule is merged on its own
 *
 * @param settings The settings
 * @return The settings, flattened
 */
export function flattenSettings(settings: Record<string, unknown>): FlatSettings
{
	const { rules, ...others } = settings;

	return({ ...others, ...(isRecord(rules) ? rules : {}) });
}

/**
 * Flattened settings shaped again as settings were: each of the settings' own settings, and each of their
 * rules under rules
 *
 * @param flat The flattened settings
 * @param shape The settings whose shape to take
 * @return The settings
 */
export function unflattenSettings(flat: FlatSettings, shape: Record<string, unknown>): Record<string, unknown>
{
	const { rules } = shape;
	const settings = Object.fromEntries(Object.keys(shape)
		.filter((key) => (key !== 'rules'))
		.map((key) => [key, flat[key]]));

	if (isRecord(rules))
	{
		settings.rules = Object.fromEntries(Object.keys(rules).map((key) => [key, flat[key]]));
	}

	return(settings);
}

/**
 * How a change's settings merge with what is saved
 */
export interface MergedSettings
{
	/**
	 * The settings to save: those the change changed from the settings loaded, and what is saved for the rest
	 */
	merged: FlatSettings;

	/**
	 * The settings that conflict, each group of keys one setting the editor shows, such as a starting
	 * area's area, column and row
	 */
	conflicts: string[][];
}

/**
 * Merges a change's settings with what is saved. Settings are compared a group at a time, a group being
 * one setting the editor shows (a starting area's area, column and row). A group the change didn't change
 * from what was loaded takes what is saved. One it did change takes the change's value, and conflicts when
 * what is saved has changed since it was loaded to something else. A setting the change has but not the
 * settings loaded counts as changed, so a change without loaded settings saves every setting as sent
 *
 * @param saved The thing's settings as saved now, flattened
 * @param loaded The settings as the editor loaded them, flattened
 * @param sent The change's settings, flattened
 * @param groupOf The group a setting is in, by its key
 * @return The settings to save, and the groups that conflict
 */
export function mergeSettings(saved: FlatSettings, loaded: FlatSettings, sent: FlatSettings, groupOf: (key: string) => string): MergedSettings
{
	const groups = new Map<string, string[]>();
	const merged: FlatSettings = {};
	const conflicts: string[][] = [];

	for (const key of Object.keys(sent))
	{
		const group = groupOf(key);

		groups.set(group, [...(groups.get(group) ?? []), key]);
	}

	for (const keys of groups.values())
	{
		const mine = keys.some((key) => (!(key in loaded) || !sameValue(sent[key], loaded[key])));

		if (!mine)
		{
			for (const key of keys)
			{
				merged[key] = ((key in saved) ? saved[key] : sent[key]);
			}

			continue;
		}

		const theirs = keys.some((key) => ((key in loaded) && (key in saved) && !sameValue(saved[key], loaded[key])));
		const agreed = keys.every((key) => (!(key in saved) || sameValue(saved[key], sent[key])));

		if (theirs && !agreed)
		{
			conflicts.push(keys);
		}

		for (const key of keys)
		{
			merged[key] = sent[key];
		}
	}

	return({ merged, conflicts });
}

/**
 * Settles a conflict in a change, for saving it again: keeping the change's own value counts what is
 * saved as loaded, so it is saved over it; taking the value saved puts that in the change too
 *
 * @param change The change
 * @param saved The conflicting settings as saved, by key (SaveConflict.saved)
 * @param keepMine True to keep the change's value, false to take the one saved
 * @return The change to save
 */
export function settleConflict<Change extends MergedChange>(change: Change, saved: Record<string, unknown>, keepMine: boolean): Change
{
	const shape = changeSettings(change);
	const settings = flattenSettings(shape);
	const loaded = flattenSettings(change.loaded ?? {});

	for (const [key, value] of Object.entries(saved))
	{
		loaded[key] = value;

		if (!keepMine)
		{
			settings[key] = value;
		}
	}

	return(withChangeSettings(change, unflattenSettings(settings, shape), loaded));
}

/**
 * Settles a translation's or note's conflict, as settleConflict() does a setting's. Taking the one saved
 * takes its source text's hash too, so the change then saves nothing and the translation stays as up to
 * date as it was
 *
 * @param change The change
 * @param saved The translation and its hash, or the note, as saved (SaveConflict.saved)
 * @param keepMine True to keep the change's text, false to take the one saved
 * @return The change to save
 */
export function settleTextConflict<Change extends MergedTextChange>(change: Change, saved: Record<string, unknown>, keepMine: boolean): Change
{
	const savedText = ((change.kind === 'saveTranslation') ? saved.translation : saved.note);
	const text = ((typeof savedText === 'string') ? savedText : null);

	if (keepMine)
	{
		return({ ...change, loaded: text });
	}

	if (change.kind === 'saveTranslation')
	{
		return({
			...change,
			translation: text,
			sourceHash: ((typeof saved.sourceHash === 'string') ? saved.sourceHash : change.sourceHash),
			loaded: text
		});
	}

	return({ ...change, note: text, loaded: text });
}
