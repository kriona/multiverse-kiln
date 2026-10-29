/**
 * The emails logins send (see Email codes in STRUCTURE-OVERVIEW.md): codes for registering, resetting
 * a password and changing an email address, and the notices sent when an account is created or its
 * password or email address changes, or someone tries to register an address that already has an
 * account. Each is written in its recipient's language, as HTML with a plain text part
 */
import { SITE_NAME, type EmailCodePurpose, type Translator } from '@multiverse-kiln/shared';

import { EMAIL_CODE_LIFETIME_MS } from '../logic/emailCodes.js';
import { emailTranslator } from './emailLocales.js';
import type { EmailContent } from './mailer.js';

/**
 * What an email says, before it is laid out
 */
interface EmailParts
{
	subject: string;
	paragraphs: string[];

	/**
	 * An email code, shown large after the first paragraph
	 */
	code?: string;
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
 * Lays an email out as plain text and HTML
 *
 * @param translator The recipient's language
 * @param parts What the email says
 * @return The email's subject, text and HTML
 */
function layOut(translator: Translator, parts: EmailParts): EmailContent
{
	const [first, ...rest] = parts.paragraphs;
	const textBlocks = [first, ...((parts.code !== undefined) ? [parts.code] : []), ...rest];
	const paragraphHtml = (paragraph: string): string => `<p style="margin: 0 0 16px;">${escapeHtml(paragraph)}</p>`;
	const codeHtml = ((parts.code !== undefined)
		? `<p style="margin: 0 0 16px; font-family: Consolas, Menlo, monospace; font-size: 32px; font-weight: bold; letter-spacing: 6px;">${escapeHtml(parts.code)}</p>`
		: '');
	const html = [
		'<!doctype html>',
		`<html lang="${escapeHtml(translator.locale)}">`,
		'<head>',
		'<meta charset="utf-8">',
		`<title>${escapeHtml(parts.subject)}</title>`,
		'</head>',
		'<body style="margin: 0; padding: 24px; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.5; color: #1a1a1a; background: #ffffff;">',
		'<div style="max-width: 560px;">',
		paragraphHtml(first),
		codeHtml,
		...rest.map(paragraphHtml),
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

/**
 * The last paragraph of a code email: what to do about a code nobody asked for
 *
 * @param translator The recipient's language
 * @return The paragraph
 */
function unaskedCodeParagraph(translator: Translator): string
{
	return(translator.format({
		id: 'email.code.notYou',
		defaultMessage: 'If you didn\'t ask for this code, you can ignore this email. Nobody can use the code without reading your email.',
		description: 'Last paragraph of every email that sends a code (to create an account, reset a password or change an email address), for someone who didn\'t ask for it'
	}));
}

/**
 * The email that sends a code
 *
 * @param purpose What the code is for
 * @param code The code
 * @param locale The language the recipient asked in
 * @return The email
 */
export function emailCodeEmail(purpose: EmailCodePurpose, code: string, locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME
	};
	const lifetime = translator.format({
		id: 'email.code.lifetime',
		defaultMessage: 'The code works once, for {minutes, plural, one {# minute} other {# minutes}}.',
		description: 'In every email that sends a code, after the code: how long it can be used'
	}, {
		minutes: (EMAIL_CODE_LIFETIME_MS / 60000)
	});
	let subject: string;
	let intro: string;

	if (purpose === 'register')
	{
		subject = translator.format({
			id: 'email.code.register.subject',
			defaultMessage: 'Your code to create an account on {siteName}',
			description: 'Subject of the email that sends the code for creating a new account; {siteName} is the site\'s name'
		}, values);
		intro = translator.format({
			id: 'email.code.register.intro',
			defaultMessage: 'Enter this code on {siteName} to create your account:',
			description: 'First paragraph of the email that sends the code for creating a new account, shown just above the code; {siteName} is the site\'s name'
		}, values);
	}
	else if (purpose === 'resetPassword')
	{
		subject = translator.format({
			id: 'email.code.resetPassword.subject',
			defaultMessage: 'Your code to reset your password on {siteName}',
			description: 'Subject of the email that sends the code for resetting a forgotten password; {siteName} is the site\'s name'
		}, values);
		intro = translator.format({
			id: 'email.code.resetPassword.intro',
			defaultMessage: 'Enter this code on {siteName} to choose a new password:',
			description: 'First paragraph of the email that sends the code for resetting a forgotten password, shown just above the code; {siteName} is the site\'s name'
		}, values);
	}
	else
	{
		subject = translator.format({
			id: 'email.code.changeEmail.subject',
			defaultMessage: 'Your code to change your email address on {siteName}',
			description: 'Subject of the email, sent to the new address, with the code for changing an account\'s email address; {siteName} is the site\'s name'
		}, values);
		intro = translator.format({
			id: 'email.code.changeEmail.intro',
			defaultMessage: 'Enter this code on {siteName} to make this your account\'s email address:',
			description: 'First paragraph of the email, sent to the new address, with the code for changing an account\'s email address, shown just above the code; {siteName} is the site\'s name'
		}, values);
	}

	return(layOut(translator, {
		subject,
		paragraphs: [intro, lifetime, unaskedCodeParagraph(translator)],
		code
	}));
}

/**
 * The email sent in place of a code when someone asks to register an address that already has an
 * account. The page says the same whether or not the address has one, so only the address's owner
 * learns it does
 *
 * @param locale The language the recipient asked in
 * @return The email
 */
export function accountExistsEmail(locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME
	};

	return(layOut(translator, {
		subject: translator.format({
			id: 'email.accountExists.subject',
			defaultMessage: 'You already have an account on {siteName}',
			description: 'Subject of the email sent, in place of a code, when someone asks to create an account with an address that already has one; {siteName} is the site\'s name'
		}, values),
		paragraphs: [
			translator.format({
				id: 'email.accountExists.body',
				defaultMessage: 'Someone asked to create an account on {siteName} with this email address, but it already has one. Log in instead, or reset your password if you\'ve forgotten it.',
				description: 'Paragraph of the email sent, in place of a code, when someone asks to create an account with an address that already has one; {siteName} is the site\'s name'
			}, values),
			translator.format({
				id: 'email.accountExists.notYou',
				defaultMessage: 'If you didn\'t ask, you can ignore this email. Nothing about your account has changed.',
				description: 'Last paragraph of the email sent when someone asks to create an account with an address that already has one, for someone who didn\'t ask'
			})
		]
	}));
}

/**
 * The email sent once an account is created
 *
 * @param locale The language the recipient asked in
 * @return The email
 */
export function accountCreatedEmail(locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME
	};

