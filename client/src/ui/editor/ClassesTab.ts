import { canEditUniverseSettings, PF1E_ABILITY_NAMES, PF1E_CASTING_STYLE_NAMES, PF1E_MAGIC_TRADITION_NAMES, type EditableUniverse, type EditorClass } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { className } from '../raceAndClassNames';
import { ClassDialog } from './ClassDialog';
import type { ItemSelectDialog } from './ItemSelectDialog';
import { createOptionRow, optionTags } from './optionRows';
import type { ZoneSelectDialog } from './ZoneSelectDialog';

/**
 * The Classes tab: every class characters of the universe can be, opening the class editor
 */
export class ClassesTab
{
	private readonly addButton = getElement('class-add', HTMLButtonElement);
	private readonly rows = getElement('class-rows', HTMLTableSectionElement);
	private readonly error = getElement('class-list-error', HTMLElement);
	private readonly dialog: ClassDialog;

	private universe: EditableUniverse | undefined;

	/**
	 * Changes with every request for the list, so a list that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	/**
	 * @param api The editor's API
	 * @param zoneSelect The dialog for choosing a class's starting zones
	 * @param itemSelect The dialog for choosing a class's starting equipment
	 */
	constructor(private readonly api: EditorApi, zoneSelect: ZoneSelectDialog, itemSelect: ItemSelectDialog)
	{
		this.dialog = new ClassDialog(api, zoneSelect, itemSelect);

		this.addButton.addEventListener('click', () =>
		{
			this.openClass(undefined);
		});
	}

	/**
	 * Lists a universe's classes
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		this.universe = universe;
		this.addButton.hidden = !canEditUniverseSettings(universe.role);
		this.rows.replaceChildren();
		void this.refresh();
	}

	/**
	 * Loads and shows the classes, by name
	 */
	private async refresh(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.requestVersion;

		if (!universe)
		{
			return;
		}

		let classes: EditorClass[];

		try
		{
			classes = await this.api.listClasses(universe.id);
		}
		catch (error)
		{
			if (version === this.requestVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.classes.listFailed',
					defaultMessage: 'Could not list the classes.',
					description: 'Shown on the Classes tab when the character classes couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.requestVersion)
		{
			return;
		}

		showMessage(this.error, undefined);
		this.rows.replaceChildren(...classes
			.map((characterClass) => ({
				characterClass,
				name: className(characterClass, universe.ruleset)
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(({ characterClass, name }) => createOptionRow(name, describeClass(characterClass), optionTags(characterClass), () =>
			{
				this.openClass(characterClass);
			})));
	}

	/**
	 * Opens the class editor, refreshing the list after a change
	 *
	 * @param characterClass The class, or undefined to add one
	 */
	private openClass(characterClass: EditorClass | undefined): void
	{
		if (this.universe)
		{
			this.dialog.open(this.universe, characterClass, () =>
			{
				void this.refresh();
			});
		}
	}
}

/**
 * A class's rules in a few words: its primary ability, and its magic for a class that casts spells
 *
 * @param characterClass The class
 * @return The summary
 */
function describeClass(characterClass: EditorClass): string
{
	const { primaryAbility, tradition, castingStyle } = characterClass.rules;
	const parts = [
		t({
			id: 'editor.classes.primaryAbility',
			defaultMessage: 'relies on {ability}',
			description: 'In a character class\'s summary on the editor\'s Classes tab, the ability the class relies on most; {ability} is its name, e.g. Intelligence'
		}, { ability: t(PF1E_ABILITY_NAMES[primaryAbility]) })
	];

	if (tradition !== 'none')
	{
		parts.push(t(PF1E_MAGIC_TRADITION_NAMES[tradition]));
	}

	if (castingStyle !== 'none')
	{
		parts.push(t(PF1E_CASTING_STYLE_NAMES[castingStyle]));
	}

	return(formatList(parts));
}
