import { t } from '../../localization';
import { changeMessages } from '../changeTracker';
import { getElement } from '../dom';
import { formMessages } from '../formMessages';
import { showToast } from '../toast';
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
	 * Saves the tab's changes, showing on the tab why any couldn't be
	 *
	 * @return True when everything was saved
	 */
	save(): Promise<boolean>;
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
 * A tab made of parts that each save their own changes, such as the Ruleset tab's settings and
 * difficulty levels. Saving saves each part with changes in turn, stopping at the first that fails
 *
 * @param parts The parts, in the order they save
 * @return The tab
 */
export function combineTabs(...parts: SavableTab[]): SavableTab
{
	return({
		changes: combineChanges(...parts.map((part) => part.changes)),
		canSave: () => parts.some((part) => part.canSave()),
		save: async () =>
		{
			for (const part of parts)
			{
				if (part.changes.hasUnsavedChanges() && !(await part.save()))
				{
					return(false);
				}
			}

			return(true);
		}
	});
}

/**
 * The bar at the bottom of the editor that saves the tab showing. Nothing a tab changes is saved until
 * then. Submitting a form on a tab (Enter in a field) saves the tab too. Reloading the page throws
 * unsaved changes away
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
	 * Each tab's panel, by tab
	 */
	private readonly panels = new Map<SavableTab, HTMLElement>();

	private saving = false;

	/**
	 * Whether the tab showing was just saved, so the bar says so until it changes again
	 */
	private justSaved = false;

	constructor()
	{
		this.saveButton.addEventListener('click', () =>
		{
			void this.save();
		});
	}

	/**
	 * Adds a tab: the bar follows its changes, and a form submitted in its panel saves it
	 *
	 * @param tab The tab
	 * @param panel The tab's panel
	 */
	add(tab: SavableTab, panel: HTMLElement): void
	{
		this.panels.set(tab, panel);
		tab.changes.subscribe(() =>
		{
			if (tab === this.tab)
			{
				this.justSaved = false;
				this.update();
			}
		});

		panel.addEventListener('submit', (event) =>
		{
			event.preventDefault();

			if (tab === this.tab)
			{
				void this.save();
			}
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
		this.justSaved = false;
		// The tab's error messages say why it didn't save
		this.saveButton.setAttribute('aria-describedby', (panel
			? [...panel.querySelectorAll('.form-error[id]')].map((error) => error.id).join(' ')
			: ''));
		this.update();
	}

	/**
	 * Saves the tab showing
	 */
	private async save(): Promise<void>
	{
		const tab = this.tab;

		if (!tab || this.saving || !tab.changes.hasUnsavedChanges())
		{
			return;
		}

		this.saving = true;
		this.update();

		let saved: boolean;

		try
		{
			saved = await tab.save();
		}
		catch (error)
		{
			// Tabs show their own errors, so this is only a mistake in the editor
			console.error(error);
			saved = false;
		}
		finally
		{
			this.saving = false;
		}

		if (tab !== this.tab)
		{
			return;
		}

		this.justSaved = (saved && !tab.changes.hasUnsavedChanges());
		this.update();

		if (this.justSaved)
		{
			showToast(t(formMessages.savedToast), {
				kind: 'success',
				announce: false
			});
		}
	}

	/**
	 * Shows whether the tab showing has unsaved changes, and lets them be saved
	 */
	private update(): void
	{
		const tab = this.tab;
		const unsaved = (tab?.changes.hasUnsavedChanges() ?? false);

		this.bar.hidden = !tab?.canSave();
		this.saveButton.disabled = (!unsaved || this.saving);

		if (unsaved)
		{
			this.status.textContent = t(changeMessages.unsavedChanges);
		}
		else
		{
			this.status.textContent = (this.justSaved ? t(formMessages.saved) : '');
		}
	}
}
