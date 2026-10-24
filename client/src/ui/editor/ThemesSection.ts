import { canEditUniverseSettings, rulesetHasThemes, SF1E_ABILITY_NAMES, SF1E_THEME_ABILITY_BONUS, type EditableUniverse, type EditorTheme, type ThemeSettings } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import type { EditorApi } from '../../network/editorApi';
import { getElement } from '../dom';
import { themeName } from '../raceAndClassNames';
import { OptionList } from './OptionList';
import { ThemeDialog } from './ThemeDialog';

/**
 * The themes on the Characters tab, in a ruleset with themes: every theme characters of the universe can
 * have, opening the theme editor. Changes wait on the page until the tab is saved. Hidden for a ruleset
 * without themes
 */
export class ThemesSection extends OptionList<EditorTheme, ThemeSettings>
{
	private readonly section = getElement('characters-themes', HTMLElement);

	/**
	 * @param api The editor's API
	 */
	constructor(api: EditorApi)
	{
		const dialog = new ThemeDialog();

		super({
			addButton: getElement('theme-add', HTMLButtonElement),
			rows: getElement('theme-rows', HTMLTableSectionElement),
			error: getElement('theme-list-error', HTMLElement),
			listFailed: {
				id: 'editor.themes.listFailed',
				defaultMessage: 'Could not list the themes.',
				description: 'Shown on the editor\'s Characters tab when the themes (character backgrounds, such as ace pilot) couldn\'t be loaded'
			},
			canEdit: (universe) => canEditUniverseSettings(universe.role),
			load: (universeId) => api.listThemes(universeId),
			routes: (universeId) => ({
				create: (settings) => api.createTheme(universeId, settings),
				save: (themeId, settings) => api.saveTheme(universeId, themeId, settings),
				remove: (themeId) => api.deleteTheme(universeId, themeId)
			}),
			created: (id, settings) => ({
				id,
				key: null,
				...settings,
				custom: true,
				edited: false
			}),
			name: themeName,
			describe: describeTheme,
			openDialog: (universe, theme, edit, onChanged) =>
			{
				dialog.open(universe, theme, edit, onChanged);
			}
		});
	}

	/**
	 * Lists a universe's themes, or hides the section when its ruleset has none
	 *
	 * @param universe The universe
	 */
	override open(universe: EditableUniverse | undefined): void
	{
		const hasThemes = ((universe !== undefined) && rulesetHasThemes(universe.ruleset));

		this.section.hidden = !hasThemes;
		super.open(hasThemes ? universe : undefined);
	}
}

/**
 * A theme's rules in a few words: the ability it raises
 *
 * @param theme The theme
 * @return The summary, e.g. "Dexterity +1"
 */
function describeTheme(theme: EditorTheme): string
{
	return(t({
		id: 'editor.themes.ability',
		defaultMessage: '{ability} {bonus, number, ::sign-always}',
		description: 'A theme\'s summary in the list of themes on the editor\'s Characters tab: the ability it raises and by how much, e.g. Dexterity +1; {ability} is the ability\'s name'
	}, {
		ability: t(SF1E_ABILITY_NAMES[theme.rules.ability]),
		bonus: SF1E_THEME_ABILITY_BONUS
	}));
}
