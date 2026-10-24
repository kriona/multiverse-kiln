import { defineMessages } from '@multiverse-kiln/shared';
import restoreIcon from 'virtual:icon/ph:arrow-counter-clockwise';
import undoIcon from 'virtual:icon/ph:arrow-u-up-left';
import trashIcon from 'virtual:icon/ph:trash';

import { formatList, t } from '../../localization';
import { describeEditorError } from '../../network/editorApi';
import { refreshUnsavedWork, watchUnsavedWork, type UnsavedWork } from '../changeTracker';
import { setButtonLabel } from '../dom';

/**
 * Something on an editor tab that may hold changes not yet saved, and says when that changes, such as a
 * form's ChangeTracker or a list's StagedChanges
 */
export interface ChangeSource extends UnsavedWork
{
	/**
	 * Hears when it starts or stops having unsaved changes
	 *
	 * @param listener Called with whether it has them
	 * @return Stops listening
	 */
	subscribe(listener: (unsaved: boolean) => void): () => void;
}

/**
 * One change to a list made in the editor and kept on the page until its tab is saved. A new thing has a
 * negative ID until it is saved
 *
 * - create: adds a thing
 * - save: changes a thing's settings
 * - remove: deletes a thing the universe added, or restores one of the ruleset's defaults it changed
 */
export type StagedChange<S> =
	| { kind: 'create'; id: number; settings: S }
	| { kind: 'save'; id: number; settings: S }
	| { kind: 'remove'; id: number };

/**
 * The routes that save a list's changes
 */
export interface StagedApi<S>
{
	/**
	 * Adds a thing
	 *
	 * @param settings Its settings
	 * @return Its ID
	 */
	create(settings: S): Promise<number>;

	/**
	 * Changes a thing's settings
	 *
	 * @param id Its ID
	 * @param settings Its settings
	 */
	save(id: number, settings: S): Promise<void>;

	/**
	 * Deletes a thing the universe added, or restores a default it changed
	 *
	 * @param id Its ID
	 */
	remove(id: number): Promise<void>;
}

/**
 * The change the server refused while saving, and why
 */
export interface CommitFailure<S>
{
	change: StagedChange<S>;
	error: unknown;
}

/**
 * How a thing in a list differs from what is saved
 *
 * - new: added, and not saved yet
 * - changed: has changes that aren't saved yet
 * - removed: will be deleted, or restored to the ruleset's default, when saved
 */
export type StagedState = 'new' | 'changed' | 'removed' | undefined;

/**
 * What a list's editor dialog does with a thing, keeping its changes on the page until the tab is saved
 */
export interface StagedEdit<S>
{
	/**
	 * Whether the thing will be deleted or restored when the tab is saved
	 */
	readonly removed: boolean;

	/**
	 * Keeps the dialog's settings: changes the thing, or adds it when it is new
	 *
	 * @param settings The settings
	 */
	apply(settings: S): void;

	/**
	 * Deletes the thing, or restores the default it changed, when the tab is saved
	 */
	remove(): void;

	/**
	 * Takes back remove()
	 */
	undoRemove(): void;
}

/**
 * Text about changes kept on the page (see src/localization.ts)
 */
