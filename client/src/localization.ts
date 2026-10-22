/**
 * The player's language, and the text the pages show in it (see shared/src/localization.ts)
 *
 * startLocalization() runs before anything else on a page: it picks the language, loads its
 * translations and translates the text the page's HTML marks with data-message. Code then shows
 * messages with t()
 */
import { LOCALE_PARAMETER, readPageParameter, replacePageParameters } from './pages';
import { matchLocale, SOURCE_LOCALE, translationCatalog, Translator, type LocalizedMessage, type MessageSource, type MessageValues, type TranslationFile } from '@multiverse-kiln/shared';

/**
 * Each language's file, loaded when it's needed, by its file's path. In development this includes the
 * pseudo-language's, which the dev server writes (see vite.config.ts); production builds leave it out
 * even when the file is there
 */
const translationFiles = {
	...import.meta.glob<TranslationFile>(['../../shared/locales/*.json', '!../../shared/locales/en.json', '!../../shared/locales/en-XA.json'], { import: 'default' }),
	...(import.meta.env.DEV ? import.meta.glob<TranslationFile>('../../shared/locales/en-XA.json', { import: 'default' }) : {})
};

/**
 * Each language's file loader, by its language tag
 */
const loaders = new Map(Object.entries(translationFiles).map(([file, load]) => [(file.split('/').pop() ?? '').replace(/\.json$/, ''), load]));

/**
 * Where the browser keeps the language the player chose, until profiles hold it (Phase 13)
 */
const LOCALE_STORAGE_KEY = 'kiln.locale';

/**
 * Formats messages in the player's language; English until startLocalization() has run
 */
let translator = new Translator(SOURCE_LOCALE);

/**
 * Picks the player's language, loads its translations and translates the page's marked text
 */
export async function startLocalization(): Promise<void>
{
	const locale = matchLocale(requestedLocales(), availableLocales());
	const load = loaders.get(locale);

	try
	{
		translator = new Translator(locale, ((load === undefined) ? {} : translationCatalog(await load())));
	}
	catch (error)
	{
		console.error(`Could not load the ${locale} translations; showing English:`, error);
		return;
	}

	document.documentElement.lang = locale;
	localizePage(document.documentElement);
}

/**
 * The languages there are translations for
 *
 * @return Their language tags, English first
 */
export function availableLocales(): string[]
{
	return([SOURCE_LOCALE, ...loaders.keys()]);
}

/**
 * Switches to a language: remembers it in the browser and loads the page again in it
 *
 * @param locale The language tag
 */
export function chooseLocale(locale: string): void
{
	try
	{
		localStorage.setItem(LOCALE_STORAGE_KEY, locale);
		replacePageParameters({ [LOCALE_PARAMETER]: undefined });
	}
	catch
	{
		// Without storage, the choice lasts as long as it stays in the page's address
		replacePageParameters({ [LOCALE_PARAMETER]: locale });
	}

	window.location.reload();
}

/**
 * The languages the player wants, most wanted first: the one chosen with the language picker or with
 * ?locale= (e.g. ?locale=en-XA for the pseudo-language), then the browser's. ?locale= given empty
 * forgets the choice
 *
 * @return The languages
 */
function requestedLocales(): readonly string[]
{
	const chosen = readPageParameter(LOCALE_PARAMETER);

	try
	{
		if (chosen === '')
		{
			localStorage.removeItem(LOCALE_STORAGE_KEY);
		}
		else if (chosen !== undefined)
		{
			localStorage.setItem(LOCALE_STORAGE_KEY, chosen);
		}

		const remembered = localStorage.getItem(LOCALE_STORAGE_KEY);

		if (remembered !== null)
		{
			return([remembered, ...navigator.languages]);
		}
	}
	catch
	{
		if ((chosen !== undefined) && (chosen !== ''))
		{
			return([chosen, ...navigator.languages]);
		}
	}

	return(navigator.languages);
}

/**
 * The player's language, for formatting times and sorting names
 *
 * @return The language tag, e.g. "en"
 */
export function currentLocale(): string
{
	return(translator.locale);
}

/**
 * Joins words into a list the way the player's language does
 *
 * @param items The words, already in the player's language
 * @param type conjunction for a list read as part of a sentence ("A, B and C"), unit for a list of tags ("A, B, C")
 * @return The list
 */
export function formatList(items: readonly string[], type: 'conjunction' | 'unit' = 'unit'): string
{
	return(new Intl.ListFormat(translator.locale, { style: ((type === 'unit') ? 'short' : 'long'), type }).format(items));
}

