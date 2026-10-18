import type { Client } from '@colyseus/sdk';
import { SITE_SETTINGS_PATH, type SiteSettings } from '@multiverse-kiln/shared';

import { sendRequest } from './editorApi';

/**
 * The admin page's routes (see shared/src/siteSettings.ts)
 *
 * Every method throws EditorApiError when the server refuses the request
 */
export class AdminApi
{
	/**
	 * @param client Client for the server
	 */
	constructor(private readonly client: Client)
	{
	}

	/**
	 * The site's settings
	 *
	 * @return The settings
	 */
	async getSiteSettings(): Promise<SiteSettings>
	{
		return(sendRequest<SiteSettings>(this.client, 'GET', SITE_SETTINGS_PATH));
	}

	/**
	 * Replaces the site's settings
	 *
	 * @param settings The settings
	 */
	async saveSiteSettings(settings: SiteSettings): Promise<void>
	{
		await sendRequest(this.client, 'PUT', SITE_SETTINGS_PATH, settings);
	}
}
