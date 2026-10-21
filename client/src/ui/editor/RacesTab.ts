import { ABILITY_NAMES, canEditUniverseSettings, FLOATING_ABILITY_BONUSES, isSf1eRaceRules, RULESET_ABILITIES, SIZE_NAMES, type EditableUniverse, type EditorRace, type Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { raceName } from '../raceAndClassNames';
import type { ItemSelectDialog } from './ItemSelectDialog';
import { createOptionRow, optionTags } from './optionRows';
import { RaceDialog } from './RaceDialog';
import type { AreaSelectDialog } from './AreaSelectDialog';

/**
 * The Races tab: every race characters of the universe can be, opening the race editor
 */
export class RacesTab
{
	private readonly addButton = getElement('race-add', HTMLButtonElement);
	private readonly rows = getElement('race-rows', HTMLTableSectionElement);
	private readonly error = getElement('race-list-error', HTMLElement);
	private readonly dialog: RaceDialog;

	private universe: EditableUniverse | undefined;

	/**
	 * Changes with every request for the list, so a list that arrives after a newer request is ignored
	 */
	private requestVersion = 0;

	/**
	 * @param api The editor's API
	 * @param areaSelect The dialog for choosing a race's starting area
	 * @param itemSelect The dialog for choosing a race's starting equipment
	 */
	constructor(private readonly api: EditorApi, areaSelect: AreaSelectDialog, itemSelect: ItemSelectDialog)
	{
		this.dialog = new RaceDialog(api, areaSelect, itemSelect);

		this.addButton.addEventListener('click', () =>
		{
			this.openRace(undefined);
		});
	}

	/**
	 * Lists a universe's races
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
	 * Loads and shows the races, by name
	 */
	private async refresh(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.requestVersion;

		if (!universe)
		{
			return;
		}

		let races: EditorRace[];

		try
		{
			races = await this.api.listRaces(universe.id);
		}
		catch (error)
		{
			if (version === this.requestVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.races.listFailed',
					defaultMessage: 'Could not list the races.',
					description: 'Shown on the Races tab when the races couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.requestVersion)
		{
			return;
		}

		showMessage(this.error, undefined);
		this.rows.replaceChildren(...races
			.map((race) => ({
				race,
				name: raceName(race, universe.ruleset)
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(({ race, name }) => createOptionRow(name, describeRace(race, universe.ruleset), optionTags(race), () =>
			{
				this.openRace(race);
			})));
	}

	/**
	 * Opens the race editor, refreshing the list after a change
	 *
	 * @param race The race, or undefined to add one
	 */
	private openRace(race: EditorRace | undefined): void
	{
		if (this.universe)
		{
			this.dialog.open(this.universe, race, () =>
			{
				void this.refresh();
			});
		}
	}
}

/**
 * A race's rules in a few words: its size, ability modifiers, floating bonus, darkvision and, in a
 * ruleset that has them, hit points
 *
 * @param race The race
 * @param ruleset The universe's ruleset
 * @return The summary
 */
function describeRace(race: EditorRace, ruleset: Ruleset): string
{
	const { rules } = race;
	const { abilityModifiers, floatingBonus, darkvision, size } = rules;
	const parts = [
		t(SIZE_NAMES[ruleset][size]),
		...RULESET_ABILITIES[ruleset]
			.filter((ability) => (abilityModifiers[ability] !== 0))
			.map((ability) => t({
				id: 'editor.races.modifier',
				defaultMessage: '{ability} {modifier, number, ::sign-always}',
				description: 'One ability modifier in a race\'s summary on the editor\'s Races tab, e.g. Dexterity +2; {ability} is the ability\'s name'
			}, {
				ability: t(ABILITY_NAMES[ruleset][ability]),
				modifier: abilityModifiers[ability]
			}))
	];

	if (floatingBonus)
	{
		parts.push(t({
			id: 'editor.races.floatingBonus',
			defaultMessage: '{bonus, number, ::sign-always} to one ability',
			description: 'In a race\'s summary on the editor\'s Races tab, for a race whose players choose one ability to raise; {bonus} is by how much, e.g. +2'
		}, {
			bonus: FLOATING_ABILITY_BONUSES[ruleset]
		}));
	}

	if (isSf1eRaceRules(rules))
	{
		parts.push(t({
			id: 'editor.races.hitPoints',
			defaultMessage: '{hitPoints, plural, one {# hit point} other {# hit points}}',
			description: 'In a race\'s summary on the editor\'s Races tab, in Starfinder, the hit points the race gives its characters'
		}, {
			hitPoints: rules.hitPoints
		}));
	}

	if (darkvision)
	{
		parts.push(t({
			id: 'editor.races.darkvision',
			defaultMessage: 'darkvision',
			description: 'In a race\'s summary on the editor\'s Races tab, for a race that can see in the dark'
		}));
	}

	return(formatList(parts));
}
