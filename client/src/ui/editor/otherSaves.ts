import type { AuditAction, AuditField, AuditSubject, SavedEditDetail, UniverseSettings } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { auditFieldName } from './auditDetails';
import type { ChangeSource } from './stagedChanges';

/**
 * A save made in another window, as the editor's tabs follow it (see Editing together in
 * STRUCTURE-OVERVIEW.md)
 */
export interface OtherSave
{
	/**
	 * The display name of who saved
	 */
	name: string;

	/**
	 * What the save changed that this window shows, with the ID of each thing
	 */
	details: readonly SavedEditDetail[];
}

/**
 * A part of an editor tab that keeps up with saves made in other windows
 */
export interface FollowsOtherSaves
{
	/**
	 * Shows what another window saved: updates what the part has no unsaved changes to, and marks what it
	 * does, leaving those changes as they are
	 *
	 * @param save The save
	 * @return True when the part has unsaved changes to something the save changed
	 */
	otherSaved(save: OtherSave): boolean;
}

/**
 * What saves in other windows did to one thing the player has unsaved changes to
 */
interface ChangedSince
{
	/**
	 * Who saved, by display name, in the order they did
	 */
	names: string[];

	/**
	 * What the latest save did to it
	 */
	action: AuditAction;

	/**
	 * The settings they changed
	 */
	fields: Set<AuditField>;
}

/**
 * The words that mark a thing another editor saved while the player had unsaved changes to it, e.g. "Bea
 * changed Name and Speed since you opened this"
 *
 * @param changed What the saves did to it
 * @return The words
 */
function describeChangedSince(changed: ChangedSince): string
{
	return(t({
		id: 'editor.changedSince',
		defaultMessage: '{action, select, deleted {{names} deleted this since you opened it.} restored {{names} restored this to its default since you opened it.} other {{fieldCount, plural, =0 {{names} changed this since you opened it.} other {{names} changed {fields} since you opened this.}}}}',
		description: 'In the world editor, under something the player has unsaved changes to (a race, item, tile, the universe\'s settings and so on) that another editor saved changes to in the meantime; the player\'s changes stay as they are. {names} is who saved, by display name, {fields} the settings they changed, e.g. "Name and Speed", and {fieldCount} how many'
	}, {
		action: changed.action,
		names: formatList(changed.names, 'conjunction'),
		fields: formatList([...changed.fields].map((field) => auditFieldName(field)), 'conjunction'),
		fieldCount: changed.fields.size
	}));
}

/**
 * Adds what saves in other windows did to one thing to what is known of it
 *
 * @param known What earlier saves did to it, or undefined when none did
 * @param name Who saved this time
 * @param detail What this save did to it
 * @return What the saves did to it
 */
function addChangedSince(known: ChangedSince | undefined, name: string, detail: SavedEditDetail): ChangedSince
{
	const changed = (known ?? { names: [], action: detail.action, fields: new Set<AuditField>() });

	if (!changed.names.includes(name))
	{
		changed.names.push(name);
	}

	changed.action = detail.action;

	for (const change of detail.fields)
	{
		changed.fields.add(change.field);
	}

	return(changed);
}

/**
 * Creates the line marking something another editor saved while the player had unsaved changes to it
 *
 * @param text The words, from describeChangedSince()
 * @return The line
 */
function createChangedSinceLine(text: string): HTMLParagraphElement
{
	const line = document.createElement('p');

	line.className = 'changed-since';
	line.textContent = text;

	return(line);
}

/**
 * The things in one of an editor tab's lists that saves in other windows changed while the player had
 * unsaved changes to them, by ID, each marked in its row until those changes are saved or taken back
 */
export class ChangedSinceNotes
{
	private readonly notes = new Map<number | string, ChangedSince>();

	/**
	 * @param subject What the list holds, as the Audit tab names it
	 */
	constructor(private readonly subject: AuditSubject)
	{
	}

	/**
	 * Takes note of what a save in another window did to the list
	 *
	 * @param save The save
	 * @param isStaged Whether the player has unsaved changes to a thing, by its ID
	 * @return Whether the save changed the list at all, and whether it changed something the player has
	 * unsaved changes to
	 */
	follow(save: OtherSave, isStaged: (id: number | string) => boolean): { changed: boolean; kept: boolean }
	{
		let changed = false;
		let kept = false;

		for (const detail of save.details)
		{
			if (detail.subject !== this.subject)
			{
				continue;
			}

			changed = true;

			if ((detail.id !== null) && isStaged(detail.id))
			{
				this.notes.set(detail.id, addChangedSince(this.notes.get(detail.id), save.name, detail));
				kept = true;
			}
		}

		return({ changed, kept });
	}

