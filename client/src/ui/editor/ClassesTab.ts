import { ABILITY_NAMES, canEditUniverseSettings, isSf1eClassRules, mainAbility, PF1E_CASTING_STYLE_NAMES, PF1E_MAGIC_TRADITION_NAMES, type ClassSettings, type EditorClass, type Ruleset } from '@multiverse-kiln/shared';

import { formatList, t } from '../../localization';
import type { EditorApi } from '../../network/editorApi';
import { getElement } from '../dom';
import { className } from '../raceAndClassNames';
import { ClassDialog } from './ClassDialog';
import type { ItemSelectDialog } from './ItemSelectDialog';
import { OptionList } from './OptionList';
import type { AreaSelectDialog } from './AreaSelectDialog';

/**
 * The Classes tab: every class characters of the universe can be, opening the class editor. Changes wait
 * on the page until the tab is saved
 */
export class ClassesTab extends OptionList<EditorClass, ClassSettings>
{
	/**
	 * @param api The editor's API
	 * @param areaSelect The dialog for choosing a class's starting areas
	 * @param itemSelect The dialog for choosing a class's starting equipment
	 */
	constructor(api: EditorApi, areaSelect: AreaSelectDialog, itemSelect: ItemSelectDialog)
	{
		const dialog = new ClassDialog(api, areaSelect, itemSelect);

		super({
			addButton: getElement('class-add', HTMLButtonElement),
			rows: getElement('class-rows', HTMLTableSectionElement),
			error: getElement('class-list-error', HTMLElement),
			listFailed: {
				id: 'editor.classes.listFailed',
				defaultMessage: 'Could not list the classes.',
				description: 'Shown on the Classes tab when the character classes couldn\'t be loaded'
			},
			canEdit: (universe) => canEditUniverseSettings(universe.role),
			load: (universeId) => api.listClasses(universeId),
			routes: (universeId) => ({
				create: (settings) => api.createClass(universeId, settings),
				save: (classId, settings) => api.saveClass(universeId, classId, settings),
				remove: (classId) => api.deleteClass(universeId, classId)
			}),
			created: (id, settings) => ({
				id,
				key: null,
				...settings,
				custom: true,
				edited: false
			}),
			name: className,
			describe: describeClass,
			openDialog: (universe, characterClass, edit, onChanged) =>
			{
				dialog.open(universe, characterClass, edit, onChanged);
			}
		});
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
