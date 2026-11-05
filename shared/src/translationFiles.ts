/**
 * Files translators work on outside the editor (see Tab: Translations in STRUCTURE-OVERVIEW.md): one
 * language of a universe's text, written and read as Gettext PO, XLIFF 2.0, CSV or JSON. Each entry is
 * a piece of universe text, named by its key (universeTextKey()), with the source text it was
 * translated from, so a translation made from text that has changed since comes back out of date
 */
import { UNIVERSE_TEXT_FIELDS, UNIVERSE_TEXT_KINDS, type UniverseTextRef } from './universeText.js';

/**
 * The formats translation files can be written and read in
 *
 * - po: Gettext PO, for Poedit, Weblate, Crowdin and most translation tools
 * - xliff: XLIFF 2.0, the XML standard professional translation tools exchange
 * - csv: comma-separated values, for spreadsheets
 * - json: JSON, for scripts
 */
export const TRANSLATION_FILE_FORMATS = ['po', 'xliff', 'csv', 'json'] as const;

export type TranslationFileFormat = typeof TRANSLATION_FILE_FORMATS[number];

/**
 * The extensions each format's files have, the one written first
 */
export const TRANSLATION_FILE_EXTENSIONS: Readonly<Record<TranslationFileFormat, readonly string[]>> = {
	po: ['.po', '.pot'],
	xliff: ['.xlf', '.xliff'],
	csv: ['.csv'],
	json: ['.json']
};

/**
 * Each format's media type
 */
export const TRANSLATION_FILE_TYPES: Readonly<Record<TranslationFileFormat, string>> = {
	po: 'text/x-gettext-translation',
	xliff: 'application/xliff+xml',
	csv: 'text/csv',
	json: 'application/json'
};

/**
 * The byte order mark, which spreadsheets need at the start of a CSV file to read it as UTF-8, and
 * which reading any file skips
 */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/**
 * One piece of universe text as a file holds it
 */
export interface TranslationFileEntry
{
	/**
	 * The text's key (universeTextKey())
	 */
	id: string;

	/**
	 * Where the text comes from, in the exporting player's language, e.g. "Area: Waterdeep, name"
	 */
	place: string;

	/**
	 * The note for translators, or null for none
	 */
	note: string | null;

	source: string;

	/**
	 * The translation, or null for none yet
	 */
	translation: string | null;

	/**
	 * Whether the translation was made from source text that has changed since
	 */
	outOfDate: boolean;
}

/**
 * What a file holds: one language of a universe's text
 */
export interface TranslationFileContents
{
	/**
	 * The universe's name
	 */
	title: string;

	/**
	 * The language the text is written in, and the language it is translated into, by tag
	 */
	sourceLanguage: string;
	language: string;

	entries: TranslationFileEntry[];
}

/**
 * One translation read from a file
 */
export interface ReadTranslation
{
	/**
	 * The text's key, as the file has it
	 */
	id: string;

	/**
	 * The source text the translation was made from, or null when the file doesn't hold it
	 */
	source: string | null;

	/**
	 * The translation, or null for none
	 */
	translation: string | null;

	/**
	 * Whether the file marks the translation as still needing review (a PO file's fuzzy flag)
	 */
	needsReview: boolean;
}

/**
 * What was read from a file
 */
export interface ReadTranslationFile
{
	/**
	 * The language the file says it holds, or null when it doesn't say
	 */
	language: string | null;

	translations: ReadTranslation[];
}

/**
 * Thrown when a file can't be read in its format
 */
export class TranslationFileError extends Error
{
	/**
	 * @param line The line the problem is on, from 1, or null when it isn't on one line
	 */
	constructor(readonly line: number | null)
	{
		super(((line === null) ? 'Not a translation file in this format' : `Not a translation file in this format: line ${line}`));
		this.name = 'TranslationFileError';
	}
}

/**
 * The key a piece of universe text has in a translation file, e.g. "area:7d1c...:name"
 *
 * @param ref The piece of text
 * @return The key
 */
export function universeTextKey(ref: UniverseTextRef): string
{
	return(`${ref.kind}:${ref.thingId}:${ref.field}`);
}

/**
 * The piece of universe text a key names
 *
 * @param key The key (universeTextKey())
 * @return The piece of text, or undefined for a key that names none
 */
