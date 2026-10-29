/**
 * The emails logins send (see Email codes in STRUCTURE-OVERVIEW.md): codes for registering, resetting
 * a password, changing an email address and linking a provider login, and the notices sent when an
 * account is created, its password or email address changes or a provider login is linked to it, or
 * someone tries to register an address that already has an account. Each is written in its recipient's
 * language, as HTML with a plain text part, and ends with a link to the site (SITE_URL)
 */
import { LOGIN_PAGE_PATH, PASSWORD_RESET_PARAMETER, SITE_NAME, type EmailCodePurpose, type Translator } from '@multiverse-kiln/shared';

import { EMAIL_CODE_LIFETIME_MS } from '../logic/emailCodes.js';
import { sitePageUrl, siteUrl } from '../siteUrl.js';
import { emailTranslator } from './emailLocales.js';
import type { EmailContent } from './mailer.js';

/**
 * A link to one of the site's pages, for what the email asks its reader to do
 */
interface EmailAction
{
	label: string;
	url: string;
}

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
 * Lays an email out as plain text and HTML
 *
 * @param translator The recipient's language
 * @param parts What the email says
 * @return The email's subject, text and HTML
 */
function layOut(translator: Translator, parts: EmailParts): EmailContent
{
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

/**
 * The link to the forgot password screen, for notices of changes the reader may not have made
 *
 * @param translator The recipient's language
 * @return The link
 */
function resetPasswordAction(translator: Translator): EmailAction
{
	return({
		label: translator.format({
			id: 'email.action.resetPassword',
			defaultMessage: 'Reset your password',
			description: 'Link at the end of the emails sent when an account\'s password, email address or linked logins change, for someone who didn\'t make the change; opens the forgot password screen'
		}),
		url: sitePageUrl(`${LOGIN_PAGE_PATH}?${PASSWORD_RESET_PARAMETER}`)
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
	else if (purpose === 'linkLogin')
	{
		subject = translator.format({
			id: 'email.code.linkLogin.subject',
			defaultMessage: 'Your code to link a login to your account on {siteName}',
			description: 'Subject of the email that sends the code for linking a Google or Discord login to the account with the same email address; {siteName} is the site\'s name'
		}, values);
		intro = translator.format({
			id: 'email.code.linkLogin.intro',
			defaultMessage: 'Enter this code on {siteName} to log in to your account with Google or Discord from now on:',
			description: 'First paragraph of the email that sends the code for linking a Google or Discord login to the account with the same email address, shown just above the code; {siteName} is the site\'s name'
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
		],
		action: {
			label: translator.format({
				id: 'email.action.logIn',
				defaultMessage: 'Log in to {siteName}',
				description: 'Link at the end of the email sent when someone asks to create an account with an address that already has one; opens the login page. {siteName} is the site\'s name'
			}, values),
			url: sitePageUrl(LOGIN_PAGE_PATH)
		}
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
				defaultMessage: 'Your account on {siteName} has been created.',
				description: 'Paragraph of the email sent when a new account is created; {siteName} is the site\'s name'
			}, values),
			translator.format({
				id: 'email.accountCreated.notYou',
				defaultMessage: 'If you didn\'t create it, someone else can read your email. Change your email password, then reset the account\'s password on {siteName}.',
				description: 'Last paragraph of the email sent when a new account is created, for someone who didn\'t create it; {siteName} is the site\'s name'
			}, values)
		],
		action: {
			label: translator.format({
				id: 'email.action.visit',
				defaultMessage: 'Go to {siteName}',
				description: 'Link at the end of the email sent when a new account is created; opens the site\'s first page. {siteName} is the site\'s name'
			}, values),
			url: sitePageUrl('/')
		}
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
				defaultMessage: 'If you didn\'t change it, reset your password on {siteName} immediately.',
				description: 'Last paragraph of the email sent when an account\'s password is changed or reset, for someone who didn\'t change it; {siteName} is the site\'s name'
			}, values)
		],
		action: resetPasswordAction(translator)
	}));
}

/**
 * The email sent when a Google or Discord login is linked to an account
 *
 * @param provider The provider's name, such as Google
 * @param locale The language the recipient asked in
 * @return The email
 */
export function providerLinkedEmail(provider: string, locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME,
		provider
	};

	return(layOut(translator, {
		subject: translator.format({
			id: 'email.providerLinked.subject',
			defaultMessage: 'You can now log in to {siteName} with {provider}',
			description: 'Subject of the email sent when a Google or Discord login is linked to an account; {siteName} is the site\'s name and {provider} is Google or Discord'
		}, values),
		paragraphs: [
			translator.format({
				id: 'email.providerLinked.body',
				defaultMessage: 'A {provider} login was linked to your account on {siteName}, so it can log in to the account from now on.',
				description: 'Paragraph of the email sent when a Google or Discord login is linked to an account; {siteName} is the site\'s name and {provider} is Google or Discord'
			}, values),
			translator.format({
				id: 'email.providerLinked.notYou',
				defaultMessage: 'If you didn\'t link it, someone else may be using your account on {siteName}. Reset its password immediately.',
				description: 'Last paragraph of the email sent when a Google or Discord login is linked to an account, for someone who didn\'t link it; {siteName} is the site\'s name'
			}, values)
		],
		action: resetPasswordAction(translator)
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
				defaultMessage: 'If you didn\'t change it, someone else may be using your account on {siteName}. Reset its password immediately.',
				description: 'Last paragraph of the emails sent to both the old and the new address when an account\'s email address is changed, for someone who didn\'t change it; {siteName} is the site\'s name'
			}, values)
		],
		action: resetPasswordAction(translator)
	}));
}