const messages = defineMessages({
	newTag: {
		id: 'editor.staged.newTag',
		defaultMessage: 'new',
		description: 'In the last column of an editor list (races, classes, themes, difficulty levels, items or tiles), or under an area in the list of areas, for one added since the tab was last saved, which isn\'t saved yet'
	},
	deleted: {
		id: 'editor.staged.deleted',
		defaultMessage: '(deleted when saved)',
		description: 'Read out by screen readers after the name of a race, class, theme, difficulty level, item, tile or area in an editor list that will be deleted when the tab is saved; on screen the row is struck through'
	},
	restoredTag: {
		id: 'editor.staged.restoredTag',
		defaultMessage: 'restored when saved',
		description: 'In the last column of an editor list (races, classes, themes, items or tiles), for one of the ruleset\'s that will be put back as the ruleset has it when the tab is saved'
	},
	saveFailed: {
		id: 'editor.staged.saveFailed',
		defaultMessage: 'Could not save {name}.',
		description: 'Shown on an editor tab when saving its changes stopped at one the server refused; {name} is the name of the race, class, theme, difficulty level, item or tile. Changes after it are kept, not saved'
	},
	deleteFailed: {
		id: 'editor.staged.deleteFailed',
		defaultMessage: 'Could not delete {name}.',
		description: 'Shown on an editor tab when saving its changes stopped at a deletion the server refused; {name} is the name of the race, class, theme, difficulty level, item or tile. Changes after it are kept, not saved'
	},
	undoDelete: {
		id: 'editor.staged.undoDelete',
		defaultMessage: 'Undo Delete',
		description: 'Button in an editor dialog (race, class, theme, difficulty level, item or tile), or in the area editor, for one that will be deleted when the tab is saved: keeps it instead'
	},
	undoRestore: {
		id: 'editor.staged.undoRestore',
		defaultMessage: 'Undo Restore',
		description: 'Button in an editor dialog (race, class, theme, item or tile) for one of the ruleset\'s that will be put back as the ruleset has it when the tab is saved: keeps the universe\'s changes instead'
	},
	restoreFailed: {
		id: 'editor.staged.restoreFailed',
		defaultMessage: 'Could not restore {name}.',
		description: 'Shown on an editor tab when saving its changes stopped at putting one of the ruleset\'s races, classes, themes, items or tiles back as the ruleset has it; {name} is its name. Changes after it are kept, not saved'
	}
});

/**
 * The changes made to one list on an editor tab, kept in the order they were made until the tab is
 * saved. Saving sends them to the server in that order, so each one meets the list as it was when it
 * was made
 */
export class StagedChanges<S> implements ChangeSource
{
	private changes: StagedChange<S>[] = [];

	/**
	 * The ID the next new thing gets: negative, so it never matches a saved one
	 */
	private nextNewId = -1;

	private readonly listeners = new Set<(unsaved: boolean) => void>();

	constructor()
	{
		watchUnsavedWork(this);
	}

	/**
	 * Whether there are changes that haven't been saved
	 *
	 * @return True when there are
	 */
	hasUnsavedChanges(): boolean
	{
		return(this.changes.length > 0);
	}

