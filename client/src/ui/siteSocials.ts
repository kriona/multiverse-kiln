import { SITE_NAME, SITE_SOCIAL_SITES, type SiteSocialLinks } from '@multiverse-kiln/shared';

import { t } from '../localization';
import { AdminApi } from '../network/adminApi';
import { createClient } from '../network/serverConnection';
import { getElement } from './dom';
import { SOCIAL_SITE_NAMES, socialSiteIcon } from './socialSites';

/**
 * Shows the logos of the site's pages on social sites at the end of the footer, each linking to its page,
 * once the site settings load. The footer shows none when the site has none or the settings don't load
 */
export async function startSiteSocials(): Promise<void>
{
	const container = getElement('site-socials', HTMLSpanElement);
	const list = getElement('site-socials-list', HTMLUListElement);
	let socials: SiteSocialLinks;

	try
	{
		({ socials } = await new AdminApi(createClient()).getPublicSiteSettings());
	}
	catch
	{
		return;
	}

	const items = SITE_SOCIAL_SITES.flatMap((site) =>
	{
		const url = socials[site];

		if (url === null)
		{
			return([]);
		}

		const item = document.createElement('li');
		const link = document.createElement('a');
		const label = t({
			id: 'page.socialLink',
			defaultMessage: '{siteName} on {site}',
			description: 'Name of a logo at the bottom of every page that links to the site\'s own page on a social site, read by screen readers and shown when pointed at; {siteName} is the game engine\'s name and {site} is the social site, such as Discord or Facebook'
		}, {
			siteName: SITE_NAME,
			site: SOCIAL_SITE_NAMES[site]
		});

		link.href = url;
		link.rel = 'noopener noreferrer';
		link.title = label;
		link.setAttribute('aria-label', label);
		link.append(socialSiteIcon(site));
		item.append(link);

		return([item]);
	});

	list.setAttribute('aria-label', t({
		id: 'page.socials',
		defaultMessage: 'Social sites',
		description: 'Name, read by screen readers, of the list of logos at the bottom of every page that link to the site\'s own pages on social sites'
	}));
	list.replaceChildren(...items);
	container.hidden = (items.length === 0);
}