/**
 * The email sent when 2FA is turned on for an account
 *
 * @param locale The language the recipient asked in
 * @return The email
 */
export function twoFactorEnabledEmail(locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME
	};

	return(layOut(translator, {
		subject: translator.format({
			id: 'email.twoFactorEnabled.subject',
			defaultMessage: 'Two-factor authentication is on for your account on {siteName}',
			description: 'Subject of the email sent when two-factor authentication (an authenticator app code asked for at login) is turned on for an account; {siteName} is the site\'s name'
		}, values),
		paragraphs: [
			translator.format({
				id: 'email.twoFactorEnabled.body',
				defaultMessage: 'Two-factor authentication was turned on for your account on {siteName}. Logging in with your password now asks for a code from your authenticator app too. Keep your recovery codes somewhere safe: they are the only way in if you lose the app.',
				description: 'Paragraph of the email sent when two-factor authentication is turned on for an account; {siteName} is the site\'s name'
			}, values),
			translator.format({
				id: 'email.twoFactorEnabled.notYou',
				defaultMessage: 'If you didn\'t turn it on, someone else may be using your account on {siteName}. Reset its password immediately.',
				description: 'Last paragraph of the email sent when two-factor authentication is turned on for an account, for someone who didn\'t turn it on; {siteName} is the site\'s name'
			}, values)
		],
		action: resetPasswordAction(translator)
	}));
}

/**
 * The email sent when 2FA is turned off for an account
 *
 * @param locale The language the recipient asked in
 * @return The email
 */
export function twoFactorDisabledEmail(locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME
	};

	return(layOut(translator, {
		subject: translator.format({
			id: 'email.twoFactorDisabled.subject',
			defaultMessage: 'Two-factor authentication is off for your account on {siteName}',
			description: 'Subject of the email sent when two-factor authentication (an authenticator app code asked for at login) is turned off for an account; {siteName} is the site\'s name'
		}, values),
		paragraphs: [
			translator.format({
				id: 'email.twoFactorDisabled.body',
				defaultMessage: 'Two-factor authentication was turned off for your account on {siteName}. Logging in now needs only your password, and your recovery codes no longer work.',
				description: 'Paragraph of the email sent when two-factor authentication is turned off for an account; {siteName} is the site\'s name'
			}, values),
			translator.format({
				id: 'email.twoFactorDisabled.notYou',
				defaultMessage: 'If you didn\'t turn it off, someone else may be using your account on {siteName}. Reset its password immediately, then turn two-factor authentication on again.',
				description: 'Last paragraph of the email sent when two-factor authentication is turned off for an account, for someone who didn\'t turn it off; {siteName} is the site\'s name'
			}, values)
		],
		action: resetPasswordAction(translator)
	}));
}

/**
 * The email sent when one of an account's recovery codes is used
 *
 * @param codesLeft How many recovery codes the account has left
 * @param locale The language the recipient asked in
 * @return The email
 */
export function recoveryCodeUsedEmail(codesLeft: number, locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME
	};

	return(layOut(translator, {
		subject: translator.format({
			id: 'email.recoveryCodeUsed.subject',
			defaultMessage: 'A recovery code was used on {siteName}',
			description: 'Subject of the email sent when one of an account\'s recovery codes (used in place of an authenticator app code) is used; {siteName} is the site\'s name'
		}, values),
		paragraphs: [
			translator.format({
				id: 'email.recoveryCodeUsed.body',
				defaultMessage: 'One of the recovery codes of your account on {siteName} was just used in place of a code from your authenticator app. It won\'t work again. {count, plural, =0 {You have no recovery codes left: make new ones on your profile.} one {You have # left.} other {You have # left.}}',
				description: 'Paragraph of the email sent when one of an account\'s recovery codes is used; {siteName} is the site\'s name, and {count} how many recovery codes the account has left'
			}, {
				...values,
				count: codesLeft
			}),
			translator.format({
				id: 'email.recoveryCodeUsed.notYou',
				defaultMessage: 'If you didn\'t use it, someone else has your password and recovery codes. Reset your password immediately, and make new recovery codes on your profile.',
				description: 'Last paragraph of the email sent when one of an account\'s recovery codes is used, for someone who didn\'t use it'
			})
		],
		action: resetPasswordAction(translator)
	}));
}

/**
 * The email sent when an account is deleted, to the address it had
 *
 * @param locale The language the recipient asked in
 * @return The email
 */
export function accountDeletedEmail(locale: string): EmailContent
{
	const translator = emailTranslator(locale);
	const values = {
		siteName: SITE_NAME
	};

	return(layOut(translator, {
		subject: translator.format({
			id: 'email.accountDeleted.subject',
			defaultMessage: 'Your account on {siteName} was deleted',
			description: 'Subject of the email sent when a player deletes their account; {siteName} is the site\'s name'
		}, values),
		paragraphs: [
			translator.format({
				id: 'email.accountDeleted.body',
				defaultMessage: 'Your account on {siteName} was deleted, with your profile and characters. Thanks for playing.',
				description: 'Paragraph of the email sent when a player deletes their account; {siteName} is the site\'s name'
			}, values),
			translator.format({
				id: 'email.accountDeleted.notYou',
				defaultMessage: 'If you didn\'t delete it, someone else was using your account. It can\'t be brought back, but you can contact the site about it.',
				description: 'Last paragraph of the email sent when a player deletes their account, for someone who didn\'t delete it'
			})
		]
	}));
}
