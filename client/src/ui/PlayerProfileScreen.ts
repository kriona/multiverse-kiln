import type { PlayerProfilePayload, SocialSite } from '@multiverse-kiln/shared';

import { currentLocale, t } from '../localization';
import { getElement, setPageTitle, showScreen } from './dom';
import { languageName } from './languagePicker';
import { describeTimeZone } from './timeZones';
import { characterLabel, showProfileCharacters } from './profileCharacters';

/**
 * Each social site's name, as players know it
 */
const SOCIAL_SITE_NAMES: Readonly<Record<SocialSite, string>> = {
	discord: 'Discord',
	facebook: 'Facebook',
	instagram: 'Instagram',
	tiktok: 'TikTok'
};

/**
 * The address of a player's page on a social site, built from their username so it can only go to that
 * site. Discord has no page for a user, so its username is shown without a link
 */
const SOCIAL_SITE_URLS: Readonly<Record<SocialSite, ((username: string) => string) | undefined>> = {
	discord: undefined,
	facebook: (username) => `https://www.facebook.com/${encodeURIComponent(username)}`,
	instagram: (username) => `https://www.instagram.com/${encodeURIComponent(username)}/`,
	tiktok: (username) => `https://www.tiktok.com/@${encodeURIComponent(username)}`
};

/**
 * Text in a language other than the page's, marked so screen readers say it in that language and
 * translation tools leave it alone
 *
 * @param text The text
 * @param language Its language tag
 * @return An element holding it
 */
function textIn(text: string, language: string): HTMLSpanElement
{
	const span = document.createElement('span');

	span.textContent = text;
	span.lang = language;
	span.translate = false;

	return(span);
}

/**
 * Languages, each named in itself, joined into a list the way the page's language does
 *
 * @param languages The language tags
 * @return The list's names and the punctuation between them
 */
function languageList(languages: readonly string[]): Node[]
{
	const names = languages.map((language) => textIn(languageName(language), language));
	let next = 0;

	return(new Intl.ListFormat(currentLocale(), { style: 'short', type: 'unit' })
		.formatToParts(names.map((name) => (name.textContent ?? '')))
		.map((part) => ((part.type === 'element') ? names[next++] : document.createTextNode(part.value))));
}

/**
 * A player's profile as other players see it (the player screen of profile.html): what they filled in,
 * and the characters they let others see
 */
export class PlayerProfileScreen
{
	private readonly name = getElement('player-name', HTMLElement);
	private readonly username = getElement('player-username', HTMLElement);
	private readonly details = getElement('player-details', HTMLDListElement);
	private readonly socials = getElement('player-socials', HTMLUListElement);
	private readonly characterList = getElement('player-character-list', HTMLElement);
	private readonly noCharacters = getElement('player-character-none', HTMLElement);

	/**
	 * Shows a profile
	 *
	 * @param profile The profile
	 */
	show(profile: PlayerProfilePayload): void
	{
		this.name.textContent = profile.displayName;
		this.username.textContent = `@${profile.username}`;
		this.showDetails(profile);
		this.showSocials(profile);
		showProfileCharacters(this.characterList, profile.characters, (character) =>
		{
			const item = document.createElement('li');

			item.className = 'profile-character';
			item.append(...characterLabel(character));

			return(item);
		});
		this.noCharacters.hidden = (profile.characters.length > 0);
		setPageTitle(profile.displayName);
		showScreen('player');
	}

	/**
	 * Shows the pronouns, location, time zone and languages the player filled in, leaving out the rest
	 *
	 * @param profile The profile
	 */
	private showDetails(profile: PlayerProfilePayload): void
	{
		const rows: [label: string, value: string | Node[]][] = [];

		if (profile.pronouns !== null)
		{
			rows.push([t({
				id: 'player.pronouns',
				defaultMessage: 'Pronouns',
				description: 'Label of a player\'s pronouns on their profile, as other players see it'
			}), ((profile.pronounsLanguage === null) ? profile.pronouns : [textIn(profile.pronouns, profile.pronounsLanguage)])]);
		}

		if (profile.location !== null)
		{
			rows.push([t({
				id: 'player.location',
				defaultMessage: 'Location',
				description: 'Label of where a player is, as they wrote it, on their profile as other players see it'
			}), profile.location]);
		}

		if (profile.timeZone !== null)
		{
			const now = new Date();
			const { city, name, offset } = describeTimeZone(profile.timeZone, currentLocale(), now);

			rows.push([t({
				id: 'player.timeZone',
				defaultMessage: 'Time zone',
				description: 'Label of a player\'s time zone on their profile, as other players see it'
			}), t({
				id: 'player.timeZoneValue',
				defaultMessage: '{city} ({zoneName}), where it\'s {time} now',
				description: 'A player\'s time zone on their profile, as other players see it; {city} is the city the time zone is named after, such as Paris, {zoneName} its name, such as Central European Time, or its offset from UTC, such as GMT+1, and {time} the time of day there when the page was opened'
			}, {
				city,
				zoneName: (name ?? offset ?? profile.timeZone),
				time: new Intl.DateTimeFormat(currentLocale(), {
					timeStyle: 'short',
					timeZone: profile.timeZone
				}).format(now)
			})]);
		}

		if (profile.languages.length > 0)
		{
			rows.push([t({
				id: 'player.languages',
				defaultMessage: 'Languages',
				description: 'Label of the languages a player knows, each named in itself, on their profile as other players see it'
			}), languageList(profile.languages)]);
		}

		this.details.replaceChildren(...rows.flatMap(([label, value]) =>
		{
			const term = document.createElement('dt');
			const description = document.createElement('dd');

			term.textContent = label;
			description.append(...((typeof value === 'string') ? [value] : value));

			return([term, description]);
		}));
		this.details.hidden = (rows.length === 0);
	}

	/**
	 * Lists the player's social site usernames, each linked to their page on the site where it has one
	 *
	 * @param profile The profile
	 */
	private showSocials(profile: PlayerProfilePayload): void
	{
		const items = (Object.keys(SOCIAL_SITE_NAMES) as SocialSite[]).flatMap((site) =>
		{
			const username = profile.socials[site];

			if (username === null)
			{
				return([]);
			}

			const item = document.createElement('li');
			const text = t({
				id: 'player.social',
				defaultMessage: '{site}: {username}',
				description: 'A player\'s username on a social site, on their profile as other players see it; {site} is Discord, Facebook, Instagram or TikTok'
			}, {
				site: SOCIAL_SITE_NAMES[site],
				username
			});
			const url = SOCIAL_SITE_URLS[site]?.(username);

			if (url === undefined)
			{
				item.textContent = text;
			}
			else
			{
				const link = document.createElement('a');

				link.href = url;
				link.target = '_blank';
				link.rel = 'noopener noreferrer';
				link.textContent = text;
				item.append(link);
			}

			return([item]);
		});

		this.socials.replaceChildren(...items);
		this.socials.hidden = (items.length === 0);
	}
}
