import { chooseUniverseLanguage, defineMessages, languageName, type UniverseDetails } from '@multiverse-kiln/shared';

import { chooseLocale, currentLocale, pagesHaveLanguage, t, wantedLanguages } from '../localization';
import { describeEditorError } from '../network/editorApi';
import type { ProfileApi } from '../network/profileApi';
import { getElement, showMessage } from './dom';

/**
 * Text the Languages section shows in more than one place
 */
const chooserMessages = defineMessages({
	universeTextOnly: {
		id: 'universePage.universeTextOnly',
		defaultMessage: 'Universe text only',
		description: 'In the Languages section of a universe\'s page, beside a language the site itself isn\'t translated into, and quoted in the note under the list that explains it: choosing it shows the universe\'s own text in it, while the site\'s buttons and menus stay as they are'
	}
});

/**
 * The Languages section of a universe's page: the languages the universe can be played in, the one the
 * player sees its text in marked, and choosing one to play it in (chooseLocale()). A language the site
 * isn't translated into changes only universe text, and the pages stay in their language. While the
 * browser is logged in, choosing one also changes the language the player's profile names, when it
 * names one, since the server looks up universe text in the profile's language first
 */
export class UniverseLanguageChooser
{
	private readonly list = getElement('universe-language-list', HTMLUListElement);
	private readonly pagesNote = getElement('universe-languages-pages-note', HTMLElement);
	private readonly profileNote = getElement('universe-languages-profile-note', HTMLElement);
	private readonly error = getElement('universe-language-error', HTMLElement);

	/**
	 * The profile routes while the browser is logged in, or undefined while it isn't
	 */
	private profiles: ProfileApi | undefined;

	/**
	 * The language the player's profile names, or null when it is left on the browser's language or
	 * the browser isn't logged in
	 */
	private profileLocale: string | null = null;

	/**
	 * Whether a language has been chosen and the page is about to load again in it
	 */
	private choosing = false;

	/**
	 * Lists the universe's languages
	 *
	 * @param universe The universe
	 */
	constructor(private readonly universe: UniverseDetails)
	{
		this.render();
	}

	/**
	 * Follows the player logging in and out, and the language their profile names
	 *
	 * @param profiles The profile routes while the browser is logged in, or undefined while it isn't
	 * @param profileLocale The language the profile names, or null when it names none
	 */
	setPlayer(profiles: ProfileApi | undefined, profileLocale: string | null): void
	{
		this.profiles = profiles;
		this.profileLocale = ((profiles === undefined) ? null : profileLocale);
		this.render();
	}

	/**
	 * The language the player sees the universe's text in, as the server picks it: the profile's
	 * language, then those the pages ask for (see Finding a translation in STRUCTURE-OVERVIEW.md)
	 *
	 * @return One of the universe's languages
	 */
	private shownLanguage(): string
	{
		const requested = [...((this.profileLocale === null) ? [] : [this.profileLocale]), ...wantedLanguages()];

		return((chooseUniverseLanguage(requested, this.universe.sourceLanguage, this.universe.translationLanguages) ?? this.universe.sourceLanguage));
	}

	/**
	 * Draws the list and the notes under it
	 */
	private render(): void
	{
		const languages = [this.universe.sourceLanguage, ...this.universe.translationLanguages];
		const shown = this.shownLanguage();
		const pageNames = new Intl.DisplayNames([currentLocale()], { type: 'language' });

		this.list.replaceChildren(...languages.map((language) => this.renderLanguage(language, (language === shown), pageNames)));
		showMessage(this.pagesNote, (languages.some((language) => !pagesHaveLanguage(language)) ? t({
			id: 'universePage.universeTextOnlyNote',
			defaultMessage: 'The site itself isn\'t translated into the languages marked "{label}" yet. Choosing one shows universes\' own text in it, such as their names, descriptions, areas and items, wherever a universe is translated into it. The site\'s buttons and menus stay in the language they are in now.',
			description: 'Under the list in the Languages section of a universe\'s page, when some of its languages are ones the site isn\'t translated into; {label} is the words shown beside those languages, "Universe text only"'
		}, {
			label: t(chooserMessages.universeTextOnly)
		}) : undefined));
		this.profileNote.hidden = (this.profileLocale === null);
	}

	/**
	 * Draws one language as a button that chooses it
	 *
	 * @param language The language's tag
	 * @param isShown Whether the player sees the universe's text in it now
	 * @param pageNames Names languages in the page's language
	 * @return The list item
	 */
	private renderLanguage(language: string, isShown: boolean, pageNames: Intl.DisplayNames): HTMLLIElement
	{
		const item = document.createElement('li');
		const button = document.createElement('button');
		const name = document.createElement('strong');
		const ownName = languageName(language);
		const pageName = pageNames.of(language);

		// Each name is in its own language, so translation tools leave it alone
		name.textContent = ownName;
		name.lang = language;
		name.translate = false;

		button.type = 'button';
		button.className = 'universe-language-choice';
		button.setAttribute('aria-pressed', String(isShown));
		button.append(name);

		if ((pageName !== undefined) && (pageName !== ownName))
		{
			button.append(' ', this.note('universe-language-detail', pageName));
		}

		if (!pagesHaveLanguage(language))
		{
			button.append(' ', this.note('universe-language-only', t(chooserMessages.universeTextOnly)));
		}

		// Said in words as well as by the outline, for players who can't see it
		if (isShown)
		{
			button.append(' ', this.note('universe-language-shown', t({
				id: 'universePage.languageShown',
				defaultMessage: 'In use',
				description: 'In the Languages section of a universe\'s page, beside the language the player sees the universe\'s text in now'
			})));
		}

		button.addEventListener('click', () =>
		{
			if (!isShown)
			{
				void this.choose(language);
			}
		});

		item.append(button);

		return(item);
	}

	/**
	 * A few words beside a language's name
	 *
	 * @param className The class that styles them
	 * @param text The words
	 * @return The element
	 */
	private note(className: string, text: string): HTMLSpanElement
	{
		const span = document.createElement('span');

		span.className = className;
		span.textContent = text;

		return(span);
	}

	/**
	 * Plays the universe in a language: changes the language the profile names, when it names one, and
	 * loads the page again in it
	 *
	 * @param language The language's tag
	 */
	private async choose(language: string): Promise<void>
	{
		if (this.choosing)
		{
			return;
		}

		this.choosing = true;
		showMessage(this.error, undefined);

		if (this.profiles !== undefined)
		{
			try
			{
				await this.profiles.saveProfileLocale(language);
			}
			catch (error)
			{
				showMessage(this.error, describeEditorError(error, {
					id: 'universePage.profileLocaleFailed',
					defaultMessage: 'Could not change the language on your profile, so the language wasn\'t changed.',
					description: 'Shown in the Languages section of a universe\'s page when choosing a language failed because the player\'s profile couldn\'t be changed to it'
				}));
				this.choosing = false;
				return;
			}
		}

		chooseLocale(language);
	}
}