export function parseUniverseTextKey(key: string): UniverseTextRef | undefined
{
	const first = key.indexOf(':');
	const last = key.lastIndexOf(':');
	const kind = UNIVERSE_TEXT_KINDS.find((each) => (each === key.slice(0, first)));
	const field = UNIVERSE_TEXT_FIELDS.find((each) => (each === key.slice(last + 1)));
	const thingId = key.slice(first + 1, last);

	if ((first < 0) || (last <= first) || (kind === undefined) || (field === undefined) || (thingId === ''))
	{
		return(undefined);
	}

	return({ kind, thingId, field });
}

/**
 * The format a file's name says it is in
 *
 * @param fileName The file's name
 * @return The format, or undefined for an extension no format has
 */
export function translationFileFormatOf(fileName: string): TranslationFileFormat | undefined
{
	const lower = fileName.toLowerCase();

	return(TRANSLATION_FILE_FORMATS.find((format) => TRANSLATION_FILE_EXTENSIONS[format].some((extension) => lower.endsWith(extension))));
}

/**
 * Writes one language of a universe's text as a file
 *
 * @param format The file's format
 * @param contents What it holds
 * @return The file's text
 */
export function writeTranslationFile(format: TranslationFileFormat, contents: TranslationFileContents): string
{
	switch (format)
	{
		case 'po':
			return(writePo(contents));
		case 'xliff':
			return(writeXliff(contents));
		case 'csv':
			return(writeCsv(contents));
		case 'json':
			return(writeJson(contents));
	}
}

/**
 * Reads the translations in a file
 *
 * @param format The file's format
 * @param text The file's text
 * @return The language it says it holds, and its translations
 * @throws TranslationFileError when it can't be read in the format
 */
export function readTranslationFile(format: TranslationFileFormat, text: string): ReadTranslationFile
{
	const withoutMark = (text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text);

	switch (format)
	{
		case 'po':
			return(readPo(withoutMark));
		case 'xliff':
			return(readXliff(withoutMark));
		case 'csv':
			return(readCsv(withoutMark));
		case 'json':
			return(readJson(withoutMark));
	}
}

/**
 * A PO string, its backslashes, quotes and control characters escaped
 *
 * @param text The text
 * @return The escaped text, without quotes
 */
function escapePo(text: string): string
{
	return(text
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\t/g, '\\t')
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n'));
}

/**
 * A PO keyword with its string: on one line, or as a line for each line of text that holds line breaks
 *
 * @param keyword The keyword, e.g. msgid
 * @param text The text
 * @return The lines
 */
function poField(keyword: string, text: string): string[]
{
	const pieces = text.split(/(?<=\n)/);

	if (pieces.length < 2)
	{
		return([`${keyword} "${escapePo(text)}"`]);
	}

	return([`${keyword} ""`, ...pieces.map((piece) => `"${escapePo(piece)}"`)]);
}

/**
 * Writes a PO file: a header naming the languages, then an entry for each piece of text, with where it
 * comes from and its note as comments for translators, and out-of-date translations marked fuzzy
 *
 * @param contents What it holds
 * @return The file's text
 */
function writePo(contents: TranslationFileContents): string
{
	const header = [
		`Project-Id-Version: ${contents.title}`,
		`Language: ${contents.language}`,
		`X-Source-Language: ${contents.sourceLanguage}`,
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset=UTF-8',
		'Content-Transfer-Encoding: 8bit'
	].map((line) => `${line}\n`).join('');
	const lines = ['msgid ""', ...poField('msgstr', header)];

	for (const entry of contents.entries)
	{
		lines.push('');
		lines.push(`#. ${entry.place}`);

		for (const noteLine of (entry.note?.split(/\r?\n/) ?? []))
		{
			lines.push(`#. ${noteLine}`);
		}

		if (entry.outOfDate && (entry.translation !== null))
		{
			lines.push('#, fuzzy');
		}

		lines.push(...poField('msgctxt', entry.id), ...poField('msgid', entry.source), ...poField('msgstr', (entry.translation ?? '')));
	}

	return(`${lines.join('\n')}\n`);
}

