import type { PublicSiteSettings } from '@multiverse-kiln/shared';

import { currentLocale, t } from './localization';
import { AdminApi } from './network/adminApi';
import { createClient } from './network/serverConnection';
import { startPage } from './pageStart';
import { scrollToFragment, setPageTitle } from './ui/dom';

/**
 * Shows the privacy policy in the player's language. It works without the session room, so it doesn't
 * wait for the connection
 */
async function start(): Promise<void>
{
	await startPage();
	setPageTitle(document.title);
	formatDate();
	scrollToFragment();
	await showSiteSettings();
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
