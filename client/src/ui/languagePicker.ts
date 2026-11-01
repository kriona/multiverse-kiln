import { languageName } from '@multiverse-kiln/shared';

import { availableLocales, chooseLocale, currentLocale } from '../localization';
import type { ComboboxChoice } from './ComboboxList';
import { getElement } from './dom';

/**
 * Fills the language picker in the footer with the languages there are translations for, each named
 * in its own language and sorted in the page's language, and switches language when the player picks
 * one. The build writes the same languages into the footer's HTML (client/vite.config.ts), so the
 * picker has its width before this runs
 */
export function startLanguagePicker(): void
{
	const select = getElement('language-select', HTMLSelectElement);
	const current = currentLocale();
	const languages = availableLocales()
		.map((locale) => ({ locale, name: languageName(locale) }))
		.sort((first, second) => first.name.localeCompare(second.name, current));

	select.replaceChildren(...languages.map(({ locale, name }) =>
	{
		const option = new Option(name, locale, false, (locale === current));

		// Each name is in its own language, so translation tools leave it alone
		option.translate = false;
		option.lang = locale;

		return(option);
	}));

	select.addEventListener('change', () =>
	{
		chooseLocale(select.value);
	});
}

/**
 * Languages to choose from in a ChipCombobox, each named in itself, with its name in the page's
 * language after it when that differs, sorted by name
 *
 * @param languages The languages' tags
 * @return The choices
 */
export function languageChoices(languages: readonly string[]): ComboboxChoice[]
{
	const current = currentLocale();
	const pageNames = new Intl.DisplayNames([current], { type: 'language' });

	return(languages
		.map((language) =>
		{
			const name = languageName(language);
			const pageName = pageNames.of(language);

			return({
				value: language,
				name,
				lang: language,
				detail: (((pageName === undefined) || (pageName === name)) ? undefined : pageName)
			});
		})
		.sort((first, second) => first.name.localeCompare(second.name, current)));
}
