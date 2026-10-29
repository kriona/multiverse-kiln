import type { SiteSocialSite } from '@multiverse-kiln/shared';
import discordIcon from 'virtual:icon/ph:discord-logo';
import facebookIcon from 'virtual:icon/ph:facebook-logo';
import instagramIcon from 'virtual:icon/ph:instagram-logo';
import tiktokIcon from 'virtual:icon/ph:tiktok-logo';
import xIcon from 'virtual:icon/ph:x-logo';
import youtubeIcon from 'virtual:icon/ph:youtube-logo';

/**
 * Each social site's name, as players know it. The sites players link on their profiles
 * (SOCIAL_SITES) are among these
 */
export const SOCIAL_SITE_NAMES: Readonly<Record<SiteSocialSite, string>> = {
	discord: 'Discord',
	facebook: 'Facebook',
	instagram: 'Instagram',
	tiktok: 'TikTok',
	x: 'X',
	youtube: 'YouTube'
};

/**
 * Each social site's logo, as SVG markup hidden from screen readers
 */
const SOCIAL_SITE_ICONS: Readonly<Record<SiteSocialSite, string>> = {
	discord: discordIcon,
	facebook: facebookIcon,
	instagram: instagramIcon,
	tiktok: tiktokIcon,
	x: xIcon,
	youtube: youtubeIcon
};

/**
 * A social site's logo, hidden from screen readers, so the text beside it or the label of what holds
 * it names the site
 *
 * @param site The social site
 * @return The logo
 */
export function socialSiteIcon(site: SiteSocialSite): DocumentFragment
{
	const template = document.createElement('template');

	template.innerHTML = SOCIAL_SITE_ICONS[site];

	return(template.content);
}
