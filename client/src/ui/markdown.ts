import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Elements a rendered description may contain: text formatting, lists, tables and links. No images,
 * forms, media or styles, so a description can't load anything from elsewhere or imitate the page's controls
 */
const ALLOWED_TAGS = [
	'a',
	'blockquote',
	'br',
	'code',
	'del',
	'em',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'li',
	'ol',
	'p',
	'pre',
	'strong',
	'table',
	'tbody',
	'td',
	'th',
	'thead',
	'tr',
	'ul'
];

/**
 * Attributes those elements may keep
 */
const ALLOWED_ATTRIBUTES = [
	'href',
	'title',
	'align'
];

/**
 * Links may only go to web pages or email addresses
 */
const ALLOWED_LINK = /^(?:https?:|mailto:)/i;

const purifier = DOMPurify(window);

// Links in a description open in a new tab and don't tell the other site where they came from
purifier.addHook('afterSanitizeAttributes', (node) =>
{
	if (node instanceof HTMLAnchorElement)
	{
		node.target = '_blank';
		node.rel = 'noopener noreferrer nofollow';
	}
});

/**
 * Shows Markdown in an element, as sanitized HTML
 *
 * Users write descriptions, so the HTML marked produces is never trusted: DOMPurify keeps only the
 * elements and attributes listed above and drops links to anything but web pages and email
 *
 * @param element The element to fill; whatever it held is replaced
 * @param markdown The Markdown
 */
export function showMarkdown(element: HTMLElement, markdown: string): void
{
	const html = marked.parse(markdown, { async: false, gfm: true });
	const fragment = purifier.sanitize(html, {
		ALLOWED_TAGS,
		ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
		ALLOWED_URI_REGEXP: ALLOWED_LINK,
		RETURN_DOM_FRAGMENT: true
	});

	element.replaceChildren(fragment);
}