	/**
	 * Marks a thing in its list when a save in another window changed it while the player had unsaved
	 * changes to it, and forgets the note once those changes are gone
	 *
	 * @param cell Where in the thing's row the mark goes: the cell with its name
	 * @param id The thing's ID
	 * @param staged Whether the player still has unsaved changes to it
	 */
	mark(cell: HTMLElement | undefined, id: number | string, staged: boolean): void
	{
		const changed = this.notes.get(id);

		if (!changed)
		{
			return;
		}

		if (!staged)
		{
			this.notes.delete(id);
			return;
		}

		cell?.append(createChangedSinceLine(describeChangedSince(changed)));
	}

	/**
	 * Moves the notes of things a save in another window deleted to the new things their changes here
	 * are kept as, and forgets those whose changes were dropped
	 *
	 * @param followed The ID each has as a new thing, or undefined, by the ID it had, from
	 * StagedChanges.followDeleted()
	 */
	move(followed: ReadonlyMap<number | string, number | string | undefined>): void
	{
		for (const [id, newId] of followed)
		{
			const changed = this.notes.get(id);

			this.notes.delete(id);

			if (changed && (newId !== undefined))
			{
				this.notes.set(newId, changed);
			}
		}
	}

	/**
	 * Forgets every note, such as when the list is loaded for another universe
	 */
	clear(): void
	{
		this.notes.clear();
	}
}

/**
 * An editor dialog for one thing in a list, such as the race editor, as it follows saves made in other
 * windows
 */
export interface FollowingDialog
{
	/**
	 * Whether the dialog is open
	 *
	 * @return True when it is
	 */
	isOpen(): boolean;

	/**
	 * Whether the dialog has changes that haven't been applied to its tab
	 *
	 * @return True when it has
	 */
	hasUnappliedChanges(): boolean;

	/**
	 * Says at the top of the dialog what a save in another window changed in the thing it shows
	 *
	 * @param name Who saved
	 * @param details What the save changed in the thing
	 */
	noteChangedSince(name: string, details: readonly SavedEditDetail[]): void;

	/**
	 * Closes the dialog, such as once another window deleted the thing it shows
	 */
	close(): void;
}

/**
 * What an editor dialog for one thing in a list does to follow saves made in other windows, for the
 * dialog to hold: the line under its title saying what changed, and showing it afresh while it is open
 */
export class FollowedDialog implements FollowingDialog
{
	private readonly line: ChangedSinceLine;

	/**
	 * @param dialog The dialog
	 * @param title Its title, under which the line saying what changed goes
	 * @param changes The dialog's changes not yet applied
	 */
	constructor(private readonly dialog: HTMLDialogElement, title: HTMLElement, private readonly changes: ChangeSource)
	{
		this.line = new ChangedSinceLine(title, changes, 'after');
	}

	/**
	 * Whether the dialog is open
	 *
	 * @return True when it is
	 */
	isOpen(): boolean
	{
		return(this.dialog.open);
	}

	/**
	 * Whether the dialog has changes that haven't been applied to its tab
	 *
	 * @return True when it has
	 */
	hasUnappliedChanges(): boolean
	{
		return(this.changes.hasUnsavedChanges());
	}

	/**
	 * Says under the dialog's title what a save in another window changed in the thing it shows
	 *
	 * @param name Who saved
	 * @param details What the save changed in the thing
	 */
	noteChangedSince(name: string, details: readonly SavedEditDetail[]): void
	{
		this.line.add(name, details);
	}

	/**
	 * Closes the dialog
	 */
	close(): void
	{
		this.dialog.close();
	}

	/**
	 * Shows the dialog once it has been filled, without the line saying what changed. A dialog open
	 * already, showing its thing afresh, stays as it is, keeping the focus where the player left it
	 */
	show(): void
	{
		this.line.hide();

		if (!this.dialog.open)
		{
			this.dialog.showModal();
		}
	}
}

/**
 * Keeps a list's editor dialog up with saves made in other windows: a dialog showing something a save
 * changed shows it afresh once the list has loaded again, or closes when the save deleted it, while
 * neither the dialog nor the tab has unsaved changes to it; otherwise the dialog says what changed
 */