	/**
	 * Hears when the list starts or stops having unsaved changes, and when they change
	 *
	 * @param listener Called with whether it has them
	 * @return Stops listening
	 */
	subscribe(listener: (unsaved: boolean) => void): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}

	/**
	 * The changes, in the order they were made
	 *
	 * @return The changes
	 */
	list(): readonly StagedChange<S>[]
	{
		return(this.changes);
	}

	/**
	 * Adds a thing
	 *
	 * @param settings Its settings
	 * @return Its ID until it is saved, which is negative
	 */
	create(settings: S): number
	{
		const id = this.nextNewId--;

		this.changes.push({ kind: 'create', id, settings });
		this.changed();

		return(id);
	}

	/**
	 * Changes a thing's settings
	 *
	 * @param id Its ID
	 * @param settings Its settings
	 */
	save(id: number, settings: S): void
	{
		this.changes.push({ kind: 'save', id, settings });
		this.changed();
	}

	/**
	 * Deletes a thing, or restores a default it changed. A thing added since the last save just goes
	 *
	 * @param id Its ID
	 */
	remove(id: number): void
	{
		if (isNewId(id))
		{
			this.changes = this.changes.filter((change) => (change.id !== id));
		}
		else
		{
			this.changes.push({ kind: 'remove', id });
		}

		this.changed();
	}

	/**
	 * Takes back deleting or restoring a thing
	 *
	 * @param id Its ID
	 */
	undoRemove(id: number): void
	{
		this.changes = this.changes.filter((change) => ((change.kind !== 'remove') || (change.id !== id)));
		this.changed();
	}

	/**
	 * A thing's settings as changed since the last save
	 *
	 * @param id Its ID
	 * @return The settings, or undefined when it hasn't been changed
	 */
	settingsOf(id: number): S | undefined
	{
		let settings: S | undefined;

		for (const change of this.changes)
		{
			if ((change.id === id) && (change.kind !== 'remove'))
			{
				settings = change.settings;
			}
		}

		return(settings);
	}

	/**
	 * Whether a thing will be deleted or restored when saved
	 *
	 * @param id Its ID
	 * @return True when it will
	 */
	isRemoved(id: number): boolean
	{
		return(this.changes.some((change) => ((change.kind === 'remove') && (change.id === id))));
	}

	/**
	 * The things added since the last save
	 *
	 * @return Each one's ID and settings, in the order they were added
	 */
	created(): { id: number; settings: S }[]
	{
		return(this.changes
			.filter((change) => (change.kind === 'create'))
			.map((change) => ({
				id: change.id,
				settings: (this.settingsOf(change.id) ?? change.settings)
			})));
	}

	/**
	 * How a thing differs from what is saved
	 *
	 * @param id Its ID
	 * @return How, or undefined when it doesn't
	 */
	stateOf(id: number): StagedState
	{
		if (this.isRemoved(id))
		{
			return('removed');
		}

		if (isNewId(id))
		{
			return('new');
		}

		return(((this.settingsOf(id) === undefined) ? undefined : 'changed'));
	}

	/**
	 * What an editor dialog does with a thing, or with a new one
	 *
	 * @param id The thing's ID, or undefined for a new one
	 * @return Its staged edit
	 */
	edit(id: number | undefined): StagedEdit<S>
	{
		return({
			removed: ((id !== undefined) && this.isRemoved(id)),
			apply: (settings) =>
			{
				if (id === undefined)
				{
					this.create(settings);
				}
				else
				{
					this.save(id, settings);
				}
			},
			remove: () =>
			{
				if (id !== undefined)
				{
					this.remove(id);
				}
			},
			undoRemove: () =>
			{
				if (id !== undefined)
				{
					this.undoRemove(id);
				}
			}
		});
	}

	/**
	 * Throws every change away
	 */
	clear(): void
	{
		this.changes = [];
		this.changed();
	}

	/**
	 * Sends the changes to the server in the order they were made, stopping at the first one it refuses.
	 * The ones it took are no longer unsaved; the rest are kept
	 *
	 * @param api The routes that save them
	 * @return The change it refused and why, or undefined when every change was saved
	 */
	async commit(api: StagedApi<S>): Promise<CommitFailure<S> | undefined>
	{
		try
		{
			while (this.changes.length > 0)
			{
				const [change, ...rest] = this.changes;

				try
				{
					if (change.kind === 'create')
					{
						const savedId = await api.create(change.settings);

						// Later changes to the new thing go to the ID it was saved with
						this.changes = rest.map((later) => ((later.id === change.id) ? { ...later, id: savedId } : later));
						continue;
					}

					if (change.kind === 'save')
					{
						await api.save(change.id, change.settings);
					}
					else
					{
						await api.remove(change.id);
					}

					this.changes = rest;
				}
				catch (error)
				{
					return({ change, error });
				}
			}

			return(undefined);
		}
		finally
		{
			this.changed();
		}
	}

	/**
	 * Tells the listeners and the page that the changes changed
	 */
	private changed(): void
	{
		const unsaved = this.hasUnsavedChanges();

		refreshUnsavedWork();

		for (const listener of this.listeners)
		{
			listener(unsaved);
		}
	}
}

/**
 * Whether an ID is a thing's that hasn't been saved yet
 *
 * @param id The ID
 * @return True for a new thing
 */
export function isNewId(id: number): boolean
{
	return(id < 0);
}

/**
 * Shows a saved list with the changes made to it since: changed settings in place, and the things added
 * at the end
 *
 * @param saved The list as the server has it
 * @param staged The changes
 * @param merge A saved thing with changed settings
 * @param created A new thing from its settings
 * @return Each thing, with how it differs from what is saved
 */
export function stagedView<T extends { id: number }, S>(saved: readonly T[], staged: StagedChanges<S>, merge: (item: T, settings: S) => T, created: (id: number, settings: S) => T): { item: T; state: StagedState }[]
{
	return([
		...saved.map((item) =>
		{
			const settings = staged.settingsOf(item.id);

			return({
				item: ((settings === undefined) ? item : merge(item, settings)),
				state: staged.stateOf(item.id)
			});
		}),
		...staged.created().map(({ id, settings }) => ({
			item: created(id, settings),
			state: staged.stateOf(id)
		}))
	]);
}

/**
 * One page of a paged list of the ruleset's defaults and the universe's own things (items or tiles), with
 * the changes made since it was loaded. The things added since go first on the first page, whatever the
 * list's filters, since the server hasn't sorted or filtered them yet
 *
 * @param page The page as the server sent it
 * @param staged The changes
 * @param firstPage Whether it is the first page
 * @param created A new thing from its settings
 * @return Each thing to show, with how it differs from what is saved
 */
