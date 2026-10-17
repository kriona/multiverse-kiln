import { canEditUniverseSettings, PF1E_ABILITIES, PF1E_ABILITY_NAMES, PF1E_FLOATING_ABILITY_BONUS, PF1E_SIZE_NAMES, type EditableUniverse, type EditorRace } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { raceName } from '../raceAndClassNames';
import type { ItemSelectDialog } from './ItemSelectDialog';
import { createOptionRow, optionTags } from './optionRows';
import { RaceDialog } from './RaceDialog';
import type { ZoneSelectDialog } from './ZoneSelectDialog';

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
	 * @param zoneSelect The dialog for choosing a race's starting zone
	 * @param itemSelect The dialog for choosing a race's starting equipment
	 */
	constructor(private readonly api: EditorApi, zoneSelect: ZoneSelectDialog, itemSelect: ItemSelectDialog)
	{
		this.dialog = new RaceDialog(api, zoneSelect, itemSelect);

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
			.map(({ race, name }) => createOptionRow(name, describeRace(race), optionTags(race), () =>
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
 * A race's rules in a few words: its size, ability modifiers, floating bonus and darkvision
 *
 * @param race The race
 * @return The summary
 */
function describeRace(race: EditorRace): string
{
	const { abilityModifiers, floatingBonus, darkvision, size } = race.rules;
	const parts = [
		t(PF1E_SIZE_NAMES[size]),
		...PF1E_ABILITIES
			.filter((ability) => (abilityModifiers[ability] !== 0))
			.map((ability) => t({
				id: 'editor.races.modifier',
				defaultMessage: '{ability} {modifier, number, ::sign-always}',
				description: 'One ability modifier in a race\'s summary on the editor\'s Races tab, e.g. Dexterity +2; {ability} is the ability\'s name'
			}, {
				ability: t(PF1E_ABILITY_NAMES[ability]),
				modifier: abilityModifiers[ability]
			}))
	];

	if (floatingBonus)
	{
		parts.push(t({
			id: 'editor.races.floatingBonus',
			defaultMessage: '{bonus, number, ::sign-always} to one ability',
			description: 'In a race\'s summary on the editor\'s Races tab, for a race whose players choose one ability to raise; {bonus} is by how much, e.g. +2'
		}, { bonus: PF1E_FLOATING_ABILITY_BONUS }));
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
