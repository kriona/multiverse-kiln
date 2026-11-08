/**
 * How every email the site sends is laid out: a greeting by the recipient's name, its paragraphs, an
 * optional code and link, and a footer linking to the site (SITE_URL), as HTML with a plain text part
 */
import { SITE_NAME, type Translator } from '@multiverse-kiln/shared';

import { siteUrl } from '../siteUrl.js';
import type { EmailContent } from './mailer.js';

/**
 * A link to one of the site's pages, for what the email asks its reader to do
 */
export interface EmailAction
{
	label: string;
	url: string;
}

/**
 * What an email says, before it is laid out
 */
export interface EmailParts
{
	subject: string;

	/**
	 * The recipient's display name, which the email greets them by, or null when it isn't known, such
	 * as for the code that creates their account
	 */
	recipientName: string | null;

	paragraphs: string[];

	/**
	 * An email code, shown large after the first paragraph
	 */
	code?: string;

	/**
	 * A link shown as a button after the paragraphs
	 */
	action?: EmailAction;
}

/**
 * Characters that mean something in HTML, and how to write them as text
 */
const HTML_ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	'\'': '&#39;'
};

/**
 * Writes text so HTML shows it as it is
 *
 * @param text The text
 * @return The text with HTML's special characters escaped
 */
function escapeHtml(text: string): string
{
	return(text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]));
}

/**
 * The line an email starts with, greeting its recipient
 *
 * @param translator The recipient's language
 * @param name The recipient's display name, or null when it isn't known
 * @return The greeting
 */
function greeting(translator: Translator, name: string | null): string
{
	if (name === null)
	{
		return(translator.format({
			id: 'email.greetingNoName',
			defaultMessage: 'Hi,',
			description: 'First line of an email whose recipient\'s name isn\'t known, such as the one with the code for creating an account'
		}));
	}

	return(translator.format({
		id: 'email.greeting',
		defaultMessage: 'Hi {name},',
		description: 'First line of every email the site sends to a player; {name} is the name they chose to be shown by'
	}, {
		name
	}));
}

/**
 * Lays an email out as plain text and HTML
 *
 * @param translator The recipient's language
 * @param parts What the email says
 * @return The email's subject, text and HTML
 */
export function layOut(translator: Translator, parts: EmailParts): EmailContent
{
	const hello = greeting(translator, parts.recipientName);
	const [first, ...rest] = parts.paragraphs;
	const site = siteUrl();
	const footer = translator.format({
		id: 'email.footer',
		defaultMessage: 'This email was sent by {siteName}:',
		description: 'At the end of every email the site sends, followed by the site\'s address on a line of its own; {siteName} is the site\'s name'
	}, {
		siteName: SITE_NAME
	});
	const action = parts.action;
	const textBlocks = [
		hello,
		first,
		...((parts.code !== undefined) ? [parts.code] : []),
		...rest,
		...(action ? [`${action.label}:\r\n${action.url}`] : []),
		`${footer}\r\n${site}`
	];
	const paragraphHtml = (paragraph: string): string => `<p style="margin: 0 0 16px;">${escapeHtml(paragraph)}</p>`;
	const codeHtml = ((parts.code !== undefined)
		? `<p style="margin: 0 0 16px; font-family: Consolas, Menlo, monospace; font-size: 32px; font-weight: bold; letter-spacing: 6px;">${escapeHtml(parts.code)}</p>`
		: '');
	const actionHtml = (action
		? `<p style="margin: 24px 0;"><a href="${escapeHtml(action.url)}" style="display: inline-block; padding: 10px 20px; border-radius: 4px; background: #2e7d32; color: #ffffff; font-weight: bold; text-decoration: none;">${escapeHtml(action.label)}</a></p>`
		: '');
	const footerHtml = `<p style="margin: 32px 0 0; font-size: 13px; color: #666666;">${escapeHtml(footer)}<br><a href="${escapeHtml(site)}" style="color: #666666;">${escapeHtml(site)}</a></p>`;
	const html = [
		'<!doctype html>',
		`<html lang="${escapeHtml(translator.locale)}">`,
		'<head>',
		'<meta charset="utf-8">',
		`<title>${escapeHtml(parts.subject)}</title>`,
		'</head>',
		'<body style="margin: 0; padding: 24px; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.5; color: #1a1a1a; background: #ffffff;">',
		'<div style="max-width: 560px;">',
		paragraphHtml(hello),
		paragraphHtml(first),
		codeHtml,
		...rest.map(paragraphHtml),
		actionHtml,
		footerHtml,
		'</div>',
		'</body>',
		'</html>'
	].join('\r\n');

	return({
		subject: parts.subject,
		text: `${textBlocks.join('\r\n\r\n')}\r\n`,
		html
	});
}
