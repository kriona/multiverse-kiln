import { PSEUDO_LOCALE } from '@multiverse-kiln/shared';

import { availableLocales, chooseLocale, currentLocale } from '../localization';
import { getElement } from './dom';

/**
 * Names of languages Intl.DisplayNames doesn't know, as each calls itself
 */
const LANGUAGE_NAMES: Record<string, string> = {
	'en-x-pirate': 'Pirate',
	[PSEUDO_LOCALE]: 'Gibberish'
};

/**
 * Fills the language picker in the footer with the languages there are translations for, each named
 * in its own language, and switches language when the player picks one
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
 * A language's name in that language, e.g. Deutsch for de
 *
 * @param locale The language tag
 * @return The name
 */
function languageName(locale: string): string
{
	return(LANGUAGE_NAMES[locale] ?? new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale);
}
