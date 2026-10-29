/**
 * Gathers the messages players read into shared/locales/en.json, the catalog translators work from
 * (see shared/src/localization.ts), and makes the pseudo-language's catalog from it. Used by the
 * command in messages.ts and, while developing, by the client's Vite dev server
 *
 * Messages come from client/src, server/src and shared/src, and from data-message attributes in the
 * client's pages and the partials they include:
 *
 * - data-message="<id>" on an element makes its text a message. Children with data-argument="<name>"
 *   become arguments ("Playing as {name}"); other children (such as an input inside a label) stay
 *   where they are and aren't part of it
 * - data-message-<attribute>="<id>" makes an attribute's value a message, e.g. data-message-placeholder
 * - data-translation-context, or data-translation-context-<attribute>, describes it for translators,
 *   and becomes the message's description in the catalog
 * - translate="no" marks text that is the same in every language, such as a name, often as an argument
 *
 * Every message needs a description, an ID can't have two different English texts, and text with
 * letters in a page must be part of a message or inside translate="no".
 *
 * Paths are relative to the repository's root, which callers pass in
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { parse } from '@formatjs/icu-messageformat-parser';
import { PSEUDO_LOCALE, pseudoMessage, SOURCE_LOCALE, type TranslationFile } from '@multiverse-kiln/shared';

/**
 * Folders whose TypeScript files are searched for defineMessages() calls
 */
export const SOURCE_FOLDERS = ['client/src', 'server/src', 'shared/src'];

/**
 * The client's pages
 */
export const PAGES = ['client/index.html', 'client/universe.html', 'client/game.html', 'client/edit.html', 'client/character.html', 'client/license.html', 'client/privacy.html', 'client/admin.html', 'client/login.html'];

/**
 * The folder of HTML pieces the pages share, which a page includes with a comment such as
 * <!-- include footer.html --> (see the client's vite.config.ts)
 */
export const PARTIALS_FOLDER = 'client/partials';

/**
 * Where the English catalog is written
 */
export const CATALOG_FILE = 'shared/locales/en.json';

/**
 * Where the pseudo-language's catalog is written. It is made from the English catalog while
 * developing, so it isn't committed
 */
export const PSEUDO_CATALOG_FILE = `shared/locales/${PSEUDO_LOCALE}.json`;

/**
 * Attributes that players read, so their values must be messages
 */
const READABLE_ATTRIBUTES = ['alt', 'aria-label', 'placeholder', 'title'];

/**
 * Elements whose text isn't shown as text
 */
const SKIPPED_ELEMENTS = new Set(['script', 'style']);

/**
 * Elements that have no closing tag
 */
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * Character references the pages use, by name
 */
const NAMED_CHARACTERS: Record<string, string> = {
	amp: '&',
	bull: '•',
	copy: '©',
	gt: '>',
	lt: '<',
	middot: '·',
	nbsp: ' ',
	quot: '"'
};

/**
 * Message IDs: dot-separated words, at least two
 */
const ID_PATTERN = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;

/**
 * One message as the catalog stores it
 */
export interface CatalogEntry
{
	defaultMessage: string;
	description: string;
}

/**
 * One message found in the code or a page, and where
 */
interface FoundMessage extends CatalogEntry
{
	id: string;
	location: string;
}

/**
 * An element of a page, as the minimal parser below reads it
 */
interface PageElement
{
	kind: 'element';
	name: string;
	attributes: Map<string, string>;
	children: PageNode[];
	line: number;
}

/**
 * Text in a page
 */
interface PageText
{
	kind: 'text';
	text: string;
	line: number;
}

type PageNode = PageElement | PageText;

/**
 * What extracting the messages found
 */
export interface Extraction
{
	/**
	 * The English catalog, by ID in order
	 */
	catalog: Record<string, CatalogEntry>;

	/**
	 * A description of each problem with a message, with where it is
	 */
	problems: string[];
}

/**
 * Finds every message in the code and pages, and checks them
 *
 * @param root The repository's root folder
 * @return The English catalog, and any problems
 */
