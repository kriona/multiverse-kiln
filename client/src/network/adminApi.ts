import type { Client } from '@colyseus/sdk';
import { ADMIN_PATH, ADMIN_PLAYERS_PATH, ADMIN_SESSIONS_PATH, PUBLIC_SITE_SETTINGS_PATH, SITE_SETTINGS_PATH, type AdminPlayerListPayload, type AdminPlayerListQuery, type AdminSessionListPayload, type AdminSessionListQuery, type PublicSiteSettings, type SiteSettings } from '@multiverse-kiln/shared';

import { queryString, sendRequest } from './editorApi';

/**
 * The admin pages' routes (see shared/src/admin.ts and shared/src/siteSettings.ts), which only server
 * admins with 2FA on may use, and the settings any page may read
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
	 * Checks that the player may use the admin pages
	 */
	async checkAccess(): Promise<void>
	{
		await sendRequest(this.client, 'GET', ADMIN_PATH);
	}

	/**
	 * The settings any page may read, such as the footer's social links
	 *
	 * @return The settings
	 */
	async getPublicSiteSettings(): Promise<PublicSiteSettings>
	{
		return(sendRequest<PublicSiteSettings>(this.client, 'GET', PUBLIC_SITE_SETTINGS_PATH));
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

	/**
	 * A page of the login sessions still going
	 *
	 * @param query The search, filter and page
	 * @return The page, and how many sessions match
	 */
	async listSessions(query: AdminSessionListQuery): Promise<AdminSessionListPayload>
	{
		return(sendRequest<AdminSessionListPayload>(this.client, 'GET', `${ADMIN_SESSIONS_PATH}?${queryString(query)}`));
	}

	/**
	 * A page of the player accounts
	 *
	 * @param query The search, filter and page
	 * @return The page, and how many players match
	 */
	async listPlayers(query: AdminPlayerListQuery): Promise<AdminPlayerListPayload>
	{
		return(sendRequest<AdminPlayerListPayload>(this.client, 'GET', `${ADMIN_PLAYERS_PATH}?${queryString(query)}`));
	}
}
