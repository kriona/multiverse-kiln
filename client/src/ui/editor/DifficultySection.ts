import { canEditUniverseSettings, type DifficultyLevel, type EditableUniverse } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { describeMobScale, difficultyName } from '../difficultyNames';
import { getElement, showMessage } from '../dom';
import { DifficultyDialog } from './DifficultyDialog';
import { createOptionRow } from './optionRows';

/**
 * The difficulty levels on the Characters tab: every level a new group can choose, easiest first,
 * opening the difficulty level editor
 */
export class DifficultySection
{
	private readonly addButton = getElement('difficulty-add', HTMLButtonElement);
	private readonly rows = getElement('difficulty-rows', HTMLTableSectionElement);
	private readonly error = getElement('difficulty-list-error', HTMLElement);
	private readonly dialog: DifficultyDialog;

	private universe: EditableUniverse | undefined;

	/**
	 * Changes with every request for the list, so a list that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	/**
	 * @param api The editor's API
	 */
	constructor(private readonly api: EditorApi)
	{
		this.dialog = new DifficultyDialog(api);

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
		this.rows.replaceChildren();
		showMessage(this.error, undefined);
		void this.refresh();
	}

	/**
	 * Loads and shows the levels, easiest first
	 */
	private async refresh(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.requestVersion;

		if (!universe)
		{
			return;
		}

		let levels: DifficultyLevel[];

		try
		{
			levels = await this.api.listDifficultyLevels(universe.id);
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

			return;
		}

		if (version !== this.requestVersion)
		{
			return;
		}

		showMessage(this.error, undefined);
		this.rows.replaceChildren(...levels.map((level) => createOptionRow(difficultyName(level), describeMobScale(level.mobScale), levelTags(level), () =>
		{
			this.openLevel(level);
		})));
	}

	/**
	 * Opens the difficulty level editor, refreshing the list after a change
	 *
	 * @param level The level, or undefined to add one
	 */
	private openLevel(level: DifficultyLevel | undefined): void
	{
		if (this.universe)
		{
			this.dialog.open(this.universe, level, () =>
			{
				void this.refresh();
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
	const tags = [
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
	].filter((tag) => (tag !== undefined));

	return(formatList(tags));
}