export function extractMessages(root: string): Extraction
{
	const problems: string[] = [];
	const found: FoundMessage[] = [];

	for (const folder of SOURCE_FOLDERS)
	{
		for (const file of listTypeScriptFiles(path.join(root, folder)))
		{
			findCodeMessages(file, root, found, problems);
		}
	}

	const partials = fs.readdirSync(path.join(root, PARTIALS_FOLDER))
		.filter((name) => name.endsWith('.html'))
		.map((name) => path.join(PARTIALS_FOLDER, name));

	for (const page of [...PAGES, ...partials])
	{
		findPageMessages(path.join(root, page), root, found, problems);
	}

	return({ catalog: buildCatalog(found, problems), problems });
}

/**
 * The pseudo-language's file: every English message accented, lengthened and bracketed
 *
 * @param catalog The English catalog
 * @return Each message's pseudo-language text and its English, by ID
 */
export function pseudoCatalog(catalog: Record<string, CatalogEntry>): TranslationFile
{
	return(Object.fromEntries(Object.entries(catalog).map(([id, entry]) => [id, {
		message: pseudoMessage(entry.defaultMessage),
		source: entry.defaultMessage
	}])));
}

/**
 * The committed translations in shared/locales: every language's file except English's and the
 * pseudo-language's
 *
 * @param root The repository's root folder
 * @return Each language's file, by its language tag
 */
export function readTranslations(root: string): Map<string, TranslationFile>
{
	const folder = path.join(root, path.dirname(CATALOG_FILE));
	const translations = new Map<string, TranslationFile>();

	for (const name of fs.readdirSync(folder))
	{
		const locale = name.replace(/\.json$/, '');

		if (name.endsWith('.json') && (locale !== SOURCE_LOCALE) && (locale !== PSEUDO_LOCALE))
		{
			translations.set(locale, JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')) as TranslationFile);
		}
	}

	return(translations);
}

/**
 * A catalog as its file holds it: JSON indented with tabs, with Windows line endings like the rest of
 * the repository
 *
 * @param catalog The catalog
 * @return The file's text
 */
export function catalogText(catalog: object): string
{
	return(`${JSON.stringify(catalog, null, '\t').replaceAll('\n', '\r\n')}\r\n`);
}

/**
 * Writes a catalog file unless it already holds that text
 *
 * @param root The repository's root folder
 * @param file The file's path from the root, e.g. CATALOG_FILE
 * @param text The file's text, from catalogText()
 * @return Whether the file changed
 */
export function writeCatalog(root: string, file: string, text: string): boolean
{
	const fullPath = path.join(root, file);

	if (fs.existsSync(fullPath) && (fs.readFileSync(fullPath, 'utf8') === text))
	{
		return(false);
	}

	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, text);

	return(true);
}

/**
 * Every TypeScript file in a folder and the folders inside it
 *
 * @param folder The folder
 * @return The files' paths
 */
function listTypeScriptFiles(folder: string): string[]
{
	const files: string[] = [];

	for (const entry of fs.readdirSync(folder, { withFileTypes: true }))
	{
		const entryPath = path.join(folder, entry.name);

		if (entry.isDirectory())
		{
			files.push(...listTypeScriptFiles(entryPath));
		}
		else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
		{
			files.push(entryPath);
		}
	}

	return(files);
}

/**
 * Finds the messages declared in a TypeScript file
 *
 * A message is an object literal with a defaultMessage given as a string literal, wherever it is: where
 * it's used, or in a defineMessages() call. Its id and description must be string literals too, so the
 * extractor can read it without running the code
 *
 * @param file The file's path
 * @param root The repository's root folder, which locations are given from
 * @param found Where to add the messages
 * @param problems Where to add problems
 */
