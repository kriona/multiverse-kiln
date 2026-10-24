import { ABILITY_NAMES, canEditUniverseSettings, FLOATING_ABILITY_BONUSES, isSf1eRaceRules, RULESET_ABILITIES, SIZE_NAMES, type EditorRace, type RaceSettings, type Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import type { EditorApi } from '../../network/editorApi';
import { getElement } from '../dom';
import { raceName } from '../raceAndClassNames';
import type { ItemSelectDialog } from './ItemSelectDialog';
import { OptionList } from './OptionList';
import { RaceDialog } from './RaceDialog';
import type { AreaSelectDialog } from './AreaSelectDialog';

/**
 * The Races tab: every race characters of the universe can be, opening the race editor. Changes wait on
 * the page until the tab is saved
 */
export class RacesTab extends OptionList<EditorRace, RaceSettings>
{
	/**
	 * @param api The editor's API
	 * @param areaSelect The dialog for choosing a race's starting area
	 * @param itemSelect The dialog for choosing a race's starting equipment
	 */
	constructor(api: EditorApi, areaSelect: AreaSelectDialog, itemSelect: ItemSelectDialog)
	{
		const dialog = new RaceDialog(api, areaSelect, itemSelect);

		super({
			addButton: getElement('race-add', HTMLButtonElement),
			rows: getElement('race-rows', HTMLTableSectionElement),
			error: getElement('race-list-error', HTMLElement),
			listFailed: {
				id: 'editor.races.listFailed',
				defaultMessage: 'Could not list the races.',
				description: 'Shown on the Races tab when the races couldn\'t be loaded'
			},
			canEdit: (universe) => canEditUniverseSettings(universe.role),
			load: (universeId) => api.listRaces(universeId),
			routes: (universeId) => ({
				create: (settings) => api.createRace(universeId, settings),
				save: (raceId, settings) => api.saveRace(universeId, raceId, settings),
				remove: (raceId) => api.deleteRace(universeId, raceId)
			}),
			created: (id, settings) => ({
				id,
				key: null,
				...settings,
				custom: true,
				edited: false
			}),
			name: raceName,
			describe: describeRace,
			openDialog: (universe, race, edit, onChanged) =>
			{
				dialog.open(universe, race, edit, onChanged);
			}
		});
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
