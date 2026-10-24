import { canEditUniverseSettings, type DifficultyLevel, type DifficultyLevelSettings, type EditableUniverse } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { describeMobScale, difficultyName } from '../difficultyNames';
import { getElement, showMessage } from '../dom';
import { DifficultyDialog } from './DifficultyDialog';
import { createOptionRow } from './optionRows';
import type { SavableTab } from './SaveBar';
import { describeCommitFailure, joinTags, markStagedRow, StagedChanges, stagedTag, stagedView, type StagedState } from './stagedChanges';

/**
 * The difficulty levels on the Characters tab: every level a new group can choose, easiest first,
 * opening the difficulty level editor. Changes wait on the page until the tab is saved
 */
export class DifficultySection implements SavableTab
{
	private readonly addButton = getElement('difficulty-add', HTMLButtonElement);
	private readonly rows = getElement('difficulty-rows', HTMLTableSectionElement);
	private readonly error = getElement('difficulty-list-error', HTMLElement);
	private readonly dialog = new DifficultyDialog();

	/**
	 * The changes made since the levels were last saved
	 */
	readonly changes = new StagedChanges<DifficultyLevelSettings>();

	private universe: EditableUniverse | undefined;

	/**
	 * The levels as they were last loaded
	 */
	private levels: DifficultyLevel[] = [];

	/**
	 * Changes with every request for the list, so a list that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		this.addButton.addEventListener('click', () =>
		{
			this.openLevel(undefined);
		});
	}

	/**
	 * Lists a universe's difficulty levels
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.addButton.hidden = !canEditUniverseSettings(universe.role);
		this.levels = [];
		this.changes.clear();
		this.rows.replaceChildren();
		showMessage(this.error, undefined);
		void this.refresh();
	}

	/**
	 * Whether the player may change the levels
	 *
	 * @return True for a creator
	 */
	canSave(): boolean
	{
		return((this.universe !== undefined) && canEditUniverseSettings(this.universe.role));
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

		showMessage(this.error, undefined);

		const failure = await this.changes.commit({
			create: (settings) => this.api.createDifficultyLevel(universe.id, settings),
			save: (levelId, settings) => this.api.saveDifficultyLevel(universe.id, levelId, settings),
			remove: (levelId) => this.api.deleteDifficultyLevel(universe.id, levelId)
		});

		await this.refresh();

		if (failure)
		{
			const level = this.view().find(({ item }) => (item.id === failure.change.id))?.item;

			showMessage(this.error, describeCommitFailure(failure, (level ? difficultyName(level) : ''), false));

			return(false);
		}

		return(true);
	}

	/**
	 * Loads the levels, then shows them with the changes made since
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
			const levels = await this.api.listDifficultyLevels(universe.id);

			if (version === this.requestVersion)
			{
				this.levels = levels;
				this.render();
			}
		}
		catch (error)
		{
			if (version === this.requestVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.difficulty.listFailed',
					defaultMessage: 'Could not list the difficulty levels.',
					description: 'Shown on the editor\'s Characters tab when the difficulty levels couldn\'t be loaded'
				}));
			}
		}
	}

	/**
	 * The levels with the changes made since they were last saved. A level made the default takes over
	 * from the old default, as saving it does
	 *
	 * @return Each level, with how it differs from what is saved
	 */
	private view(): { item: DifficultyLevel; state: StagedState }[]
	{
		const view = stagedView(this.levels, this.changes, (level, settings) => ({
			...level,
			...settings
		}), (id, settings) => ({
			id,
			key: null,
			...settings
		}));
		const defaultId = this.changes.list()
			.filter((change) => ((change.kind !== 'remove') && change.settings.isDefault))
			.map((change) => change.id)
			.at(-1);

		if (defaultId === undefined)
		{
			return(view);
		}

		return(view.map((entry) => ({
			...entry,
			item: {
				...entry.item,
				isDefault: (entry.item.id === defaultId)
			}
		})));
	}

	/**
	 * Shows the levels, easiest first
	 */
	private render(): void
	{
		this.rows.replaceChildren(...this.view()
			.sort((a, b) => ((a.item.mobScale - b.item.mobScale) || (Math.abs(a.item.id) - Math.abs(b.item.id))))
			.map(({ item, state }) => markStagedRow(createOptionRow(difficultyName(item), describeMobScale(item.mobScale), joinTags(levelTags(item), stagedTag(state, false)), () =>
			{
				this.openLevel(item);
			}), state, false)));
	}

	/**
	 * Opens the difficulty level editor, showing its changes in the list
	 *
	 * @param level The level, or undefined to add one
	 */
	private openLevel(level: DifficultyLevel | undefined): void
	{
		if (this.universe)
		{
			this.dialog.open(this.universe, level, this.changes.edit(level?.id), () =>
			{
				this.render();
			});
		}
	}
}

/**
 * Words for a level that is the default or has permadeath
 *
 * @param level The level
 * @return The words, e.g. "default, permadeath", or an empty string for none
 */
function levelTags(level: DifficultyLevel): string
{
	return(joinTags(
		(level.isDefault
			? t({
				id: 'editor.difficulty.defaultTag',
				defaultMessage: 'default',
				description: 'In the last column of the editor\'s difficulty level table, for the level Create Group starts on'
			})
			: undefined),
		(level.permadeath
			? t({
				id: 'editor.difficulty.permadeathTag',
				defaultMessage: 'permadeath',
				description: 'In the last column of the editor\'s difficulty level table, for a level at which characters who die are gone for good'
			})
			: undefined)
	));
}