export class DialogFollower
{
	/**
	 * The thing the dialog was last opened on, or undefined for a new one
	 */
	private openedId: number | string | undefined;

	/**
	 * What the save being followed changed in the thing, until the dialog shows it afresh
	 */
	private pending: { name: string; details: readonly SavedEditDetail[] } | undefined;

	/**
	 * @param dialog The dialog
	 * @param subject What the list holds, as the Audit tab names it
	 */
	constructor(private readonly dialog: FollowingDialog, private readonly subject: AuditSubject)
	{
	}

	/**
	 * Remembers what the dialog was opened on
	 *
	 * @param id The thing's ID, or undefined for a new one
	 */
	opened(id: number | string | undefined): void
	{
		this.openedId = id;
		this.pending = undefined;
	}

	/**
	 * Follows a save made in another window
	 *
	 * @param save The save
	 * @param isStaged Whether the tab has unsaved changes to a thing, by its ID
	 * @return The ID of the thing to show afresh once the list has loaded again (reopen()), or undefined;
	 * and whether the dialog or the tab has unsaved changes to the thing the save changed
	 */
	follow(save: OtherSave, isStaged: (id: number | string) => boolean): { reopen: number | string | undefined; kept: boolean }
	{
		const id = this.openedId;

		if ((id === undefined) || !this.dialog.isOpen())
		{
			return({ reopen: undefined, kept: false });
		}

		const details = save.details.filter((detail) => ((detail.subject === this.subject) && (detail.id === id)));

		if (details.length === 0)
		{
			return({ reopen: undefined, kept: false });
		}

		if (this.dialog.hasUnappliedChanges() || isStaged(id))
		{
			this.dialog.noteChangedSince(save.name, details);
			return({ reopen: undefined, kept: true });
		}

		if (details.some((detail) => (detail.action === 'deleted')))
		{
			this.dialog.close();
			return({ reopen: undefined, kept: false });
		}

		this.pending = {
			name: save.name,
			details
		};

		return({ reopen: id, kept: false });
	}

	/**
	 * Shows the thing afresh in the dialog once the list has loaded again, unless the dialog has moved
	 * on or the player has started changing it meanwhile. One the list doesn't show, such as an item on
	 * another page, gets the note instead
	 *
	 * @param id The thing's ID, from follow()
	 * @param find The thing as the list now shows it, by its ID
	 * @param open Opens the dialog on it
	 */
	reopen<T>(id: number | string | undefined, find: (id: number | string) => T | undefined, open: (item: T) => void): void
	{
		const pending = this.pending;

		if ((id === undefined) || (id !== this.openedId) || !pending || !this.dialog.isOpen())
		{
			return;
		}

		const item = find(id);

		if (this.dialog.hasUnappliedChanges() || (item === undefined))
		{
			this.dialog.noteChangedSince(pending.name, pending.details);
			this.pending = undefined;
			return;
		}

		open(item);
	}
}

/**
 * The forms on the editor's tabs that hold the universe's settings
 */
export type SettingsForm = 'universe' | 'lobby' | 'characters' | 'coins' | 'translations';

/**
 * The settings each form holds: as the Audit tab names them, and as the universe holds them, which a form
 * with unsaved changes keeps when the universe is loaded again. The forms load in this order: the coins
 * before the characters, whose starting money is written in the coins' abbreviations
 */
export const SETTINGS_FORMS: Readonly<Record<SettingsForm, { fields: ReadonlySet<AuditField>; keys: readonly (keyof UniverseSettings)[] }>> = {
	universe: {
		fields: new Set(['name', 'shortDescription', 'longDescription', 'stage', 'passageOfTime', 'displayTime']),
		keys: ['name', 'shortDescription', 'longDescription', 'stage', 'passageOfTime', 'faerieMorning', 'displayTime']
	},
	lobby: {
		fields: new Set(['lobbyPassageOfTime', 'lobbyDayHours', 'lobbyNoVisionCost', 'lobbyArea']),
		keys: ['lobbyPassageOfTime', 'lobbyDayHours', 'lobbyFaerieMorning', 'lobbyNoVisionCost', 'lobbyAreaId', 'lobbyColumn', 'lobbyRow']
	},
	coins: {
		fields: new Set(['coinNames', 'coinAbbreviations']),
		keys: ['coinNames', 'coinAbbreviations']
	},
	characters: {
		fields: new Set(['groupSize', 'startingMoney', 'startingItems', 'startingArea']),
		keys: ['groupSize', 'startingMoney', 'startingItems', 'startingAreaId', 'startingColumn', 'startingRow']
	},
	translations: {
		fields: new Set(['sourceLanguage', 'translationLanguages']),
		keys: ['sourceLanguage', 'translationLanguages']
	}
};

