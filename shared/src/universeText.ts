/**
 * Universe text: the text a universe's editors write, which is translated into the universe's languages
 * (see Localization in STRUCTURE-OVERVIEW.md). Engine text, such as a ruleset default the universe hasn't
 * renamed, is translated with the engine instead (localization.ts)
 */
import { MAX_DIFFICULTY_NAME_LENGTH } from './difficulty.js';
import { MAX_AREA_NAME_LENGTH, MAX_CLASS_NAME_LENGTH, MAX_ITEM_NAME_LENGTH, MAX_LONG_DESCRIPTION_LENGTH, MAX_RACE_NAME_LENGTH, MAX_SHORT_DESCRIPTION_LENGTH, MAX_THEME_NAME_LENGTH, MAX_TILE_NAME_LENGTH, MAX_UNIVERSE_NAME_LENGTH } from './editor.js';
import { PROFILE_LANGUAGES } from './profiles.js';
import type { SortDirection } from './sorting.js';

/**
 * What a piece of universe text belongs to: the universe itself, or one of the things it holds
 */
export const UNIVERSE_TEXT_KINDS = [
	'universe',
	'area',
	'tile',
	'item',
	'race',
	'class',
	'theme',
	'difficultyLevel'
] as const;

export type UniverseTextKind = typeof UNIVERSE_TEXT_KINDS[number];

/**
 * Which of its text a piece of universe text is
 */
export const UNIVERSE_TEXT_FIELDS = [
	'name',
	'shortDescription',
	'longDescription'
] as const;

export type UniverseTextField = typeof UNIVERSE_TEXT_FIELDS[number];

/**
 * The text each kind of thing has: the universe has its name and descriptions, and everything else its name
 */
export const UNIVERSE_TEXT_KIND_FIELDS: Readonly<Record<UniverseTextKind, readonly UniverseTextField[]>> = {
	universe: ['name', 'shortDescription', 'longDescription'],
	area: ['name'],
	tile: ['name'],
	item: ['name'],
	race: ['name'],
	class: ['name'],
	theme: ['name'],
	difficultyLevel: ['name']
};

/**
 * A piece of universe text: one field of something the universe holds
 */
export interface UniverseTextRef
{
	kind: UniverseTextKind;

	/**
	 * The ID of what the text belongs to, as text (an area's UUID, or a tile's, item's, race's, class's,
	 * theme's or difficulty level's number); the universe's own ID for its own text
	 */
	thingId: string;

	field: UniverseTextField;
}

/**
 * Most characters a translation of a piece of universe text may have: as many as the text itself
 *
 * @param kind What the text belongs to
 * @param field Which of its text it is
 * @return The most characters
 */
export function maxUniverseTextLength(kind: UniverseTextKind, field: UniverseTextField): number
{
	if (field === 'shortDescription')
	{
		return(MAX_SHORT_DESCRIPTION_LENGTH);
	}

	if (field === 'longDescription')
	{
		return(MAX_LONG_DESCRIPTION_LENGTH);
	}

	const nameLengths: Record<UniverseTextKind, number> = {
		universe: MAX_UNIVERSE_NAME_LENGTH,
		area: MAX_AREA_NAME_LENGTH,
		tile: MAX_TILE_NAME_LENGTH,
		item: MAX_ITEM_NAME_LENGTH,
		race: MAX_RACE_NAME_LENGTH,
		class: MAX_CLASS_NAME_LENGTH,
		theme: MAX_THEME_NAME_LENGTH,
		difficultyLevel: MAX_DIFFICULTY_NAME_LENGTH
	};

	return(nameLengths[kind]);
}

/**
 * The columns the Translations tab's table can be sorted by: where the text comes from (by kind, then
 * the name of what it belongs to, then its field), the source text, the note and the translation
 */
export const UNIVERSE_TEXT_SORT_COLUMNS = ['place', 'source', 'note', 'translation'] as const;

export type UniverseTextSortColumn = typeof UNIVERSE_TEXT_SORT_COLUMNS[number];

/**
 * Most pieces of universe text one page of the Translations tab's table holds
 */
export const MAX_UNIVERSE_TEXT_PER_PAGE = 100;

/**
 * Query parameters of GET EDITOR_UNIVERSES_PATH/:universeId/translations: the universe's text with its
 * translations into one language. Only creators, builders (who may write notes) and translators of the
 * language may ask; the language must be one the universe is translated into
 */
export interface UniverseTextListQuery
{
	language: string;