/**
 * A time of day in the game, such as 6:30 PM
 *
 * @param secondOfDay Seconds since midnight (see secondOfDay in /shared)
 * @return The time in the player's language, to the minute
 */
export function formatTimeOfDay(secondOfDay: number): string
{
	// Game time has no time zone, so it is formatted as a time in UTC to keep the player's own zone out of it
	return(new Intl.DateTimeFormat(translator.locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Math.floor(secondOfDay) * 1000)));
}

/**
 * A number with its sign, such as +2, -1 or 0
 *
 * @param value The number
 * @return The number in the player's language
 */
export function signedNumber(value: number): string
{
	return(new Intl.NumberFormat(translator.locale, { signDisplay: 'exceptZero' }).format(value));
}

/**
 * A message in the player's language
 *
 * @param message The message, from a defineMessages() call or sent by the server
 * @param values Its arguments' values
 * @return The text
 */
export function t(message: MessageSource, values?: MessageValues): string
{
	return(translator.format(message, values));
}

/**
 * A message the server sent, in the player's language
 *
 * @param message The message, with its arguments' values
 * @return The text
 */
export function localizedText(message: LocalizedMessage): string
{
	return(translator.format(message, message.values));
}

/**
 * A message whose arguments may be elements, e.g. a name shown in bold, as nodes to add to the page
 *
 * @param message The message
 * @param values Its arguments' values
 * @return Text and the given elements, in order
 */
export function formatToNodes(message: MessageSource, values: Record<string, string | number | Node>): (string | Node)[]
{
	return(translator.formatToParts<Node>(message, values));
}

/**
 * Translates the text an element and the elements inside it mark with data-message (see
 * shared/scripts/extractMessages.ts). Nothing changes in English
 *
 * @param root The element
 */
function localizePage(root: Element): void
{
	if (translator.locale === SOURCE_LOCALE)
	{
		return;
	}

	for (const element of [root, ...root.querySelectorAll('*')])
	{
		const id = element.getAttribute('data-message');

		if (id !== null)
		{
			localizeText(element, id);
		}

		for (const attribute of element.getAttributeNames())
		{
			const value = (attribute.startsWith('data-message-') ? element.getAttribute(attribute.slice('data-message-'.length)) : null);

			if (value !== null)
			{
				element.setAttribute(attribute.slice('data-message-'.length), t({ id: (element.getAttribute(attribute) ?? ''), defaultMessage: collapseWhitespace(value) }));
			}
		}
	}
}

/**
 * Translates an element's own text: its children from its first text or argument to its last, where
 * each child with data-argument is an argument, and the whitespace between them is kept. Children
 * before or after, such as an input inside a label, stay where they are. Must match elementMessage()
 * in shared/scripts/extractMessages.ts
 *
 * @param element The element
 * @param id Its message's ID
 */
function localizeText(element: Element, id: string): void
{
	const children = [...element.childNodes];
	const isArgument = (node: Node): node is Element => ((node instanceof Element) && node.hasAttribute('data-argument'));
	const significant = children.filter((node) => (((node instanceof Text) && (node.data.trim() !== '')) || isArgument(node)));
	const first = significant[0];
	const last = significant[significant.length - 1];

	if ((first === undefined) || (last === undefined))
	{
		return;
	}

	const parts = children
		.slice(children.indexOf(first), children.indexOf(last) + 1)
		.filter((node) => ((node instanceof Text) || isArgument(node)));
	const values: Record<string, Node> = {};
	let source = '';

	for (const part of parts)
	{
		if (isArgument(part))
		{
			const name = (part.getAttribute('data-argument') ?? '');

			values[name] = part;
			source += `{${name}}`;
		}
		else
		{
			source += part.textContent;
		}
	}

	// Keeps the spacing between the message and the children around it, e.g. a checkbox before its label
	const before = (((first instanceof Text) && /^\s/.test(first.data)) ? ' ' : '');
	const after = (((last instanceof Text) && /\s$/.test(last.data)) ? ' ' : '');
	const marker = document.createComment('');

	element.insertBefore(marker, first);

	for (const part of parts)
	{
		part.remove();
	}

	marker.replaceWith(...[before, ...formatToNodes({ id, defaultMessage: collapseWhitespace(source) }, values), after].filter((node) => (node !== '')));
}

/**
 * Text with each run of whitespace made one space, and none at either end, as the extractor reads it
 *
 * @param text The text
 * @return The collapsed text
 */
function collapseWhitespace(text: string): string
{
	return(text.replace(/\s+/g, ' ').trim());
}
