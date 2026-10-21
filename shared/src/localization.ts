/**
 * Text players read, in their language (see Localization in STRUCTURE-OVERVIEW.md)
 *
 * Every message is written in the code where it is used, as an object of string literals: an ID, its
 * English text and a description for translators, e.g. t({ id, defaultMessage, description }). A
 * message used in more than one place, or looked up from a table, is declared once in a
 * defineMessages() call instead. Text in the pages' HTML is marked with data-message attributes. The extractor (shared/scripts/extractMessages.ts) gathers both into shared/locales/en.json, which
 * translators work from. A translation is a MessageCatalog in shared/locales/<language>.json
 *
 * Messages use ICU MessageFormat, so plurals and other grammar that changes with a value are part of
 * the message: "{count, plural, one {# area} other {# areas}}"
 */
import { createLiteralElement, isLiteralElement, isPluralElement, isSelectElement, isTagElement, parse, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { printAST } from '@formatjs/icu-messageformat-parser/printer.js';
import { IntlMessageFormat } from 'intl-messageformat';

/**
 * The language messages are written in
 */
export const SOURCE_LOCALE = 'en';

/**
 * A language for development that shows every message with accented vowels and lengthened, so text that skipped
 * translation, and layouts that can't fit longer text, stand out
 */
export const PSEUDO_LOCALE = 'en-XA';

/**
 * A message as the code declares it
 */
export interface MessageDescriptor
{
	/**
	 * Dot-separated, starting with the area it belongs to, e.g. "editor.tile.save"
	 */
	id: string;

	/**
	 * The English text, in ICU MessageFormat
	 */
	defaultMessage: string;

	/**
	 * What the message is and where it appears, for translators
	 */
	description: string;
}

/**
 * The parts of a message needed to show it: its ID, to look up a translation, and its English text.
 * A message written where it's used also has its description, which only the extractor reads
 */
export interface MessageSource
{
	id: string;
	defaultMessage: string;
	description?: string;
}

/**
 * Values for a message's arguments, by name
 */
export type MessageValues = Record<string, string | number>;

/**
 * A message sent to the client to show in the player's language, e.g. the reason a request failed
 */
export interface LocalizedMessage extends MessageSource
{
	values?: MessageValues;
}

/**
 * One language's translations: each message's text by its ID
 */
export type MessageCatalog = Record<string, string>;

/**
 * One translated message as its language's file stores it
 */
export interface Translation
{
	/**
	 * The translation, in ICU MessageFormat
	 */
	message: string;

	/**
	 * The English it was translated from. When the English changes, the translation is out of date:
	 * it is still shown until it is updated
	 */
	source: string;
}

/**
 * A language's file in shared/locales, e.g. de.json: each message's translation by its ID
 */
export type TranslationFile = Record<string, Translation>;

/**
 * Which English messages a language's file is missing, and which of its translations are out of date
 */
export interface TranslationStatus
{
	missing: string[];
	outdated: string[];
}

/**
 * The translations in a language's file, for a Translator
 *
 * @param file The language's file
 * @return Each message's translation by its ID
 */
export function translationCatalog(file: TranslationFile): MessageCatalog
{
	return(Object.fromEntries(Object.entries(file).map(([id, translation]) => [id, translation.message])));
}

/**
 * How current a language's translations are
 *
 * @param messages The English messages by ID, as in shared/locales/en.json
 * @param file The language's file
 * @return The IDs of the English messages it has no translation of, and of the translations made from
 * English that has changed since, each sorted
 */
export function translationStatus(messages: Record<string, { defaultMessage: string }>, file: TranslationFile): TranslationStatus
{
	const ids = Object.keys(messages).sort();

	return({
		missing: ids.filter((id) => (file[id] === undefined)),
		outdated: ids.filter((id) => ((file[id] !== undefined) && (file[id].source !== messages[id].defaultMessage)))
	});
}

/**
 * Declares messages, so the extractor can find them
 *
 * @param messages Each message by a name the code uses for it
 * @return The same messages
 */
export function defineMessages<T extends Record<string, MessageDescriptor>>(messages: T): T
{
	return(messages);
}

/**
 * A message to send to the client, with the values for its arguments
 *
 * @param message The message
 * @param values Its arguments' values
 * @return The message, without its description
 */
export function localize(message: MessageDescriptor, values?: MessageValues): LocalizedMessage
{
	const localized: LocalizedMessage = {
		id: message.id,
		defaultMessage: message.defaultMessage
	};

	if (values !== undefined)
	{
		localized.values = values;
	}

	return(localized);
}

/**
 * Whether a value received from the server is a LocalizedMessage
 *
 * @param value The value
 * @return Whether it is
 */
export function isLocalizedMessage(value: unknown): value is LocalizedMessage
{
	if ((typeof value !== 'object') || (value === null) || !('id' in value) || !('defaultMessage' in value) || (typeof value.id !== 'string') || (typeof value.defaultMessage !== 'string'))
	{
		return(false);
	}

	if (!('values' in value) || (value.values === undefined))
	{
		return(true);
	}

	return((typeof value.values === 'object') && (value.values !== null) && Object.values(value.values).every((entry) => ((typeof entry === 'string') || (typeof entry === 'number'))));
}

/**
 * Formats messages in one language
 */
export class Translator
{
	/**
	 * Each message's compiled form, by its ID and text
	 */
	private readonly formats = new Map<string, IntlMessageFormat>();

	/**
	 * @param locale The language, e.g. "fr" or PSEUDO_LOCALE
	 * @param catalog Its translations; a message without one is shown in English
	 */
	constructor(readonly locale: string, private readonly catalog: MessageCatalog = {})
	{
	}

	/**
	 * A message as text
	 *
	 * @param message The message
	 * @param values Its arguments' values
	 * @return The text
	 */
	format(message: MessageSource, values?: MessageValues): string
	{
		return(this.formatToParts<never>(message, values).join(''));
	}

	/**
	 * A message as text and objects, for arguments that aren't text, e.g. an element on a page
	 *
	 * @param message The message
	 * @param values Its arguments' values
	 * @return The text and objects, in order
	 */
	formatToParts<T>(message: MessageSource, values?: Record<string, string | number | T>): (string | T)[]
	{
		const formatted = this.compile(message).format<T>(values);

		return((Array.isArray(formatted) ? formatted : [formatted]));
	}

	/**
	 * A message's compiled form, using its translation when there is one that compiles
	 *
	 * @param message The message
	 * @return The compiled form
	 */
	private compile(message: MessageSource): IntlMessageFormat
	{
		const translation = this.catalog[message.id];
		const text = (translation ?? message.defaultMessage);
		const key = `${message.id}\n${text}`;
		let format = this.formats.get(key);

		if (format === undefined)
		{
			try
			{
				format = this.create(text);
			}
			catch (error)
			{
				if (translation === undefined)
				{
					throw error;
				}

				console.error(`The ${this.locale} translation of ${message.id} could not be read; using English:`, error);
				format = this.create(message.defaultMessage);
			}

			this.formats.set(key, format);
		}

		return(format);
	}

	/**
	 * Compiles a message's text
	 *
	 * @param text The text, in ICU MessageFormat
	 * @return The compiled form
	 */
	private create(text: string): IntlMessageFormat
	{
		return(new IntlMessageFormat(text, this.locale));
	}
}

/**
 * Accented vowels for the pseudo-language; other letters stay as they are, so its text stays easy to read
 */
const PSEUDO_LETTERS: Record<string, string> = {
	a: 'å', e: 'é', i: 'î', o: 'ö', u: 'û',
	A: 'Å', E: 'É', I: 'Î', O: 'Ö', U: 'Û'
};

/**
 * The character that lengthens a message in the pseudo-language
 */
const PSEUDO_PADDING = '~';

/**
 * How many padding characters make a word. The padding is split into words so it wraps the way the
 * extra words of a longer translation would, rather than being one word too long for its line
 */
const PSEUDO_WORD_LENGTH = 5;

/**
 * How much longer the pseudo-language makes a message, as a share of its letters. German runs about
 * 30% longer than English
 */
const PSEUDO_EXPANSION = 0.3;

/**
 * A message in the pseudo-language: its vowels accented, and lengthened and bracketed, e.g. "Saved"
 * becomes "[Såvéd ~~]". Arguments and the structure of plurals are kept. The pseudo-language's catalog
 * (shared/locales/en-XA.json) is made of these
 *
 * @param text The English message, in ICU MessageFormat
 * @return The pseudo-language's version, in ICU MessageFormat
 */
export function pseudoMessage(text: string): string
{
	return(printAST(pseudoLocalize(parse(text))));
}

/**
 * A parsed message in the pseudo-language (see pseudoMessage)
 *
 * @param elements The parsed message
 * @return The pseudo-language's version
 */
function pseudoLocalize(elements: MessageFormatElement[]): MessageFormatElement[]
{
	const words: string[] = [];

	for (let remaining = Math.ceil(countLetters(elements) * PSEUDO_EXPANSION); remaining > 0; remaining -= PSEUDO_WORD_LENGTH)
	{
		words.push(PSEUDO_PADDING.repeat(Math.min(remaining, PSEUDO_WORD_LENGTH)));
	}

	const padding = words.map((word) => ` ${word}`).join('');

	return([createLiteralElement('['), ...accentElements(elements), createLiteralElement(`${padding}]`)]);
}

/**
 * Accents the text of a parsed message, including inside plurals, selects and tags
 *
 * @param elements The parsed message
 * @return A copy with its text accented
 */
function accentElements(elements: MessageFormatElement[]): MessageFormatElement[]
{
	return(elements.map((element) =>
	{
		if (isLiteralElement(element))
		{
			return(createLiteralElement([...element.value].map((character) => (PSEUDO_LETTERS[character] ?? character)).join('')));
		}

		if (isPluralElement(element) || isSelectElement(element))
		{
			const options = Object.fromEntries(Object.entries(element.options).map(([key, option]) => [key, { ...option, value: accentElements(option.value) }]));

			return({ ...element, options });
		}

		if (isTagElement(element))
		{
			return({ ...element, children: accentElements(element.children) });
		}

		return(element);
	}));
}

/**
 * How many letters a parsed message shows, counting the longest choice of each plural or select
 *
 * @param elements The parsed message
 * @return The number of letters
 */
function countLetters(elements: MessageFormatElement[]): number
{
	let count = 0;

	for (const element of elements)
	{
		if (isLiteralElement(element))
		{
			count += (element.value.match(/\p{L}/gu)?.length ?? 0);
		}
		else if (isPluralElement(element) || isSelectElement(element))
		{
			count += Math.max(0, ...Object.values(element.options).map((option) => countLetters(option.value)));
		}
		else if (isTagElement(element))
		{
			count += countLetters(element.children);
		}
	}

	return(count);
}

/**
 * The names of a message's arguments and tags, which a translation must keep
 *
 * @param text The message, in ICU MessageFormat
 * @return The names, sorted; tags as "<name>"
 */
export function messageArguments(text: string): string[]
{
	const names = new Set<string>();

	/**
	 * Adds the names used in part of a message
	 *
	 * @param elements The part, parsed
	 */
	function collect(elements: MessageFormatElement[]): void
	{
		for (const element of elements)
		{
			if (isTagElement(element))
			{
				names.add(`<${element.value}>`);
				collect(element.children);
			}
			else if (isPluralElement(element) || isSelectElement(element))
			{
				names.add(element.value);

				for (const option of Object.values(element.options))
				{
					collect(option.value);
				}
			}
			else if (!isLiteralElement(element) && ('value' in element))
			{
				names.add(element.value);
			}
		}
	}

	collect(parse(text));

	return([...names].sort());
}

/**
 * Checks one language's translations against the English messages
 *
 * @param messages The English messages by ID, as in shared/locales/en.json
 * @param catalog The language's translations
 * @return A description of each problem: a translation of a message that doesn't exist, one that
 * can't be read, or one whose arguments differ from the English
 */
export function catalogProblems(messages: Record<string, { defaultMessage: string }>, catalog: MessageCatalog): string[]
{
	const problems: string[] = [];

	for (const [id, translation] of Object.entries(catalog))
	{
		const source = messages[id];

		if (source === undefined)
		{
			problems.push(`${id}: there is no such message`);
			continue;
		}

		let translated: string[];

		try
		{
			translated = messageArguments(translation);
		}
		catch (error)
		{
			problems.push(`${id}: could not be read (${(error instanceof Error) ? error.message : String(error)})`);
			continue;
		}

		const expected = messageArguments(source.defaultMessage);

		if (translated.join(',') !== expected.join(','))
		{
			problems.push(`${id}: uses ${translated.join(', ') || 'nothing'} instead of ${expected.join(', ') || 'nothing'}`);
		}
	}

	return(problems);
}

/**
 * The best of the available languages for a player
 *
 * Takes the first language the player wants that is available, or failing that one with the same base
 * language (fr-CA finds fr, and fr finds fr-CA). Falls back to SOURCE_LOCALE
 *
 * @param requested The languages the player wants, most wanted first, e.g. navigator.languages
 * @param available The languages there are translations for, including SOURCE_LOCALE
 * @return One of the available languages
 */
export function matchLocale(requested: readonly string[], available: readonly string[]): string
{
	for (const wanted of requested)
	{
		const lowerWanted = wanted.toLowerCase();
		const exact = available.find((locale) => (locale.toLowerCase() === lowerWanted));

		if (exact !== undefined)
		{
			return(exact);
		}

		const language = baseLanguage(wanted);
		const sameLanguage = available.find((locale) => (baseLanguage(locale) === language));

		if (sameLanguage !== undefined)
		{
			return(sameLanguage);
		}
	}

	return(SOURCE_LOCALE);
}

/**
 * A language tag without its region or script
 *
 * @param locale The language tag, e.g. "pt-BR"
 * @return The base language in lower case, e.g. "pt"
 */
function baseLanguage(locale: string): string
{
	return(locale.split('-')[0].toLowerCase());
}
