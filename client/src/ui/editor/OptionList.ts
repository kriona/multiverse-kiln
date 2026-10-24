import type { EditableUniverse, MessageDescriptor, Ruleset } from '@multiverse-kiln/shared';

import { describeEditorError } from '../../network/editorApi';
import { showMessage } from '../dom';
import { createOptionRow, optionTags } from './optionRows';
import type { SavableTab } from './SaveBar';
import { describeCommitFailure, joinTags, markStagedRow, StagedChanges, stagedTag, stagedView, type StagedApi, type StagedEdit, type StagedState } from './stagedChanges';

/**
 * A race, class or theme as its list shows it: one of the ruleset's defaults, perhaps edited by the
 * universe, or one the universe added
 */
export interface EditorOption
{
	id: number;
	key: string | null;
	enabled: boolean;
	custom: boolean;
	edited: boolean;
}

/**
 * What an OptionList shows and how it reaches the server
 */
export interface OptionListSetup<T extends EditorOption, S>
{
	addButton: HTMLButtonElement;
	rows: HTMLTableSectionElement;
	error: HTMLElement;

	/**
	 * Shown when the list couldn't be loaded, e.g. "Could not list the races."
	 */
	listFailed: MessageDescriptor;

	/**
	 * Whether a player's role lets them change the list
	 *
	 * @param universe The universe
	 * @return True when it does
	 */
	canEdit(universe: EditableUniverse): boolean;

	/**
	 * Loads the list
	 *
	 * @param universeId The universe's ID
	 * @return Every option the universe can use
	 */
	load(universeId: string): Promise<T[]>;

	/**
	 * The routes that save the list's changes
	 *
	 * @param universeId The universe's ID
	 * @return The routes
	 */
	routes(universeId: string): StagedApi<S>;

	/**
	 * An option added since the last save, as the list shows it
	 *
	 * @param id Its ID until it is saved
	 * @param settings Its settings
	 * @return The option
	 */
	created(id: number, settings: S): T;

	/**
	 * An option's name as the player reads it
	 *
	 * @param option The option
	 * @param ruleset The universe's ruleset
	 * @return The name
	 */
	name(option: T, ruleset: Ruleset): string;

	/**
	 * An option's rules in a few words
	 *
	 * @param option The option
	 * @param ruleset The universe's ruleset
	 * @return The summary
	 */
	describe(option: T, ruleset: Ruleset): string;

	/**
	 * Opens the option's editor dialog
	 *
	 * @param universe The universe
	 * @param option The option, or undefined to add one
	 * @param edit Where the dialog's changes go
	 * @param onChanged Called after a change is made in the dialog
	 */
	openDialog(universe: EditableUniverse, option: T | undefined, edit: StagedEdit<S>, onChanged: () => void): void;
}

/**
 * A list of races, classes or themes on an editor tab, by name, opening the editor dialog of each. Changes
 * made in the dialog wait on the page until the tab is saved
 */
export class OptionList<T extends EditorOption & S, S> implements SavableTab
{
	/**
	 * The changes made since the list was last saved
	 */
	readonly changes = new StagedChanges<S>();

	private universe: EditableUniverse | undefined;

	/**
	 * The options as they were last loaded
	 */
	private options: T[] = [];

	/**
	 * Changes with every request for the list, so a list that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	/**
	 * @param setup What the list shows and how it reaches the server
	 */
	constructor(private readonly setup: OptionListSetup<T, S>)
	{
		setup.addButton.addEventListener('click', () =>
		{
			this.openOption(undefined);
		});
	}

	/**
	 * Lists a universe's options, throwing away any changes to another's; undefined shows none
	 *
	 * @param universe The universe, or undefined for none
	 */
	open(universe: EditableUniverse | undefined): void
	{
		this.universe = universe;
		this.setup.addButton.hidden = (!universe || !this.setup.canEdit(universe));
		this.options = [];
		this.changes.clear();
		this.setup.rows.replaceChildren();
		showMessage(this.setup.error, undefined);
		void this.refresh();
	}

	/**
	 * Whether the player may change the list
	 *
	 * @return True when their role allows it
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && this.setup.canEdit(this.universe));
	}

	/**
	 * Saves the changes in the order they were made, stopping at the first the server refuses
	 *
	 * @return True when every change was saved
	 */
	async save(): Promise<boolean>
	{
		const universe = this.universe;

		if (!universe)
		{
			return(false);
		}

		showMessage(this.setup.error, undefined);

		const failure = await this.changes.commit(this.setup.routes(universe.id));

		await this.refresh();

		if (failure)
		{
			const option = this.view().find(({ item }) => (item.id === failure.change.id))?.item;

			showMessage(this.setup.error, describeCommitFailure(failure, (option ? this.setup.name(option, universe.ruleset) : ''), !option?.custom));

			return(false);
		}

		return(true);
	}

	/**
	 * Loads the list, then shows it with the changes made since
	 */
	private async refresh(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.requestVersion;

		if (!universe)
		{
			return;
		}

		try
		{
			const options = await this.setup.load(universe.id);

			if (version === this.requestVersion)
			{
				this.options = options;
				this.render();
			}
		}
		catch (error)
		{
			if (version === this.requestVersion)
			{
				showMessage(this.setup.error, describeEditorError(error, this.setup.listFailed));
			}
		}
	}

	/**
	 * The options with the changes made since they were last saved. A default option with changes counts
	 * as edited
	 *
	 * @return Each option, with how it differs from what is saved
	 */
	private view(): { item: T; state: StagedState }[]
	{
		return(stagedView(this.options, this.changes, (option, settings) => ({
			...option,
			...settings,
			edited: (option.custom ? option.edited : true)
		}), (id, settings) => this.setup.created(id, settings)));
	}

	/**
	 * Shows the options, by name
	 */
	private render(): void
	{
		const universe = this.universe;

		if (!universe)
		{
			return;
		}

		this.setup.rows.replaceChildren(...this.view()
			.map((entry) => ({
				...entry,
				name: this.setup.name(entry.item, universe.ruleset)
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(({ item, state, name }) => markStagedRow(createOptionRow(name, this.setup.describe(item, universe.ruleset), joinTags(optionTags(item), stagedTag(state, !item.custom)), () =>
			{
				this.openOption(item);
			}), state, !item.custom)));
	}

	/**
	 * Opens an option's editor, showing its changes in the list
	 *
	 * @param option The option, or undefined to add one
	 */
	private openOption(option: T | undefined): void
	{
		if (this.universe)
		{
			this.setup.openDialog(this.universe, option, this.changes.edit(option?.id), () =>
			{
				this.render();
			});
		}
	}
}
