import { t } from '../../localization';
import { describeEditorError, EditorApiError, type EditorApi } from '../../network/editorApi';
import { changeMessages } from '../changeTracker';
import { getElement } from '../dom';
import { formMessages } from '../formMessages';
import { showToast } from '../toast';
import { EditorSave, isSaveRefused, SavedIds } from './editorSave';
import type { ChangeSource } from './stagedChanges';

/**
 * An editor tab whose changes wait on the page until the save bar's Save button saves them
 */
export interface SavableTab
{
	/**
	 * Whether the tab has changes that haven't been saved
	 */
	readonly changes: ChangeSource;

	/**
	 * Whether the player's role lets them change what the tab saves
	 *
	 * @return True when it does
	 */
	canSave(): boolean;

	/**
	 * Adds the tab's changes to a save, in the order the server must save them, after checking its fields
	 * and clearing the reasons an earlier save was refused
	 *
	 * @param save The save
	 * @return False when a field's problem stops the save; the tab points the player at it
	 */
	collect(save: EditorSave): boolean;

	/**
	 * Takes the tab's changes as saved, once the save holding them is, and shows them as the server has them
	 *
	 * @param ids The IDs the save gave the things it made
	 */
	saved(ids: SavedIds): Promise<void> | void;
}

/**
 * Changes made of several sources, which are unsaved while any of them is
 *
 * @param sources The sources
 * @return The combined changes
 */
export function combineChanges(...sources: ChangeSource[]): ChangeSource
{
	const hasUnsavedChanges = (): boolean => sources.some((source) => source.hasUnsavedChanges());

	return({
		hasUnsavedChanges,
		subscribe: (listener) =>
		{
			const unsubscribes = sources.map((source) => source.subscribe(() =>
			{
				listener(hasUnsavedChanges());
			}));

			return(() =>
			{
				for (const unsubscribe of unsubscribes)
				{
					unsubscribe();
				}
			});
		}
	});
}

/**
 * A tab made of parts that each have changes of their own, such as the Ruleset tab's settings and
 * difficulty levels. Saving collects the changes of each part that has some, in turn
 *
 * @param parts The parts, in the order they save
 * @return The tab
 */
export function combineTabs(...parts: SavableTab[]): SavableTab
{
	return({
		changes: combineChanges(...parts.map((part) => part.changes)),
		canSave: () => parts.some((part) => part.canSave()),
		collect: (save) => parts.every((part) => (!part.changes.hasUnsavedChanges() || part.collect(save))),
		saved: async (ids) =>
		{
			for (const part of parts)
			{
				await part.saved(ids);
			}
		}
	});
}

/**
 * The bar at the bottom of the editor that saves every tab's changes together, all or nothing. Nothing a
 * tab changes is saved until then. Submitting a form on a tab (Enter in a field) saves too. Reloading the
 * page throws unsaved changes away
 */
export class SaveBar
{
	private readonly bar = getElement('editor-save-bar', HTMLElement);
	private readonly status = getElement('editor-save-status', HTMLElement);
	private readonly saveButton = getElement('editor-save', HTMLButtonElement);

	/**
	 * The tab showing, or undefined while none that saves is
	 */
	private tab: SavableTab | undefined;

	/**
	 * Each tab's panel, by tab, in the order the tabs save
	 */
	private readonly panels = new Map<SavableTab, HTMLElement>();

	private saving = false;

	/**
	 * Whether the editor was just saved, so the bar says so until something changes again
	 */
	private justSaved = false;

	/**
	 * Why the last save failed, when no tab's change was the reason, such as the server not answering
	 */
	private failure: string | undefined;

	/**
	 * @param api The editor's API
	 * @param universeId The ID of the universe being edited, or undefined while none has loaded
	 * @param showTab Shows a tab, whose change the server refused or whose field stopped the save
	 * @param afterSave Called once a save is saved and every tab in it has taken its changes as saved
	 */
	constructor(private readonly api: EditorApi, private readonly universeId: () => string | undefined, private readonly showTab: (tab: SavableTab) => void, private readonly afterSave: () => void)
	{
		this.saveButton.addEventListener('click', () =>
		{
			void this.save();
		});
	}