	return(layOut(translator, {
		subject: translator.format({
			id: 'email.accountCreated.subject',
			defaultMessage: 'Welcome to {siteName}',
			description: 'Subject of the email sent when a new account is created; {siteName} is the site\'s name'
		}, values),
		paragraphs: [
			translator.format({
				id: 'email.accountCreated.body',
				defaultMessage: 'Your account on {siteName} has been created, with this email address.',
				description: 'Paragraph of the email sent when a new account is created; {siteName} is the site\'s name'
			}, values),
			translator.format({
				id: 'email.accountCreated.notYou',
				defaultMessage: 'If you didn\'t create it, someone else can read your email. Change your email password, then reset the account\'s password on {siteName}.',
				description: 'Last paragraph of the email sent when a new account is created, for someone who didn\'t create it; {siteName} is the site\'s name'
			}, values)
		]
	}));
}

/**
 * The email sent when an account's password changes, which also ends every session of the account
 *
 * @param locale The language the recipient asked in
 * @return The email
 */
export function passwordChangedEmail(locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME
	};

	return(layOut(translator, {
		subject: translator.format({
			id: 'email.passwordChanged.subject',
			defaultMessage: 'Your password on {siteName} was changed',
			description: 'Subject of the email sent when an account\'s password is changed or reset; {siteName} is the site\'s name'
		}, values),
		paragraphs: [
			translator.format({
				id: 'email.passwordChanged.body',
				defaultMessage: 'The password of your account on {siteName} was just changed, and every browser logged in to it was logged out.',
				description: 'Paragraph of the email sent when an account\'s password is changed or reset; {siteName} is the site\'s name'
			}, values),
			translator.format({
				id: 'email.passwordChanged.notYou',
				defaultMessage: 'If you didn\'t change it, reset your password on {siteName} straight away.',
				description: 'Last paragraph of the email sent when an account\'s password is changed or reset, for someone who didn\'t change it; {siteName} is the site\'s name'
			}, values)
		]
	}));
}

/**
 * Which of an account's addresses an email-changed notice goes to
 */
export type ChangedEmailRecipient = { address: 'old'; newAddress: string } | { address: 'new' };

/**
 * The email sent to both an account's old and new addresses when its email address changes
 *
 * @param recipient Which address it goes to, and for the old one, the new address
 * @param locale The language the recipient asked in
 * @return The email
 */
export function emailChangedEmail(recipient: ChangedEmailRecipient, locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME
	};
	const body = ((recipient.address === 'old')
		? translator.format({
			id: 'email.emailChanged.oldAddress',
			defaultMessage: 'The email address of your account on {siteName} was changed to {newAddress}. Emails about the account will go there from now on.',
			description: 'Paragraph of the email sent to an account\'s old address when its email address is changed; {siteName} is the site\'s name and {newAddress} the new email address'
		}, {
			...values,
			newAddress: recipient.newAddress
		})
		: translator.format({
			id: 'email.emailChanged.newAddress',
			defaultMessage: 'This is now the email address of your account on {siteName}.',
			description: 'Paragraph of the email sent to an account\'s new address when its email address is changed; {siteName} is the site\'s name'
		}, values));

	return(layOut(translator, {
		subject: translator.format({
			id: 'email.emailChanged.subject',
			defaultMessage: 'Your email address on {siteName} was changed',
			description: 'Subject of the emails sent to both the old and the new address when an account\'s email address is changed; {siteName} is the site\'s name'
		}, values),
		paragraphs: [
			body,
			translator.format({
				id: 'email.emailChanged.notYou',
				defaultMessage: 'If you didn\'t change it, someone else may be using your account on {siteName}. Reset its password straight away.',
				description: 'Last paragraph of the emails sent to both the old and the new address when an account\'s email address is changed, for someone who didn\'t change it; {siteName} is the site\'s name'
			}, values)
		]
	}));
}