function findCodeMessages(file: string, root: string, found: FoundMessage[], problems: string[]): void
{
	const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

	/**
	 * Where a node is, as "path:line"
	 *
	 * @param node The node
	 * @return The location
	 */
	function locate(node: ts.Node): string
	{
		return(`${relativePath(file, root)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
	}

	/**
	 * Looks for messages in a node and the nodes inside it
	 *
	 * @param node The node
	 */
	function visit(node: ts.Node): void
	{
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 'defineMessages'))
		{
			const [messages] = node.arguments;

			if ((messages === undefined) || !ts.isObjectLiteralExpression(messages))
			{
				problems.push(`${locate(node)}: defineMessages() must be given an object literal`);
			}
			else
			{
				for (const property of messages.properties)
				{
					if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer) || !hasLiteralDefaultMessage(property.initializer))
					{
						problems.push(`${locate(property)}: each message must be an object literal with a defaultMessage string`);
					}
				}
			}
		}
		else if (ts.isObjectLiteralExpression(node) && hasLiteralDefaultMessage(node))
		{
			readDescriptor(node, locate(node), found, problems);
		}

		ts.forEachChild(node, visit);
	}

	visit(source);
}

/**
 * Whether an object literal has a defaultMessage given as a string literal
 *
 * @param node The object literal
 * @return Whether it does
 */
function hasLiteralDefaultMessage(node: ts.ObjectLiteralExpression): boolean
{
	return(node.properties.some((property) => (ts.isPropertyAssignment(property) && (propertyName(property) === 'defaultMessage') && ts.isStringLiteralLike(property.initializer))));
}

/**
 * A property's name, when it is written as a plain name or a string
 *
 * @param property The property
 * @return The name, or undefined for a computed name
 */
function propertyName(property: ts.PropertyAssignment): string | undefined
{
	return(((ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined));
}

/**
 * Reads one message from its object literal in a defineMessages() call
 *
 * @param node The object literal
 * @param location Where it is
 * @param found Where to add the message
 * @param problems Where to add problems
 */
function readDescriptor(node: ts.ObjectLiteralExpression, location: string, found: FoundMessage[], problems: string[]): void
{
	const fields = new Map<string, string>();

	for (const property of node.properties)
	{
		const name = (ts.isPropertyAssignment(property) ? propertyName(property) : undefined);

		if ((name === undefined) || !['id', 'defaultMessage', 'description'].includes(name) || !ts.isPropertyAssignment(property))
		{
			problems.push(`${location}: a message has only id, defaultMessage and description`);
			continue;
		}

		if (!ts.isStringLiteralLike(property.initializer))
		{
			problems.push(`${location}: ${name} must be a string literal`);
			continue;
		}

		fields.set(name, property.initializer.text);
	}

	const id = fields.get('id');
	const defaultMessage = fields.get('defaultMessage');
	const description = fields.get('description');

	if ((id === undefined) || (defaultMessage === undefined) || (description === undefined))
	{
		problems.push(`${location}: a message needs an id, a defaultMessage and a description`);
		return;
	}

	found.push({ id, defaultMessage, description, location });
}

/**
 * Finds the messages marked in a page, and text or attributes players read that aren't marked
 *
 * @param file The page's path
 * @param root The repository's root folder, which locations are given from
 * @param found Where to add the messages
 * @param problems Where to add problems
 */
function findPageMessages(file: string, root: string, found: FoundMessage[], problems: string[]): void
{
	const page = relativePath(file, root);

	/**
	 * Looks for messages in an element and the elements inside it. Only an element's own text belongs to
	 * its message, so each child marks its own
	 *
	 * @param element The element
	 */
	function visit(element: PageElement): void
	{
		const location = `${page}:${element.line}`;
		const id = element.attributes.get('data-message');

		if (id !== undefined)
		{
			const text = elementMessage(element, location, problems);

			if (text !== undefined)
			{
				found.push({ id, defaultMessage: text, description: (element.attributes.get('data-translation-context') ?? ''), location });
			}
		}

		for (const [name, value] of element.attributes)
		{
			const attribute = (name.startsWith('data-message-') ? name.slice('data-message-'.length) : undefined);

			if (attribute !== undefined)
			{
				const attributeText = element.attributes.get(attribute);

				if (attributeText === undefined)
				{
					problems.push(`${location}: ${name} names an attribute the element doesn't have`);
				}
				else
				{
					found.push({ id: value, defaultMessage: collapseWhitespace(attributeText), description: (element.attributes.get(`data-translation-context-${attribute}`) ?? ''), location });
				}
			}
			else if (READABLE_ATTRIBUTES.includes(name) && hasLetters(value) && !element.attributes.has(`data-message-${name}`))
			{
				problems.push(`${location}: the ${name} attribute "${value}" needs data-message-${name}`);
			}
		}

		for (const child of element.children)
		{
			if (child.kind === 'element')
			{
				// translate="no" marks text that stays the same in every language, such as a name
				if (!SKIPPED_ELEMENTS.has(child.name) && (child.attributes.get('translate') !== 'no'))
				{
					visit(child);
				}
			}
			else if (hasLetters(child.text) && (id === undefined))
			{
				problems.push(`${page}:${child.line}: "${collapseWhitespace(child.text)}" needs a data-message on its element, or translate="no" if it is the same in every language`);
			}
		}
	}

	for (const node of parsePage(fs.readFileSync(file, 'utf8')))
	{
		if ((node.kind === 'element') && (node.attributes.get('translate') !== 'no'))
		{
			visit(node);
		}
	}
}

