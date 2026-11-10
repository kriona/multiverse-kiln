/**
 * Universe text in the language a request asks for (see Localization in STRUCTURE-OVERVIEW.md), for
 * the routes that show it to players. The editor's routes show the source text instead
 */
import { chooseUniverseLanguage, translationLanguagesFor, universeText, type OptionName, type UniverseTextField, type UniverseTextKind } from '@multiverse-kiln/shared';

import type { Executor } from '../db/client.js';
import { listTranslationsIn, type WantedText } from '../db/universeTextRepo.js';

/**
 * The languages of a universe
 */
export interface UniverseLanguages
{
	id: string;
	sourceLanguage: string;
	translationLanguages: readonly string[];
}

/**
 * The key a piece of text's translations are kept under
 *
 * @param kind What the text belongs to
 * @param thingId Its ID
 * @param field Which of its text it is
 * @return The key
 */
function textKey(kind: UniverseTextKind, thingId: number | string, field: UniverseTextField): string
{
	return(`${kind}:${thingId}:${field}`);
}

/**
 * Shows one universe's text in one player's language: the translation in the closest of the universe's
 * languages to theirs, falling back to the source text (findTranslation())
 */
export class UniverseTextTranslator
{
	/**
	 * @param language The universe's language the text is translated into, or undefined to show the source text
	 * @param translations Each piece of text's translations, by textKey(), then by language
	 */
	private constructor(private readonly language: string | undefined, private readonly translations: ReadonlyMap<string, Record<string, string>>)
	{
	}

	/**
	 * Loads one universe's translations for the languages a request asks for
	 *
	 * @param universe The universe and its languages
	 * @param requested The languages asked for, most wanted first (requestLanguages())
	 * @param kinds The kinds of text that will be shown, each whole or only some things', or undefined for every kind
	 * @param executor The database, or a transaction
	 * @return The translator
	 */
	static async load(universe: UniverseLanguages, requested: readonly string[], kinds?: readonly WantedText[], executor?: Executor): Promise<UniverseTextTranslator>
	{
		const translators = await UniverseTextTranslator.loadAll([universe], requested, kinds, executor);

		return((translators.get(universe.id) ?? new UniverseTextTranslator(undefined, new Map())));
	}

	/**
	 * Loads several universes' translations for the languages a request asks for, in one query
	 *
	 * @param universes The universes and their languages
	 * @param requested The languages asked for, most wanted first (requestLanguages())
	 * @param kinds The kinds of text that will be shown, each whole or only some things', or undefined for every kind
	 * @param executor The database, or a transaction
	 * @return A translator for each universe, by ID
	 */
	static async loadAll(universes: readonly UniverseLanguages[], requested: readonly string[], kinds?: readonly WantedText[], executor?: Executor): Promise<Map<string, UniverseTextTranslator>>
	{
		const chosen = new Map(universes.map((universe) => [universe.id, chooseUniverseLanguage(requested, universe.sourceLanguage, universe.translationLanguages)]));
		const rows = await listTranslationsIn(universes.map((universe) =>
		{
			const language = chosen.get(universe.id);

			return({
				universeId: universe.id,
				languages: ((language === undefined) ? [] : translationLanguagesFor(language, universe.translationLanguages))
			});
		}), kinds, executor);
		const byUniverse = new Map<string, Map<string, Record<string, string>>>();

		for (const row of rows)
		{
			const translations = (byUniverse.get(row.universeId) ?? new Map<string, Record<string, string>>());
			const key = textKey(row.kind, row.thingId, row.field);

			translations.set(key, { ...translations.get(key), [row.language]: row.text });
			byUniverse.set(row.universeId, translations);
		}

		return(new Map(universes.map((universe) => [universe.id, new UniverseTextTranslator(chosen.get(universe.id), (byUniverse.get(universe.id) ?? new Map()))])));
	}

	/**
	 * A piece of the universe's text in the player's language
	 *
	 * @param kind What it belongs to
	 * @param thingId Its ID; the universe's own ID for its own text
	 * @param field Which of its text it is
	 * @param source The text in the universe's source language
	 * @return The translation, or the source text when there is none
	 */
	text(kind: UniverseTextKind, thingId: number | string, field: UniverseTextField, source: string): string
	{
		if (this.language === undefined)
		{
			return(source);
		}

		return(universeText(source, (this.translations.get(textKey(kind, thingId, field)) ?? {}), this.language));
	}

	/**
	 * The name of a race, class, theme, item, tile or difficulty level in the player's language. One of
	 * the ruleset's defaults the universe hasn't renamed has no name of its own, and is engine text the
	 * client names from its key
	 *
	 * @param kind What it is
	 * @param thingId Its ID
	 * @param option Its key and its name in the source language
	 * @return The same, with the name translated
	 */
	name<T extends OptionName>(kind: UniverseTextKind, thingId: number, option: T): T
	{
		return(((option.name === null) ? option : { ...option, name: this.text(kind, thingId, 'name', option.name) }));
	}
}