/**
 * A PO string's text
 *
 * @param quoted The string, in quotes
 * @param line The line it is on, for errors
 * @return The text, its escapes read
 */
function readPoString(quoted: string, line: number): string
{
	if (!/^"(?:[^"\\]|\\.)*"$/.test(quoted))
	{
		throw new TranslationFileError(line);
	}

	const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r' };

	return(quoted.slice(1, -1).replace(/\\(.)/g, (_match, character: string) => (escapes[character] ?? character)));
}

/**
 * Reads a PO file's entries. Obsolete entries (#~) and plural entries are left out, and the header's
 * Language names the language
 *
 * @param text The file's text
 * @return What it holds
 */
function readPo(text: string): ReadTranslationFile
{
	interface PoEntry
	{
		fields: Map<string, string>;
		fuzzy: boolean;
		last: string | undefined;
	}

	const translations: ReadTranslation[] = [];
	let language: string | null = null;
	let entry: PoEntry = { fields: new Map(), fuzzy: false, last: undefined };

	/**
	 * Takes the entry being read, when it is whole, and starts the next
	 */
	const finish = (): void =>
	{
		const { fields } = entry;
		const source = fields.get('msgid');
		const translation = fields.get('msgstr');

		if ((source !== undefined) && (translation !== undefined) && !fields.has('msgid_plural'))
		{
			const context = fields.get('msgctxt');

			if ((source === '') && (context === undefined))
			{
				language = (/^Language:\s*(\S+)\s*$/m.exec(translation)?.[1] ?? language);
			}
			else if (context !== undefined)
			{
				translations.push({
					id: context,
					source,
					translation: ((translation === '') ? null : translation),
					needsReview: entry.fuzzy
				});
			}
		}

		entry = { fields: new Map(), fuzzy: false, last: undefined };
	};

	text.split(/\r?\n/).forEach((raw, index) =>
	{
		const line = raw.trim();
		const lineNumber = index + 1;

		if ((line === '') || line.startsWith('#~'))
		{
			if (entry.fields.size > 0)
			{
				finish();
			}

			return;
		}

		if (line.startsWith('#'))
		{
			if (entry.fields.has('msgstr'))
			{
				finish();
			}

			if (line.startsWith('#,') && line.slice(2).split(',').some((flag) => (flag.trim() === 'fuzzy')))
			{
				entry.fuzzy = true;
			}

			return;
		}

		if (line.startsWith('"'))
		{
			if (entry.last === undefined)
			{
				throw new TranslationFileError(lineNumber);
			}

			entry.fields.set(entry.last, `${entry.fields.get(entry.last) ?? ''}${readPoString(line, lineNumber)}`);
			return;
		}

		const keyword = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(".*")$/.exec(line);

		if (!keyword)
		{
			throw new TranslationFileError(lineNumber);
		}

		const name = (keyword[1].startsWith('msgstr[') ? 'msgstr' : keyword[1]);

		// An entry may follow another without a blank line between them
		if (((name === 'msgctxt') || (name === 'msgid')) && entry.fields.has('msgstr'))
		{
			finish();
		}

		entry.fields.set(name, readPoString(keyword[2], lineNumber));
		entry.last = name;
	});

	finish();

	return({ language, translations });
}

/**
 * Text in XML, its markup characters escaped
 *
 * @param text The text
 * @return The escaped text, fit for an element or a quoted attribute
 */
