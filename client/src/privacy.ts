import { AUTH_EVENT_DAYS, CONTINUATION_LIFETIME_MINUTES, EMAIL_CODE_LIFETIME_MINUTES, KNOWN_BROWSER_DAYS, MAX_KEPT_CHAT_MESSAGES, REMEMBERED_SESSION_IDLE_DAYS, SESSION_IDLE_HOURS, TRUSTED_BROWSER_DAYS, UNIVERSE_EDIT_DAYS, type PublicSiteSettings } from '@multiverse-kiln/shared';

import { currentLocale, t } from './localization';
import { AdminApi } from './network/adminApi';
import { createClient } from './network/serverConnection';
import { startPage } from './pageStart';
import { getElement, scrollToFragment, setPageTitle } from './ui/dom';

/**
 * Shows the privacy policy in the player's language. It works without the session room, so it doesn't
 * wait for the connection
 */
async function start(): Promise<void>
{
	await startPage();
	setPageTitle(document.title);
	formatDate();
	showKeptTimes();
	scrollToFragment();
	await showSiteSettings();
}

/**
 * Writes the lines of the policy that say how long the site keeps something, from the times the
 * server keeps it for
 */
function showKeptTimes(): void
{
	getElement('privacy-edit-record', HTMLElement).textContent = t({
		id: 'privacy.playEditRecord',
		defaultMessage: 'A record of each save you make in a universe\'s editor: when, with which role, and what it changed, by name, with the value it gave each setting it changed (a long description only by how many characters it has). The universe\'s creators and the site\'s admins can see it. Each save is kept for {days, plural, one {# day} other {# days}}, or until the universe is deleted if that is sooner, even after you delete your account. Deleting your account takes your name off your own saves, but your username stays in the saves that gave you a role in a universe, changed it or took it away.',
		description: 'In the privacy policy, the record of saves made in a universe\'s editor, shown to the universe\'s creators and the site\'s admins on the editor\'s Audit tab. Each save is kept for {days} days, or until the universe is deleted, even after the player deletes their account: deleting it takes their name off their own saves, but their username stays in the saves that gave them a role in a universe, changed it or took it away'
	}, { days: UNIVERSE_EDIT_DAYS });

	getElement('privacy-kept-chat', HTMLElement).textContent = t({
		id: 'privacy.playKeptChat',
		defaultMessage: 'Each group\'s chat and the chat of a universe\'s editors are saved, so players who arrive can read them: each keeps {count, plural, one {its newest message} other {its newest # messages}}, until the group disbands or the universe is deleted. When you delete your account, your messages stay in them without your name.',
		description: 'In the privacy policy, how long the chats of groups and of a universe\'s editors are kept: each its newest {count} messages, until the group disbands or the universe is deleted, and what happens to a player\'s messages when they delete their account'
	}, { count: MAX_KEPT_CHAT_MESSAGES });

	getElement('privacy-security-codes', HTMLElement).textContent = t({
		id: 'privacy.securityCodes',
		defaultMessage: 'The codes we email you, to register, reset your password or change your email address, kept only in a scrambled form, and only until they are used or expire {minutes, plural, one {# minute} other {# minutes}} later.',
		description: 'In the privacy policy\'s list of security records: the codes the site emails to register, reset a password or change an email address, kept only as a keyed hash; {minutes} is how many minutes a code works'
	}, { minutes: EMAIL_CODE_LIFETIME_MINUTES });

	getElement('privacy-security-log', HTMLElement).textContent = t({
		id: 'privacy.securityLog',
		defaultMessage: 'A log of logins, failed logins and changes to your account\'s security, such as a new password, with your network in a scrambled form. It never holds passwords or codes, and is kept for {days, plural, one {# day} other {# days}}.',
		description: 'In the privacy policy\'s list of security records: the log of logins and account changes, kept {days} days, which stores a player\'s network only as a keyed hash'
	}, { days: AUTH_EVENT_DAYS });

	getElement('privacy-cookies-session', HTMLElement).textContent = t({
		id: 'privacy.cookiesSession',
		defaultMessage: 'A cookie that keeps you logged in. It ends when you log out, after {hours, plural, one {an hour} other {# hours}} without use, or when you close your browser; with "Remember me" checked, after {days, plural, one {# day} other {# days}} without use.',
		description: 'In the privacy policy\'s list of what the site stores in a player\'s browser: the login cookie, and how long it lasts; {hours} is how many hours it lasts without use, and {days} how many days with "Remember me" checked'
	}, {
		hours: SESSION_IDLE_HOURS,
		days: REMEMBERED_SESSION_IDLE_DAYS
	});

	getElement('privacy-cookies-known-browser', HTMLElement).textContent = t({
		id: 'privacy.cookiesKnownBrowser',
		defaultMessage: 'A cookie that shows a browser has logged in to your account, so other people\'s wrong password guesses can\'t stop it from logging in. It doesn\'t say which account it is, and lasts {days, plural, one {# day} other {# days}} after you last log in.',
		description: 'In the privacy policy\'s list of what the site stores in a player\'s browser: a cookie that marks a browser as one that has logged in to the account, so other people\'s wrong password guesses for the account can\'t stop that browser logging in; {days} is how many days it lasts'
	}, { days: KNOWN_BROWSER_DAYS });

	getElement('privacy-cookies-code', HTMLElement).textContent = t({
		id: 'privacy.cookiesCode',
		defaultMessage: 'After you enter a code we emailed you, a cookie that lets that browser take the next step, such as choosing a password, for {minutes, plural, one {# minute} other {# minutes}}.',
		description: 'In the privacy policy\'s list of what the site stores in a player\'s browser: a cookie that lasts {minutes} minutes after a player enters a correct email code, for the next step such as choosing a password'
	}, { minutes: CONTINUATION_LIFETIME_MINUTES });

	getElement('privacy-cookies-two-factor', HTMLElement).textContent = t({
		id: 'privacy.cookiesTwoFactor',
		defaultMessage: 'With two-factor authentication on, a cookie that lets the browser where you typed your password, or logged in with Google or Discord, enter your authenticator code, for {minutes, plural, one {# minute} other {# minutes}}. If you choose not to be asked again on a browser, a cookie that lets it skip the code for {days, plural, one {# day} other {# days}}, until you stop trusting it on your profile.',
		description: 'In the privacy policy\'s list of what the site stores in a player\'s browser: the cookies two-factor authentication uses, one while the login waits for the authenticator code, for {minutes} minutes, and one for a browser the player chose to trust, for {days} days'
	}, {
		minutes: CONTINUATION_LIFETIME_MINUTES,
		days: TRUSTED_BROWSER_DAYS
	});

	getElement('privacy-how-long-edit-record', HTMLElement).textContent = t({
		id: 'privacy.howLongEditRecord',
		defaultMessage: 'The record of saves made in universe editors for {days, plural, one {# day} other {# days}}, or until the universe is deleted, even after you delete your account.',
		description: 'In the privacy policy, how long the record of saves made in universes\' editors is kept: {days} days, or until the universe is deleted, even after the player deletes their account'
	}, { days: UNIVERSE_EDIT_DAYS });

	getElement('privacy-how-long-security', HTMLElement).textContent = t({
		id: 'privacy.howLongSecurity',
		defaultMessage: 'Security records as long as the list above says: the log for {days, plural, one {# day} other {# days}}, codes for {minutes, plural, one {# minute} other {# minutes}}, counts only while a limit needs them, and the admins\' record with your name in it until you delete your account.',
		description: 'In the privacy policy, how long security records are kept; {days} is how many days the log of logins keeps each record, and {minutes} how many minutes an emailed code works'
	}, {
		days: AUTH_EVENT_DAYS,
		minutes: EMAIL_CODE_LIFETIME_MINUTES
	});
}