export function stagedPage<T extends { id: number; custom: boolean; edited: boolean }, S>(page: readonly T[], staged: StagedChanges<S>, firstPage: boolean, created: (id: number, settings: S) => T): { item: T; state: StagedState }[]
{
	const view = stagedView(page, staged, (item, settings) => ({
		...item,
		...settings,
		edited: (item.custom ? item.edited : true)
	}), created);

	return([
		...(firstPage ? view.filter(({ state }) => (state === 'new')) : []),
		...view.filter(({ state }) => (state !== 'new'))
	]);
}

/**
 * Words for a thing added or restored since the last save, for a list's last column. A changed thing gets
 * none: the list shows its changes, and a default the universe changed is tagged edited. A deleted one's
 * row is struck through (markStagedRow)
 *
 * @param state How it differs from what is saved
 * @param isDefault Whether it is one of the ruleset's defaults, which removing restores rather than deletes
 * @return The words, or undefined for none
 */
export function stagedTag(state: StagedState, isDefault: boolean): string | undefined
{
	switch (state)
	{
		case 'new':
			return(t(messages.newTag));
		case 'removed':
			// A row being deleted is struck through instead (markStagedRow)
			return((isDefault ? t(messages.restoredTag) : undefined));
		default:
			return(undefined);
	}
}

/**
 * Strikes through a list's row for a thing that will be deleted when the tab is saved, and says so after
 * its name for screen readers
 *
 * @param row The row, whose name is a link button
 * @param state How the thing differs from what is saved
 * @param isDefault Whether it is one of the ruleset's defaults, which removing restores rather than deletes
 * @return The row
 */
export function markStagedRow(row: HTMLTableRowElement, state: StagedState, isDefault: boolean): HTMLTableRowElement
{
	if ((state !== 'removed') || isDefault)
	{
		return(row);
	}

	row.classList.add('staged-deleted');
	row.querySelector('.link-button')?.append(deletedNote());

	return(row);
}

/**
 * Words after the name of a thing that will be deleted when its tab is saved, for screen readers; on
 * screen it is struck through
 *
 * @return The words, to append to the name
 */
export function deletedNote(): HTMLSpanElement
{
	const note = document.createElement('span');

	note.className = 'visually-hidden';
	note.textContent = ` ${t(messages.deleted)}`;

	return(note);
}

/**
 * Labels the button in a list's editor dialog that deletes a thing the universe added or restores a
 * default it changed, or takes that back once it has been done
 *
 * @param button The button
 * @param edit Whether the thing will be deleted or restored, such as the dialog's staged edit
 * @param isDefault Whether the thing is one of the ruleset's defaults, which the button restores
 * @param removeLabel The button's text before it is pressed, e.g. "Delete Theme" or "Restore Default"
 */
export function labelRemoveButton(button: HTMLButtonElement, edit: { removed: boolean }, isDefault: boolean, removeLabel: string): void
{
	if (!edit.removed)
	{
		setButtonLabel(button, (isDefault ? restoreIcon : trashIcon), removeLabel);
		button.classList.add('danger');
		return;
	}

	setButtonLabel(button, undoIcon, t(isDefault ? messages.undoRestore : messages.undoDelete));
	button.classList.remove('danger');
}

/**
 * The words for a list's last column, from groups of words that may be empty
 *
 * @param tags Each group, e.g. from optionTags() and stagedTag()
 * @return The words, e.g. "custom, changed, not saved yet"
 */
export function joinTags(...tags: (string | undefined)[]): string
{
	return(formatList(tags.filter((tag): tag is string => ((tag !== undefined) && (tag !== '')))));
}

/**
 * Why saving a list's changes stopped
 *
 * @param failure The change the server refused, and why
 * @param name The name of the thing it changed
 * @param isDefault Whether the thing is one of the ruleset's defaults, which removing restores
 * @return The message
 */
export function describeCommitFailure<S>(failure: CommitFailure<S>, name: string, isDefault: boolean): string
{
	let message = messages.saveFailed;

	if (failure.change.kind === 'remove')
	{
		message = (isDefault ? messages.restoreFailed : messages.deleteFailed);
	}

	return(describeEditorError(failure.error, message, { name }));
}
