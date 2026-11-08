/**
 * Merging a save's changes to settings with what is saved, so editors changing different settings of the
 * same thing both save (see Editing together in STRUCTURE-OVERVIEW.md and shared/src/fieldMerge.ts). A
 * setting another editor changed since it was loaded, to something other than the change's value,
 * conflicts; the save is refused with each such setting, for the editor to settle. A translation or a
 * note for translators conflicts the same way, as a whole
 */
import { changeSettings, changeText, flattenSettings, isMergedChange, isMergedTextChange, mergeSettings, sameValue, unflattenSettings, withChangeSettings, type AuditFieldChange, type EditorChange, type FlatSettings, type MergedTextChange, type SaveConflict } from '@multiverse-kiln/shared';

import { findLastSaver } from '../db/universeEditRepo.js';
import type { ChangeContext } from './editorChangeContext.js';
import { isAuditField, settingGroup, type SaveAudit } from './editorSaveAudit.js';
import { findSavedText } from './editorTranslations.js';

/**
 * Merges each change to settings in one save with what is saved, as the save meets it
 */
export class SaveMerge
{
	/**
	 * The settings that conflict, in the order of the changes
	 */
	readonly conflicts: SaveConflict[] = [];

	/**
	 * @param context The save
	 * @param audit The save's record, which finds what each change meets as saved
	 */
	constructor(private readonly context: ChangeContext, private readonly audit: SaveAudit)
	{
	}

	/**
	 * Merges a change's settings with what is saved, noting the settings that conflict. Call it just
	 * before the change is described and saved. A change without loaded settings, or one naming
	 * something that doesn't exist (which its module then refuses), stays as it is
	 *
	 * @param index The change's place in the save
	 * @param change The change
	 * @return The change to save, without loaded settings; null for a translation or note that saves
	 * what is saved, which is skipped
	 */
	async merge(index: number, change: EditorChange): Promise<EditorChange | null>
	{
		if (isMergedTextChange(change))
		{
			return(this.mergeText(index, change));
		}

		if (!isMergedChange(change) || (change.loaded === undefined))
		{
			return(change);
		}

		const found = await this.audit.savedSettings(change);

		if (!found)
		{
			return(change);
		}

		const shape = changeSettings(change);
		const sent = flattenSettings(shape);
		const saved = flattenSettings(found.saved);
		const loaded = flattenSettings(change.loaded);
		const { merged, conflicts } = mergeSettings(saved, loaded, sent, (key) => settingGroup(found.subject, key));

		for (const keys of conflicts)
		{
			this.conflicts.push(await this.describe(index, found, keys, {
				sent,
				saved,
				loaded
			}));
		}

		return(withChangeSettings(change, unflattenSettings(merged, shape), undefined));
	}

	/**
	 * Compares a translation or note for translators with the one saved. One saving what is saved (a
	 * translation with the same source text hash too) saves nothing. With the text loaded, it conflicts
	 * when another editor saved something else since, unless that is what the change saves
	 *
	 * @param index The change's place in the save
	 * @param change The change
	 * @return The change to save, without the text loaded, or null to skip it
	 */
	private async mergeText(index: number, change: MergedTextChange): Promise<MergedTextChange | null>
	{
		const sent = { ...change, loaded: undefined };
		const found = await findSavedText(this.context, change);

		if (!found)
		{
			return(sent);
		}

		const mine = changeText(change);
		const sameHash = ((change.kind === 'saveTranslatorNote') || (mine === null) || (change.sourceHash === found.sourceHash));

		if ((mine === found.text) && sameHash)
		{
			return(null);
		}

		if ((change.loaded !== undefined) && (found.text !== change.loaded) && (found.text !== mine))
		{
			this.conflicts.push({
				changeIndex: index,
				subject: ((change.kind === 'saveTranslation') ? 'translations' : 'translatorNotes'),
				target: ((found.language === null) ? null : { key: null, name: found.language }),
				field: null,
				saved: ((change.kind === 'saveTranslation')
					? {
						translation: found.text,
						sourceHash: found.sourceHash
					}
					: {
						note: found.text
					}),
				text: {
					place: found.place,
					mine,
					theirs: found.text
				},
				mine: null,
				theirs: null,
				savedBy: found.savedBy
			});
		}

		return(sent);
	}

	/**
	 * A conflicting setting as the editor shows it to settle. A setting the Audit tab shows as several
	 * fields (a class's starting area and its areas by race) shows each side by the field it changed
	 *
	 * @param index The change's place in the save
	 * @param found What the change changes, as savedSettings() found it
	 * @param keys The settings that make up the setting, by key
	 * @param settings The change's settings, the thing's as saved and those the editor loaded, each flattened
	 * @return The conflict
	 */
	private async describe(index: number, found: NonNullable<Awaited<ReturnType<SaveAudit['savedSettings']>>>, keys: readonly string[], settings: { sent: FlatSettings; saved: FlatSettings; loaded: FlatSettings }): Promise<SaveConflict>
	{
		const { sent, saved, loaded } = settings;
		const group = settingGroup(found.subject, keys[0]);
		const field = (isAuditField(group) ? group : null);
		const mineValues = Object.fromEntries(keys.map((key) => [key, sent[key]]));
		const savedValues = Object.fromEntries(keys.map((key) => [key, saved[key]]));
		const loadedValues = Object.fromEntries(keys
			.filter((key) => (key in loaded))
			.map((key) => [key, loaded[key]]));
		const loadedFields = await this.audit.describeSettings(found.subject, found.saved, loadedValues);
		const mine = changedField(await this.audit.describeSettings(found.subject, found.saved, mineValues), loadedFields);
		const theirs = changedField(await this.audit.describeSettings(found.subject, found.saved, savedValues), loadedFields);
		const savedByField = (theirs?.field ?? field);
		const savedBy = ((savedByField === null)
			? undefined
			: await findLastSaver(this.context.universe.id, this.context.version.draft, {
				subject: found.subject,
				id: found.id,
				field: savedByField
			}, this.context.transaction));

		return({
			changeIndex: index,
			subject: found.subject,
			target: found.target,
			field,
			saved: savedValues,
			text: null,
			mine: (mine ?? null),
			theirs: (theirs ?? null),
			savedBy: (savedBy ?? null)
		});
	}
}

/**
 * The field one side of a conflict is shown by: of the fields the setting is shown as, the first that
 * side changed from what was loaded and gives a value, as a choice shows what it sets rather than what it
 * empties, or else the first it changed
 *
 * @param fields The setting's fields with that side's values, in order
 * @param loadedFields The same fields with the values loaded
 * @return The field, or undefined for a setting the Audit tab doesn't name
 */
function changedField(fields: readonly AuditFieldChange[], loadedFields: readonly AuditFieldChange[]): AuditFieldChange | undefined
{
	const changed = fields.filter((change) => !sameValue(change.value, loadedFields.find((loadedField) => (loadedField.field === change.field))?.value));

	return((changed.find((change) => hasValue(change.value)) ?? changed[0] ?? fields[0]));
}

/**
 * Whether a field's value sets something: not none, and not an empty list
 *
 * @param value The value
 * @return True when it does
 */
function hasValue(value: unknown): boolean
{
	return((value !== null) && (value !== undefined) && (!Array.isArray(value) || (value.length > 0)));
}
