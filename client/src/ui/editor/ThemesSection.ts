import { canEditUniverseSettings, rulesetHasThemes, SF1E_ABILITY_NAMES, SF1E_THEME_ABILITY_BONUS, type EditableUniverse, type EditorTheme } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { getElement, showMessage } from '../dom';
import { themeName } from '../raceAndClassNames';
import { createOptionRow, optionTags } from './optionRows';
import { ThemeDialog } from './ThemeDialog';

/**
 * The themes on the Characters tab, in a ruleset with themes: every theme characters of the universe can
 * have, opening the theme editor. Hidden for a ruleset without themes
 */
export class ThemesSection
{
	private readonly section = getElement('characters-themes', HTMLElement);
	private readonly addButton = getElement('theme-add', HTMLButtonElement);
	private readonly rows = getElement('theme-rows', HTMLTableSectionElement);
	private readonly error = getElement('theme-list-error', HTMLElement);
	private readonly dialog: ThemeDialog;

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
		this.dialog = new ThemeDialog(api);

		this.addButton.addEventListener('click', () =>
		{
			this.openTheme(undefined);
		});
	}

	/**
	 * Lists a universe's themes, or hides the section when its ruleset has none
	 *
	 * @param universe The universe
	 */
	open(universe: EditableUniverse): void
	{
		const hasThemes = rulesetHasThemes(universe.ruleset);

		this.universe = (hasThemes ? universe : undefined);
		this.section.hidden = !hasThemes;
		this.addButton.hidden = !canEditUniverseSettings(universe.role);
		this.rows.replaceChildren();
		showMessage(this.error, undefined);
		void this.refresh();
	}

	/**
	 * Loads and shows the themes, by name
	 */
	private async refresh(): Promise<void>
	{
		const universe = this.universe;
		const version = ++this.requestVersion;

		if (!universe)
		{
			return;
		}

		let themes: EditorTheme[];

		try
		{
			themes = await this.api.listThemes(universe.id);
		}
		catch (error)
		{
			if (version === this.requestVersion)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'editor.themes.listFailed',
					defaultMessage: 'Could not list the themes.',
					description: 'Shown on the editor\'s Characters tab when the themes (character backgrounds, such as ace pilot) couldn\'t be loaded'
				}));
			}

			return;
		}

		if (version !== this.requestVersion)
		{
			return;
		}

		showMessage(this.error, undefined);
		this.rows.replaceChildren(...themes
			.map((theme) => ({
				theme,
				name: themeName(theme, universe.ruleset)
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(({ theme, name }) => createOptionRow(name, describeTheme(theme), optionTags(theme), () =>
			{
				this.openTheme(theme);
			})));
	}

	/**
	 * Opens the theme editor, refreshing the list after a change
	 *
	 * @param theme The theme, or undefined to add one
	 */
	private openTheme(theme: EditorTheme | undefined): void
	{
		if (this.universe)
		{
			this.dialog.open(this.universe, theme, () =>
			{
				void this.refresh();
			});
		}
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
