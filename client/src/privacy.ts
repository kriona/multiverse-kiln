import { currentLocale, startLocalization, t } from './localization';
import { AdminApi } from './network/adminApi';
import { createClient } from './network/serverConnection';
import { startAccountMenu } from './ui/accountMenu';
import { setPageTitle } from './ui/dom';
import { startLanguagePicker } from './ui/languagePicker';
import { startShortcuts } from './ui/shortcuts';

/**
 * Shows the privacy policy in the player's language
 */
async function start(): Promise<void>
{
	await startLocalization();
	setPageTitle(document.title);
	void startAccountMenu();
	formatDate();
	startLanguagePicker();
	startShortcuts();
	await showCharacterDeletionDays();
}

/**
 * Writes how many days a deleted character is kept, from the site's settings, or removes the line
 * when the site deletes characters straight away
 *
 * The page keeps its general wording when the settings can't be loaded
 */
async function showCharacterDeletionDays(): Promise<void>
{
	const element = document.getElementById('privacy-character-deletion');

	if (!element)
	{
		return;
	}

	let days: number;

	try
	{
		({ characterDeletionDays: days } = await new AdminApi(createClient()).getSiteSettings());
	}
	catch
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