	/**
	 * Text found in where it comes from, the source text, the note or the translation, ignoring capitals
	 */
	search?: string;

	/**
	 * With either set, only the text whose translation is missing or out of date, as set (both: either).
	 * Text that needs no translation is neither
	 */
	missing?: boolean;
	outOfDate?: boolean;

	/**
	 * The column to sort by before paging, place when left out; text that ties comes by place
	 */
	sort?: UniverseTextSortColumn;

	/**
	 * Which way to sort, ascending when left out
	 */
	direction?: SortDirection;

	/**
	 * How many matching pieces of text to skip
	 */
	offset?: number;

	/**
	 * Most to return, up to MAX_UNIVERSE_TEXT_PER_PAGE (the default)
	 */
	limit?: number;
}

/**
 * A piece of universe text as the Translations tab lists it
 */
export interface UniverseTextRow extends UniverseTextRef
{
	/**
	 * The name of what it belongs to, in the source language, for where it comes from ("Area: Waterdeep, name")
	 */
	thingName: string;

	/**
	 * The text in the source language; markdown for a long description
	 */
	source: string;

	/**
	 * sourceTextHash() of the source text, which a translation saved from this row keeps
	 */
	sourceHash: string;

	/**
	 * The note for translators, or null for none
	 */
	note: string | null;

	/**
	 * Whether the text needs no translation in any language, such as a proper name: players see it as
	 * written, and it is never missing or out of date
	 */
	noTranslation: boolean;

	/**
	 * The translation into the language asked for, or null when there is none. One kept while the text
	 * needs no translation isn't shown to players
	 */
	translation: string | null;

	/**
	 * Whether the translation was made from source text that has changed since (isTranslationOutOfDate());
	 * never for text that needs no translation
	 */
	outOfDate: boolean;
}

/**
 * Response of GET EDITOR_UNIVERSES_PATH/:universeId/translations
 */
export interface UniverseTextListPayload
{
	rows: UniverseTextRow[];

	/**
	 * How many pieces of text match, on every page
	 */
	total: number;
}

/**
 * Most languages a universe may be translated into, besides its source language
 */
export const MAX_UNIVERSE_LANGUAGES = 50;

/**
 * Most characters in a note for translators
 */
export const MAX_TRANSLATOR_NOTE_LENGTH = 1000;

/**
 * The language a new universe's text is written in, from its creator's language: that language without
 * its region, when it is one a universe can be translated into, and English otherwise (such as for the
 * pseudo-language and Pirate, which are English underneath)
 *
 * @param locale The creator's language tag, e.g. "pt-BR", or undefined when it isn't known
 * @return The language's tag, e.g. "pt"
 */
export function universeLanguageOf(locale: string | undefined): string
{
	const language = (locale?.split('-')[0].toLowerCase() ?? '');

	return((PROFILE_LANGUAGES.some((each) => (each === language)) ? language : 'en'));
}

/**
 * Which of a universe's languages a player sees its text in: the first language they want that the
 * universe has, as it is (pt-BR) or without its region (pt)
 *
 * @param requested The languages the player wants, most wanted first: their profile's, then their
 * page's (requestLanguages() on the server)
 * @param sourceLanguage The language the universe's text is written in
 * @param translationLanguages The languages it is translated into
 * @return One of its translation languages, or undefined when the player sees the source text
 */
export function chooseUniverseLanguage(requested: readonly string[], sourceLanguage: string, translationLanguages: readonly string[]): string | undefined
{
	const languages = [sourceLanguage, ...translationLanguages];

	for (const wanted of requested)
	{
		const lowerWanted = wanted.toLowerCase();
		const base = lowerWanted.split('-')[0];
		const found = (languages.find((language) => (language.toLowerCase() === lowerWanted)) ?? languages.find((language) => (language.toLowerCase() === base)));

		if (found !== undefined)
		{
			return(((found === sourceLanguage) ? undefined : found));
		}
	}

	return(undefined);
}

/**
 * The languages a translation may be found in for a language chosen with chooseUniverseLanguage(): it,
 * then it without its region, when the universe is translated into that
 *
 * @param language The language chosen
 * @param translationLanguages The languages the universe is translated into
 * @return The languages to look for translations in
 */
export function translationLanguagesFor(language: string, translationLanguages: readonly string[]): string[]
{
	const base = language.split('-')[0].toLowerCase();
	const baseLanguage = translationLanguages.find((each) => ((each.toLowerCase() === base) && (each !== language)));

	return(((baseLanguage === undefined) ? [language] : [language, baseLanguage]));
}