	/**
	 * Adds a tab: the bar follows its changes, and a form submitted in its panel saves. Tabs save in the
	 * order they are added, so add those whose new things others name first
	 *
	 * @param tab The tab
	 * @param panel The tab's panel
	 */
	add(tab: SavableTab, panel: HTMLElement): void
	{
		this.panels.set(tab, panel);
		tab.changes.subscribe(() =>
		{
			this.justSaved = false;
			this.failure = undefined;
			this.update();
		});

		panel.addEventListener('submit', (event) =>
		{
			event.preventDefault();
			void this.save();
		});
	}

	/**
	 * Follows the tab showing
	 *
	 * @param tab The tab, or undefined for one with nothing to save
	 */
	show(tab: SavableTab | undefined): void
	{
		const panel = (tab && this.panels.get(tab));

		this.tab = tab;
		// The tab's error messages say why it didn't save
		this.saveButton.setAttribute('aria-describedby', (panel
			? [...panel.querySelectorAll('.form-error[id]')].map((error) => error.id).join(' ')
			: ''));
		this.update();
	}

	/**
	 * Whether any tab has changes that haven't been saved
	 *
	 * @return True when one has
	 */
	private hasUnsavedChanges(): boolean
	{
		return([...this.panels.keys()].some((tab) => tab.changes.hasUnsavedChanges()));
	}

	/**
	 * Saves every tab's changes in one request, stopping before it at a field with a problem
	 */
	private async save(): Promise<void>
	{
		const universeId = this.universeId();

		if ((universeId === undefined) || this.saving || !this.hasUnsavedChanges())
		{
			return;
		}

		const tabs = [...this.panels.keys()].filter((tab) => (tab.canSave() && tab.changes.hasUnsavedChanges()));
		const save = new EditorSave();

		this.failure = undefined;

		for (const tab of tabs)
		{
			save.owner = tab;

			if (!tab.collect(save))
			{
				save.finish();
				this.showTab(tab);
				this.update();
				return;
			}
		}

		this.saving = true;
		this.update();

		let ids: SavedIds | undefined;

		try
		{
			ids = new SavedIds(await this.api.saveChanges(universeId, save.changes()));
		}
		catch (error)
		{
			this.refused(save, error);
		}
		finally
		{
			this.saving = false;
			save.finish();
		}

		if (ids)
		{
			for (const tab of tabs)
			{
				await tab.saved(ids);
			}

			this.afterSave();
			this.justSaved = !this.hasUnsavedChanges();

			if (this.justSaved)
			{
				showToast(t(formMessages.savedToast), {
					kind: 'success',
					announce: false
				});
			}
		}

		this.update();
	}

	/**
	 * Shows why a save was refused: on the tab whose change the server refused, which is shown, or on the
	 * bar when no change was the reason
	 *
	 * @param save The save
	 * @param error What the request threw
	 */
	private refused(save: EditorSave, error: unknown): void
	{
		const data = ((error instanceof EditorApiError) ? error.data : undefined);

		if ((error instanceof EditorApiError) && isSaveRefused(data) && (data.changeIndex !== null))
		{
			const owner = save.refuse(data.changeIndex, {
				error,
				resizeConflict: data.resizeConflict,
				retry: () =>
				{
					// Once this save has finished
					window.setTimeout(() =>
					{
						void this.save();
					});
				}
			});
			const tab = [...this.panels.keys()].find((candidate) => (candidate === owner));

			if (tab)
			{
				this.showTab(tab);
				return;
			}
		}

		this.failure = describeEditorError(error, {
			id: 'editor.save.failed',
			defaultMessage: 'Could not save.',
			description: 'Shown in the editor\'s save bar when saving failed, followed by why; nothing was saved'
		});
	}

	/**
	 * Shows whether any tab has unsaved changes, and lets them be saved
	 */
	private update(): void
	{
		const unsaved = this.hasUnsavedChanges();

		this.bar.hidden = (!(this.tab?.canSave() ?? false) && !unsaved);
		this.saveButton.disabled = (!unsaved || this.saving);

		if (this.failure !== undefined)
		{
			this.status.textContent = this.failure;
		}
		else if (unsaved)
		{
			this.status.textContent = t(changeMessages.unsavedChanges);
		}
		else
		{
			this.status.textContent = (this.justSaved ? t(formMessages.saved) : '');
		}
	}
}