/**
 * The message an element with data-message holds: its children from its first text or argument to its
 * last, where each child with data-argument is an argument, and the whitespace between them is kept.
 * Children before or after, such as an input inside a label, aren't part of it. Must match
 * localizeText() in client/src/localization.ts
 *
 * @param element The element
 * @param location Where it is
 * @param problems Where to add problems
 * @return The message, or undefined when it has a problem
 */
function elementMessage(element: PageElement, location: string, problems: string[]): string | undefined
{
	const parts = element.children.filter((child) => ((child.kind === 'text') ? (child.text.trim() !== '') : child.attributes.has('data-argument')));
	const first = parts[0];
	const last = parts[parts.length - 1];

	if ((first === undefined) || (last === undefined))
	{
		problems.push(`${location}: the element has data-message but no text`);
		return(undefined);
	}

	let text = '';

	for (const child of element.children.slice(element.children.indexOf(first), element.children.indexOf(last) + 1))
	{
		if (child.kind === 'text')
		{
			text += child.text;
		}
		else if (child.attributes.has('data-argument'))
		{
			text += `{${child.attributes.get('data-argument')}}`;
		}
		else
		{
			problems.push(`${location}: the message's text must not be split by a child without data-argument`);
			return(undefined);
		}
	}

	return(collapseWhitespace(text));
}

/**
 * Checks the messages found and puts them in the catalog's order
 *
 * @param found The messages
 * @param problems Where to add problems
 * @return The catalog, by ID
 */
function buildCatalog(found: FoundMessage[], problems: string[]): Record<string, CatalogEntry>
{
	const byId = new Map<string, FoundMessage>();

	for (const message of found)
	{
		if (!ID_PATTERN.test(message.id))
		{
			problems.push(`${message.location}: "${message.id}" isn't a message ID: use dot-separated words, e.g. editor.tile.save`);
		}

		if (message.description.trim() === '')
		{
			problems.push(`${message.location}: ${message.id} needs a description for translators`);
		}

		try
		{
			parse(message.defaultMessage);
		}
		catch (error)
		{
			problems.push(`${message.location}: ${message.id} isn't a valid ICU message (${(error instanceof Error) ? error.message : String(error)})`);
		}

		const earlier = byId.get(message.id);

		if (earlier === undefined)
		{
			byId.set(message.id, message);
		}
		else if ((earlier.defaultMessage !== message.defaultMessage) || (earlier.description !== message.description))
		{
			problems.push(`${message.location}: ${message.id} is also at ${earlier.location} with a different text or description; give each its own ID`);
		}
	}

	const catalog: Record<string, CatalogEntry> = {};

	for (const id of [...byId.keys()].sort())
	{
		const message = byId.get(id);

		if (message !== undefined)
		{
			catalog[id] = {
				defaultMessage: message.defaultMessage,
				description: message.description
			};
		}
	}

	return(catalog);
}