/**
 * A piece of universe text's translation into the player's language: the translation in their language
 * (pt-BR), then in that language without its region (pt). The caller shows the source text when there is
 * neither
 *
 * @param translations The piece of text's translations, by language tag
 * @param locale The player's language tag
 * @return The translation, or undefined when the source text should be shown
 */
export function findTranslation(translations: Readonly<Record<string, string>>, locale: string): string | undefined
{
	const wanted = locale.toLowerCase();
	const base = wanted.split('-')[0];
	const entries = Object.entries(translations);

	for (const language of [wanted, base])
	{
		const found = entries.find(([tag]) => (tag.toLowerCase() === language));

		if (found !== undefined)
		{
			return(found[1]);
		}
	}

	return(undefined);
}

/**
 * A piece of universe text in the player's language: its translation when it has one (findTranslation),
 * and the source text otherwise
 *
 * @param source The text in the universe's source language
 * @param translations Its translations, by language tag
 * @param locale The player's language tag
 * @return The text to show
 */
export function universeText(source: string, translations: Readonly<Record<string, string>>, locale: string): string
{
	return((findTranslation(translations, locale) ?? source));
}

/**
 * Whether a translation is out of date: the source text has changed since it was made, or since a
 * translator last confirmed it still fits. It is still shown until it is updated
 *
 * @param sourceHash The hash of the source text the translation was made from (sourceTextHash())
 * @param source The source text as it is now
 * @return True when the source text has changed
 */
export function isTranslationOutOfDate(sourceHash: string, source: string): boolean
{
	return(sourceHash !== sourceTextHash(source));
}

/**
 * SHA-256's round constants
 */
const SHA256_ROUND_CONSTANTS = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

/**
 * SHA-256's starting hash
 */
const SHA256_INITIAL_HASH = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/**
 * The hash a translation keeps of the source text it was made from, to tell when that text changes: the
 * SHA-256 of its UTF-8, in lowercase hex. Written out here, rather than taken from a crypto library, so
 * the client and server work it out alike and at once; Postgres works out the same with
 * encode(sha256(convert_to(text, 'UTF8')), 'hex')
 *
 * @param text The source text
 * @return The hash, 64 hex digits
 */
export function sourceTextHash(text: string): string
{
	const bytes = new TextEncoder().encode(text);

	// The message, a 1 bit, 0 bits up to 8 bytes short of a whole block, then its length in bits
	const blocksLength = (Math.ceil((bytes.length + 9) / 64) * 64);
	const padded = new Uint8Array(blocksLength);
	const view = new DataView(padded.buffer);

	padded.set(bytes);
	padded[bytes.length] = 0x80;
	view.setUint32((blocksLength - 8), Math.floor(bytes.length / 0x20000000));
	view.setUint32((blocksLength - 4), ((bytes.length * 8) >>> 0));

	const hash = [...SHA256_INITIAL_HASH];
	const words = new Uint32Array(64);

	for (let offset = 0; offset < blocksLength; offset += 64)
	{
		for (let index = 0; index < 16; index++)
		{
			words[index] = view.getUint32((offset + (index * 4)));
		}

		for (let index = 16; index < 64; index++)
		{
			const early = words[index - 15];
			const late = words[index - 2];
			const sigma0 = (rotateRight(early, 7) ^ rotateRight(early, 18) ^ (early >>> 3));
			const sigma1 = (rotateRight(late, 17) ^ rotateRight(late, 19) ^ (late >>> 10));

			words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1);
		}

		const state = [...hash];

		for (let index = 0; index < 64; index++)
		{
			const [a, b, c, d, e, f, g, h] = state;
			const sum1 = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25));
			const choice = ((e & f) ^ (~e & g));
			const first = ((h + sum1 + choice + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0);
			const sum0 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22));
			const majority = ((a & b) ^ (a & c) ^ (b & c));
			const second = ((sum0 + majority) >>> 0);

			state.splice(0, 8, ((first + second) >>> 0), a, b, c, ((d + first) >>> 0), e, f, g);
		}

		for (let index = 0; index < 8; index++)
		{
			hash[index] = ((hash[index] + state[index]) >>> 0);
		}
	}

	return(hash.map((value) => value.toString(16).padStart(8, '0')).join(''));
}

/**
 * Rotates a 32-bit word's bits to the right
 *
 * @param value The word
 * @param bits How far to rotate it, from 1 to 31
 * @return The rotated word
 */
function rotateRight(value: number, bits: number): number
{
	return(((value >>> bits) | (value << (32 - bits))));
}
