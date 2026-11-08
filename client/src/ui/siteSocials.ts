import { isSiteSocialUrl, SITE_NAME, SITE_SOCIAL_SITES, type SiteSocialLinks } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { AdminApi } from '../network/adminApi';
import { createClient } from '../network/serverConnection';
import { readRememberedJson, rememberJson } from '../rememberedValues';
import { getElement } from './dom';
import { SOCIAL_SITE_NAMES } from './socialSites';

/**
 * Shows the logos of the site's pages on social sites at the end of the footer, each linking to its page.
 * The links the server last gave are remembered in the browser, and public/remembered-socials.js shows
 * them before the page is drawn, so the logos don't disappear while each page waits for the site
 * settings. This takes over from it, checking and naming them, and the server's answer then replaces
 * them. The footer shows none when the site has none, or when nothing is remembered and the settings
 * don't load
 */
export async function startSiteSocials(): Promise<void>
{
	const remembered = readRememberedJson(SOCIALS_STORAGE_KEY, checkSocials);

	if (remembered !== null)
	{
		showSocials(remembered);
	}
	else
	{
		getElement('site-socials', HTMLSpanElement).hidden = true;
	}

	let socials: SiteSocialLinks;

	try
	{
		({ socials } = await new AdminApi(createClient()).getPublicSiteSettings());
	}
	catch
	{
		return;
	}

	if ((remembered === null) || SITE_SOCIAL_SITES.some((site) => (socials[site] !== remembered[site])))
	{
		rememberJson(SOCIALS_STORAGE_KEY, socials);
		showSocials(socials);
	}
}

/**
 * Where the browser keeps the site's social links between pages, which public/remembered-socials.js
 * reads too
 */
const SOCIALS_STORAGE_KEY = 'kiln-site-socials';

/**
 * Shows the logos in the footer's list (partials/footer.html, which has one for each social site) of the
 * sites the site links to, names them, and hides the list when there are none
 *
 * @param socials The site's link to each social site
 */
function showSocials(socials: SiteSocialLinks): void
{
	const container = getElement('site-socials', HTMLSpanElement);
	const list = getElement('site-socials-list', HTMLUListElement);
	let shown = 0;

	for (const site of SITE_SOCIAL_SITES)
	{
		const item = list.querySelector<HTMLLIElement>(`li[data-site="${site}"]`);
		const link = item?.querySelector('a');
		const url = socials[site];

		if (!item || !link)
		{
			continue;
		}

		item.hidden = (url === null);

		if (url === null)
		{
			link.removeAttribute('href');
			continue;
		}

		const label = t({
			id: 'page.socialLink',
			defaultMessage: '{siteName} on {site}',
			description: 'Name of a logo at the bottom of every page that links to the site\'s own page on a social site, read by screen readers and shown when pointed at; {siteName} is the game engine\'s name and {site} is the social site, such as Discord or Facebook'
		}, {
			siteName: SITE_NAME,
			site: SOCIAL_SITE_NAMES[site]
		});

		link.href = url;
		link.title = label;
		link.setAttribute('aria-label', label);
		shown++;
	}

	list.setAttribute('aria-label', t({
		id: 'page.socials',
		defaultMessage: 'Social sites',
		description: 'Name, read by screen readers, of the list of logos at the bottom of every page that link to the site\'s own pages on social sites'
	}));
	container.hidden = (shown === 0);
}

/**
 * Checks remembered social links the way the server checks them
 *
 * @param stored The value read from the browser's storage
 * @return The links, or null when they aren't valid
 */
function checkSocials(stored: unknown): SiteSocialLinks | null
{
	if ((typeof stored !== 'object') || (stored === null))
	{
		return(null);
	}

	const record = stored as Record<string, unknown>;
	const socials = {} as SiteSocialLinks;

	for (const site of SITE_SOCIAL_SITES)
	{
		const url = record[site];

		if (url === null)
		{
			socials[site] = null;
		}
		else if ((typeof url === 'string') && isSiteSocialUrl(site, url))
		{
			socials[site] = url;
		}
		else
		{
			return(null);
		}
	}

	return(socials);
}