/**
 * Fills in the parts of the policy that come from the site's settings. The page keeps its general
 * wording, and leaves out the contact line, when the settings can't be loaded
 */
async function showSiteSettings(): Promise<void>
{
	let settings: PublicSiteSettings;

	try
	{
		settings = await new AdminApi(createClient()).getPublicSiteSettings();
	}
	catch
	{
		return;
	}

	showContact(settings.privacyContact);
	showCharacterDeletionDays(settings.characterDeletionDays);
}

/**
 * Shows the email address players write to about their information, or leaves the line out when the
 * site has none
 *
 * @param address The address, or null
 */
function showContact(address: string | null): void
{
	const element = document.getElementById('privacy-contact');
	const link = document.getElementById('privacy-contact-link');

	if (!element || !(link instanceof HTMLAnchorElement) || (address === null))
	{
		return;
	}

	link.href = `mailto:${address}`;
	link.textContent = address;
	element.hidden = false;
}

/**
 * Writes how many days a deleted character is kept, or removes the line when the site deletes
 * characters immediately
 *
 * @param days The days the site keeps them
 */
function showCharacterDeletionDays(days: number): void
{
	const element = document.getElementById('privacy-character-deletion');

	if (!element)
	{
		return;
	}

	if (days === 0)
	{
		element.remove();
	}
	else
	{
		element.textContent = t({
			id: 'privacy.howLongCharactersDays',
			defaultMessage: 'A character you delete, for {days, plural, one {# day} other {# days}}, while you can still bring them back.',
			description: 'In the privacy policy, how long a deleted character is kept before it is removed for good, during which the player can restore them; {days} is the number of days the site sets'
		}, { days });
	}
}

/**
 * Writes the date the policy last changed the way the player's language writes dates
 */
function formatDate(): void
{
	const element = document.getElementById('privacy-date');
	const [year, month, day] = (element?.getAttribute('datetime') ?? '')
		.split('-')
		.map(Number);

	if (!element || (year === undefined) || (month === undefined) || (day === undefined))
	{
		return;
	}

	// The date has no time of day, so it is formatted in UTC to keep it from moving to the day before or after
	element.textContent = new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}

void start();
