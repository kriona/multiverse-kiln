import { languageName } from '@multiverse-kiln/shared';

import { formatList, t } from '../localization';

/**
 * The languages a universe can be played in, as Home shows them: the language
 * its text is written in, then those it is translated into, each named in its own language
 *
 * @param universe The universe's source language and translation languages, by tag
 * @return The text, e.g. "Languages: English, Deutsch, français"
 */
export function describeUniverseLanguages(universe: { sourceLanguage: string; translationLanguages: readonly string[] }): string
{
	return(t({
		id: 'universe.languages',
		defaultMessage: 'Languages: {languages}',
		description: 'Under a universe on Home: the languages it can be played in, the one its text is written in first; {languages} is a list of language names, each in its own language, such as "English, Deutsch, français"'
	}, {
		languages: formatList([universe.sourceLanguage, ...universe.translationLanguages].map((language) => languageName(language)))
	}));
}