/**
 * Which of a form's settings a save changes
 */
export interface FormSettings
{
	/**
	 * What the form's settings are part of, as the Audit tab names it
	 */
	subject: 'settings' | 'ruleset';

	/**
	 * The form's settings as the Audit tab names them, or undefined for every setting of the subject
	 */
	fields?: ReadonlySet<AuditField>;
}

/**
 * The line at the top of a form, such as the universe's settings or the area editor, saying who changed
 * what in other windows while the player had unsaved changes there. It goes once those changes are
 * gone, saved or thrown away
 */
export class ChangedSinceLine
{
	private readonly line = createChangedSinceLine('');

	private changedSince: ChangedSince | undefined;

	/**
	 * @param anchor Where the line goes: at the top of the form, or after its title
	 * @param changes The form's unsaved changes
	 * @param position start to put the line at the top of the anchor, after to put it after the anchor
	 */
	constructor(anchor: HTMLElement, changes: ChangeSource, position: 'start' | 'after' = 'start')
	{
		this.line.hidden = true;

		if (position === 'start')
		{
			anchor.prepend(this.line);
		}
		else
		{
			anchor.after(this.line);
		}

		changes.subscribe((unsaved) =>
		{
			if (!unsaved)
			{
				this.hide();
			}
		});
	}

	/**
	 * Adds what a save in another window changed to the line, and shows it
	 *
	 * @param name Who saved
	 * @param details What the save changed in the form
	 */
	add(name: string, details: readonly SavedEditDetail[]): void
	{
		for (const detail of details)
		{
			this.changedSince = addChangedSince(this.changedSince, name, detail);
		}

		if (this.changedSince)
		{
			this.line.textContent = describeChangedSince(this.changedSince);
			this.line.hidden = false;
		}
	}

	/**
	 * Takes the line away, such as when the form is loaded again
	 */
	hide(): void
	{
		this.changedSince = undefined;
		this.line.hidden = true;
		this.line.textContent = '';
	}
}

/**
 * Keeps a form on an editor tab, such as the universe's settings, up with saves made in other windows: a
 * form without unsaved changes loads again, and one with them keeps them and says above its fields who
 * changed which settings meanwhile, until it is saved or loaded again
 */
export class FormFollower implements FollowsOtherSaves
{
	private readonly line: ChangedSinceLine;

	/**
	 * @param form The form, above whose fields the note goes
	 * @param settings Which settings the form has
	 * @param changes The form's unsaved changes
	 * @param reload Loads the form again, as the server has it. When the form has unsaved changes by the
	 * time the settings arrive, it keeps them and calls kept instead, which notes the save
	 */
	constructor(form: HTMLElement, private readonly settings: FormSettings, private readonly changes: ChangeSource, private readonly reload: (kept: () => void) => void)
	{
		this.line = new ChangedSinceLine(form, changes);
	}

	/**
	 * Loads the form again when a save in another window changed its settings and it has no unsaved
	 * changes, or notes who changed which while it has
	 *
	 * @param save The save
	 * @return True when the form has unsaved changes and the save changed its settings
	 */
	otherSaved(save: OtherSave): boolean
	{
		const changed = save.details
			.filter((detail) => (detail.subject === this.settings.subject))
			.map((detail) => ({
				...detail,
				fields: detail.fields.filter((change) => (this.settings.fields?.has(change.field) ?? true))
			}))
			.filter((detail) => (detail.fields.length > 0));

		if (changed.length === 0)
		{
			return(false);
		}

		if (!this.changes.hasUnsavedChanges())
		{
			this.line.hide();
			this.reload(() =>
			{
				this.line.add(save.name, changed);
			});
			return(false);
		}

		this.line.add(save.name, changed);

		return(true);
	}

	/**
	 * Takes the note away, such as when the universe is opened again
	 */
	hideNote(): void
	{
		this.line.hide();
	}
}