function escapeXml(text: string): string
{
	return(text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;'));
}

/**
 * Writes an XLIFF 2.0 file: a unit for each piece of text, with where it comes from and its note as
 * notes, and its segment's state initial until it has an up-to-date translation
 *
 * @param contents What it holds
 * @return The file's text
 */
function writeXliff(contents: TranslationFileContents): string
{
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="${escapeXml(contents.sourceLanguage)}" trgLang="${escapeXml(contents.language)}">`,
		`\t<file id="universe" original="${escapeXml(contents.title)}">`
	];

	for (const entry of contents.entries)
	{
		const translated = ((entry.translation !== null) && !entry.outOfDate);

		lines.push(`\t\t<unit id="${escapeXml(entry.id)}" xml:space="preserve">`);
		lines.push('\t\t\t<notes>');
		lines.push(`\t\t\t\t<note category="location">${escapeXml(entry.place)}</note>`);

		if (entry.note !== null)
		{
			lines.push(`\t\t\t\t<note category="description">${escapeXml(entry.note)}</note>`);
		}

		lines.push('\t\t\t</notes>');
		lines.push(`\t\t\t<segment state="${(translated ? 'translated' : 'initial')}">`);
		lines.push(`\t\t\t\t<source>${escapeXml(entry.source)}</source>`);

		if (entry.translation !== null)
		{
			lines.push(`\t\t\t\t<target>${escapeXml(entry.translation)}</target>`);
		}

		lines.push('\t\t\t</segment>');
		lines.push('\t\t</unit>');
	}

	lines.push('\t</file>', '</xliff>');

	return(`${lines.join('\n')}\n`);
}

/**
 * An element of an XML document
 */
interface XmlElement
{
	/**
	 * Its name without a namespace prefix
	 */
	name: string;

	attributes: Map<string, string>;
	children: (XmlElement | string)[];
}

/**
 * The text of XML character data, its entities read
 *
 * @param text The character data
 * @param line The line it starts on, for errors
 * @return The text
 */
function decodeXml(text: string, line: number): string
{
	const named: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };

	return(text.replace(/&([^;]*);?/g, (match, entity: string) =>
	{
		const code = (/^#x([0-9a-f]+)$/i.exec(entity)?.[1] ?? null);
		const decimal = (/^#(\d+)$/.exec(entity)?.[1] ?? null);

		if (!match.endsWith(';'))
		{
			throw new TranslationFileError(line);
		}

		if (code !== null)
		{
			return(String.fromCodePoint(parseInt(code, 16)));
		}

		if (decimal !== null)
		{
			return(String.fromCodePoint(Number(decimal)));
		}

		const character = named[entity];

		if (character === undefined)
		{
			throw new TranslationFileError(line);
		}

		return(character);
	}));
}

/**
 * Reads an XML document into its elements. Comments and processing instructions are skipped, and a
 * document type declaration is refused, so no entity is ever defined by the file
 *
 * @param text The document
 * @return Its root element
 */
function parseXml(text: string): XmlElement
{
	const root: XmlElement = { name: '', attributes: new Map(), children: [] };
	const open: XmlElement[] = [root];
	let position = 0;

	/**
	 * The line a position in the document is on
	 *
	 * @param at The position
	 * @return The line, from 1
	 */
	const lineAt = (at: number): number => (text.slice(0, at).split('\n').length);

	/**
	 * The position just after the next occurrence of some text, or an error when there is none
	 *
	 * @param end The text
	 * @return The position after it
	 */
	const after = (end: string): number =>
	{
		const found = text.indexOf(end, position);

		if (found < 0)
		{
			throw new TranslationFileError(lineAt(position));
		}

		return(found + end.length);
	};

	while (position < text.length)
	{
		const current = open[open.length - 1];

		if (text.startsWith('<?', position))
		{
			position = after('?>');
		}
		else if (text.startsWith('<!--', position))
		{
			position = after('-->');
		}
		else if (text.startsWith('<![CDATA[', position))
		{
			const end = after(']]>');

			current.children.push(text.slice(position + 9, end - 3));
			position = end;
		}
		else if (text.startsWith('<!', position))
		{
			throw new TranslationFileError(lineAt(position));
		}
		else if (text.startsWith('</', position))
		{
			const end = after('>');
			const name = text.slice(position + 2, end - 1).trim().split(':').pop();

			if ((open.length < 2) || (name !== current.name))
			{
				throw new TranslationFileError(lineAt(position));
			}

			open.pop();
			position = end;
		}
		else if (text.startsWith('<', position))
		{
			const end = after('>');
			const inside = text.slice(position + 1, end - 1);
			const selfClosing = inside.endsWith('/');
			const body = (selfClosing ? inside.slice(0, -1) : inside);
			const nameMatch = /^\s*([^\s/>]+)/.exec(body);

			if (!nameMatch)
			{
				throw new TranslationFileError(lineAt(position));
			}

			const element: XmlElement = {
				name: (nameMatch[1].split(':').pop() ?? ''),
				attributes: new Map(),
				children: []
			};

			for (const attribute of body.slice(nameMatch[0].length).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
			{
				element.attributes.set((attribute[1].split(':').pop() ?? ''), decodeXml((attribute[2] ?? attribute[3]), lineAt(position)));
			}

			current.children.push(element);

			if (!selfClosing)
			{
				open.push(element);
			}

			position = end;
		}
		else
		{
			const next = text.indexOf('<', position);
			const end = ((next < 0) ? text.length : next);

			current.children.push(decodeXml(text.slice(position, end), lineAt(position)));
			position = end;
		}
	}

	const element = root.children.find((child): child is XmlElement => (typeof child !== 'string'));

	if ((open.length > 1) || !element)
	{
		throw new TranslationFileError(null);
	}

	return(element);
}

/**
 * The elements of a name inside an element, at any depth
 *
 * @param element The element
 * @param name The name to find
 * @return The elements, in document order
 */
function findElements(element: XmlElement, name: string): XmlElement[]
{
	return(element.children.flatMap((child) => ((typeof child === 'string')
		? []
		: ((child.name === name) ? [child] : findElements(child, name)))));
}

/**
 * An element's text, inline elements' text included
 *
 * @param element The element
 * @return The text
 */
function textOf(element: XmlElement): string
{
	return(element.children.map((child) => ((typeof child === 'string') ? child : textOf(child))).join(''));
}

/**
 * Reads an XLIFF 2.0 file's units. A unit's segments are joined, and one without a target has no
 * translation. The trgLang attribute names the language
 *
 * @param text The file's text
 * @return What it holds
 */
function readXliff(text: string): ReadTranslationFile
{
	const document = parseXml(text);

	if (document.name !== 'xliff')
	{
		throw new TranslationFileError(null);
	}

	return({
		language: (document.attributes.get('trgLang') ?? null),
		translations: findElements(document, 'unit').map((unit) =>
		{
			const segments = findElements(unit, 'segment');
			const targets = segments.flatMap((segment) => findElements(segment, 'target'));
			const translation = targets.map(textOf).join('');

			return({
				id: (unit.attributes.get('id') ?? ''),
				source: segments.map((segment) => findElements(segment, 'source').map(textOf).join('')).join(''),
				translation: ((translation === '') ? null : translation),
				needsReview: false
			});
		})
	});
}

/**
 * The columns of a CSV file, in order: the text's key, where it comes from, the note, the source text,
 * the translation, and yes for an out-of-date translation
 */
const CSV_COLUMNS = ['id', 'from', 'note', 'source', 'translation', 'outOfDate'] as const;

/**
 * The start of text a spreadsheet would run as a formula (=, +, -, @, a tab or a carriage return), after
 * any apostrophes in front of it. A CSV file puts one more apostrophe in front of such text, which
 * spreadsheets show as text, and reading the file takes it off again
 */
const CSV_FORMULA_START = /^'*[=+\-@\t\r]/;

/**
 * A CSV field, in quotes, its quotes doubled, with an apostrophe in front of text a spreadsheet would
 * run as a formula
 *
 * @param text The field's text
 * @return The field
 */
function csvField(text: string): string
{
	const safe = (CSV_FORMULA_START.test(text) ? `'${text}` : text);

	return(`"${safe.replace(/"/g, '""')}"`);
}

/**
 * A CSV field's text, without the apostrophe csvField() puts in front of text a spreadsheet would run as
 * a formula
 *
 * @param field The field
 * @return The text
 */
function csvText(field: string): string
{
	return((field.startsWith('\'') && CSV_FORMULA_START.test(field)) ? field.slice(1) : field);
}

/**
 * Writes a CSV file, with a byte order mark so spreadsheets read it as UTF-8, a heading row, and a row
 * for each piece of text
 *
 * @param contents What it holds
 * @return The file's text
 */
function writeCsv(contents: TranslationFileContents): string
{
	const rows = contents.entries.map((entry) => [entry.id, entry.place, (entry.note ?? ''), entry.source, (entry.translation ?? ''), ((entry.outOfDate && (entry.translation !== null)) ? 'yes' : '')]);

	return(`${BYTE_ORDER_MARK}${[[...CSV_COLUMNS], ...rows].map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`);
}

/**
 * Reads a CSV file's rows (RFC 4180: fields in quotes may hold commas, quotes doubled and line breaks)
 *
 * @param text The file's text
 * @return The rows' fields
 */
function parseCsv(text: string): string[][]
{
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	let line = 1;

	for (let index = 0; index < text.length; index++)
	{
		const character = text[index];

		if (character === '\n')
		{
			line++;
		}

		if (quoted)
		{
			if ((character === '"') && (text[index + 1] === '"'))
			{
				field += '"';
				index++;
			}
			else if (character === '"')
			{
				quoted = false;
			}
			else
			{
				field += character;
			}
		}
		else if ((character === '"') && (field === ''))
		{
			quoted = true;
		}
		else if (character === ',')
		{
			row.push(field);
			field = '';
		}
		else if ((character === '\n') || (character === '\r'))
		{
			if ((character === '\r') && (text[index + 1] === '\n'))
			{
				index++;
				line++;
			}

			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		}
		else
		{
			field += character;
		}
	}

	if (quoted)
	{
		throw new TranslationFileError(line);
	}

	if ((field !== '') || (row.length > 0))
	{
		row.push(field);
		rows.push(row);
	}

	return(rows.filter((each) => each.some((value) => (value !== ''))));
}

/**
 * Reads a CSV file's rows by the names in its heading row, which must have id and translation columns;
 * a source column gives the text each translation was made from
 *
 * @param text The file's text
 * @return What it holds; a CSV file doesn't name its language
 */
function readCsv(text: string): ReadTranslationFile
{
	const [heading, ...rows] = parseCsv(text);
	const columns = (heading ?? []).map((name) => name.trim().toLowerCase());
	const idColumn = columns.indexOf('id');
	const translationColumn = columns.indexOf('translation');
	const sourceColumn = columns.indexOf('source');

	if ((idColumn < 0) || (translationColumn < 0))
	{
		throw new TranslationFileError(1);
	}

	return({
		language: null,
		translations: rows.map((row) => ({
			id: csvText(row[idColumn] ?? ''),
			source: ((sourceColumn < 0) ? null : csvText(row[sourceColumn] ?? '')),
			translation: (csvText(row[translationColumn] ?? '') || null),
			needsReview: false
		}))
	});
}

/**
 * Writes a JSON file: the universe's name, its languages, and each piece of text by its key
 *
 * @param contents What it holds
 * @return The file's text
 */
function writeJson(contents: TranslationFileContents): string
{
	const text = Object.fromEntries(contents.entries.map((entry) => [entry.id, {
		from: entry.place,
		note: entry.note,
		source: entry.source,
		translation: entry.translation,
		outOfDate: (entry.outOfDate && (entry.translation !== null))
	}]));
	const file = {
		universe: contents.title,
		sourceLanguage: contents.sourceLanguage,
		language: contents.language,
		text
	};

	return(`${JSON.stringify(file, null, '\t')}\n`);
}

/**
 * Reads a JSON file: an object holding text, an object of entries by key, each with a translation
 * (a string or null) and optionally the source text; and optionally the language
 *
 * @param text The file's text
 * @return What it holds
 */
function readJson(text: string): ReadTranslationFile
{
	let file: unknown;

	try
	{
		file = JSON.parse(text);
	}
	catch
	{
		throw new TranslationFileError(null);
	}

	/**
	 * Whether a value is an object of named values
	 *
	 * @param value The value
	 * @return True for one
	 */
	const isRecord = (value: unknown): value is Record<string, unknown> => ((typeof value === 'object') && (value !== null) && !Array.isArray(value));

	if (!isRecord(file) || !isRecord(file.text))
	{
		throw new TranslationFileError(null);
	}

	const translations = Object.entries(file.text).map(([id, entry]): ReadTranslation =>
	{
		if (!isRecord(entry) || !((typeof entry.translation === 'string') || (entry.translation === null) || (entry.translation === undefined)))
		{
			throw new TranslationFileError(null);
		}

		return({
			id,
			source: ((typeof entry.source === 'string') ? entry.source : null),
			translation: (((typeof entry.translation === 'string') && (entry.translation !== '')) ? entry.translation : null),
			needsReview: false
		});
	});

	return({
		language: ((typeof file.language === 'string') ? file.language : null),
		translations
	});
}
