import { ABILITY_NAMES, canEditUniverseSettings, isSf1eClassRules, mainAbility, PF1E_CASTING_STYLE_NAMES, PF1E_MAGIC_TRADITION_NAMES, type EditableUniverse, type EditorClass, type Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { className } from '../raceAndClassNames';
import { ClassDialog } from './ClassDialog';
import type { ItemSelectDialog } from './ItemSelectDialog';
import { createOptionRow, optionTags } from './optionRows';
import type { AreaSelectDialog } from './AreaSelectDialog';

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
	 * @param areaSelect The dialog for choosing a class's starting areas
	 * @param itemSelect The dialog for choosing a class's starting equipment
	 */
	constructor(private readonly api: EditorApi, areaSelect: AreaSelectDialog, itemSelect: ItemSelectDialog)
	{
		this.dialog = new ClassDialog(api, areaSelect, itemSelect);

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
			.map(({ characterClass, name }) => createOptionRow(name, describeClass(characterClass, universe.ruleset), optionTags(characterClass), () =>
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
 * A class's rules in a few words: its primary or key ability, and its magic for a Pathfinder class that
 * casts spells or its hit and stamina points for a Starfinder class
 *
 * @param characterClass The class
 * @param ruleset The universe's ruleset
 * @return The summary
 */
function describeClass(characterClass: EditorClass, ruleset: Ruleset): string
{
	const { rules } = characterClass;
	const parts = [
		t({
			id: 'editor.classes.primaryAbility',
			defaultMessage: 'relies on {ability}',
			description: 'In a character class\'s summary on the editor\'s Classes tab, the ability the class relies on most; {ability} is its name, e.g. Intelligence'
		}, {
			ability: t(ABILITY_NAMES[ruleset][mainAbility(rules)])
		})
	];

	if (isSf1eClassRules(rules))
	{
		parts.push(t({
			id: 'editor.classes.points',
			defaultMessage: '{hitPoints, plural, one {# hit point} other {# hit points}} and {staminaPoints, plural, one {# stamina point} other {# stamina points}} a level',
			description: 'In a character class\'s summary on the editor\'s Classes tab, in Starfinder, the hit points and stamina points the class gives at each level'
		}, {
			hitPoints: rules.hitPoints,
			staminaPoints: rules.staminaPoints
		}));
		return(formatList(parts));
	}

	if (rules.tradition !== 'none')
	{
		parts.push(t(PF1E_MAGIC_TRADITION_NAMES[rules.tradition]));
	}

	if (rules.castingStyle !== 'none')
	{
		parts.push(t(PF1E_CASTING_STYLE_NAMES[rules.castingStyle]));
	}

	return(formatList(parts));
}