/**
 * Reads a page into elements and text. Handles the plain HTML the client's pages use: double-quoted
 * attributes, comments, a doctype, and void elements
 *
 * @param html The page
 * @return The page's top-level nodes
 */
function parsePage(html: string): PageNode[]
{
	const root: PageElement = {
		kind: 'element',
		name: '#root',
		attributes: new Map(),
		children: [],
		line: 1
	};
	const open: PageElement[] = [root];
	const tokens = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>|[^<]+/gi;
	let line = 1;

	for (const match of html.matchAll(tokens))
	{
		const [token, closingName, openingName, attributeText, selfClosing] = match;
		const parent = open[open.length - 1];

		if (closingName !== undefined)
		{
			if (parent.name !== closingName.toLowerCase())
			{
				throw new Error(`Line ${line}: </${closingName}> closes <${parent.name}>`);
			}

			open.pop();
		}
		else if (openingName !== undefined)
		{
			const element: PageElement = {
				kind: 'element',
				name: openingName.toLowerCase(),
				attributes: parseAttributes(attributeText),
				children: [],
				line
			};

			parent.children.push(element);

			if ((selfClosing === '') && !VOID_ELEMENTS.has(element.name))
			{
				open.push(element);
			}
		}
		else if (!token.startsWith('<'))
		{
			parent.children.push({ kind: 'text', text: decodeCharacters(token, line), line });
		}

		line += (token.match(/\n/g)?.length ?? 0);
	}

	if (open.length > 1)
	{
		throw new Error(`<${open[open.length - 1].name}> is never closed`);
	}

	return(root.children);
}

/**
 * Reads an element's attributes
 *
 * @param text The attributes as written in the tag
 * @return The attributes' values by name, with character references decoded
 */
function parseAttributes(text: string): Map<string, string>
{
	const attributes = new Map<string, string>();

	for (const match of text.matchAll(/([^\s=/>]+)(?:\s*=\s*"([^"]*)")?/g))
	{
		attributes.set(match[1].toLowerCase(), decodeCharacters(match[2] ?? '', 0));
	}

	return(attributes);
}

/**
 * Decodes character references, e.g. &bull;
 *
 * @param text The text as written in the page
 * @param line Where it is, for the error about an unknown reference
 * @return The text as the browser shows it
 */
function decodeCharacters(text: string, line: number): string
{
	return(text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (_reference, name: string) =>
	{
		if (name.startsWith('#x') || name.startsWith('#X'))
		{
			return(String.fromCodePoint(parseInt(name.slice(2), 16)));
		}

		if (name.startsWith('#'))
		{
			return(String.fromCodePoint(parseInt(name.slice(1), 10)));
		}

		const character = NAMED_CHARACTERS[name];

		if (character === undefined)
		{
			throw new Error(`Line ${line}: add &${name}; to NAMED_CHARACTERS in shared/scripts/extractMessages.ts`);
		}

		return(character);
	}));
}

/**
 * A file's path from the repository's root, with forward slashes on every system
 *
 * @param file The file's full path
 * @param root The repository's root folder
 * @return The relative path
 */
function relativePath(file: string, root: string): string
{
	return(path.relative(root, file).split(path.sep).join('/'));
}

/**
 * Text with each run of whitespace made one space, and none at either end
 *
 * @param text The text
 * @return The collapsed text
 */
function collapseWhitespace(text: string): string
{
	return(text.replace(/\s+/g, ' ').trim());
}

/**
 * Whether text has letters, so a player would read it
 *
 * @param text The text
 * @return Whether it does
 */
function hasLetters(text: string): boolean
{
	return(/\p{L}/u.test(text));
}
