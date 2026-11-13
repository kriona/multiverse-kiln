import type { Client } from '@colyseus/sdk';
import { ADMIN_ADMINS_PATH, ADMIN_ADMINS_SEARCH_PATH, ADMIN_PATH, ADMIN_PLAYERS_PATH, ADMIN_SESSIONS_PATH, ADMIN_UNIVERSES_PATH, PUBLIC_SITE_SETTINGS_PATH, SITE_SETTINGS_PATH, type AdminPlayerListPayload, type AdminPlayerListQuery, type AdminSessionListPayload, type AdminSessionListQuery, type AdminSiteSettingsPayload, type AdminUniverseListPayload, type AdminUniverseListQuery, type PlayerMatch, type PlayerSearchPayload, type PlayerSearchQuery, type PublicSiteSettings, type ServerAdminListPayload, type ServerAdminRequest, type ServerAdminSummary, type SiteSettings, type UniverseDeleteRequest, type UniverseDisableRequest, UNIVERSE_DELETION_PATH } from '@multiverse-kiln/shared';

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
	 * @return The settings, and whether bot checks are configured
	 */
	async getSiteSettings(): Promise<AdminSiteSettingsPayload>
	{
		return(sendRequest<AdminSiteSettingsPayload>(this.client, 'GET', SITE_SETTINGS_PATH));
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

	/**
	 * Every server admin
	 *
	 * @return The admins, by username
	 */
	async listAdmins(): Promise<ServerAdminSummary[]>
	{
		return((await sendRequest<ServerAdminListPayload>(this.client, 'GET', ADMIN_ADMINS_PATH)).admins);
	}

	/**
	 * Players who could be made server admins
	 *
	 * @param query What was typed: a name or username, or @ and a username
	 * @return The players, best matches first
	 */
	async searchAdminCandidates(query: PlayerSearchQuery): Promise<PlayerMatch[]>
	{
		return((await sendRequest<PlayerSearchPayload>(this.client, 'GET', `${ADMIN_ADMINS_SEARCH_PATH}?${queryString(query)}`)).players);
	}

	/**
	 * Makes a player a server admin
	 *
	 * @param request The player's username
	 */
	async addAdmin(request: ServerAdminRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', ADMIN_ADMINS_PATH, request);
	}

	/**
	 * Takes away a player's server admin role
	 *
	 * @param username The player's username
	 */
	async removeAdmin(username: string): Promise<void>
	{
		await sendRequest(this.client, 'DELETE', `${ADMIN_ADMINS_PATH}/${encodeURIComponent(username)}`);
	}

	/**
	 * A page of the universes
	 *
	 * @param query The search, filter and page
	 * @return The page, and how many universes match
	 */
	async listUniverses(query: AdminUniverseListQuery): Promise<AdminUniverseListPayload>
	{
		return(sendRequest<AdminUniverseListPayload>(this.client, 'GET', `${ADMIN_UNIVERSES_PATH}?${queryString(query)}`));
	}

	/**
	 * Disables a universe
	 *
	 * @param universeId The universe's ID
	 * @param request Why, which its editors are shown
	 */
	async disableUniverse(universeId: string, request: UniverseDisableRequest): Promise<void>
	{
		await sendRequest(this.client, 'PUT', `${ADMIN_UNIVERSES_PATH}/${encodeURIComponent(universeId)}/disabled`, request);
	}

	/**
	 * Enables a disabled universe again
	 *
	 * @param universeId The universe's ID
	 */
	async enableUniverse(universeId: string): Promise<void>
	{
		await sendRequest(this.client, 'DELETE', `${ADMIN_UNIVERSES_PATH}/${encodeURIComponent(universeId)}/disabled`);
	}

	/**
	 * Deletes a universe as a server admin, which is recorded
	 *
	 * @param universeId The universe's ID
	 * @param request How the admin confirms it
	 */
	async deleteUniverse(universeId: string, request: UniverseDeleteRequest): Promise<void>
	{
		await sendRequest(this.client, 'POST', `${ADMIN_UNIVERSES_PATH}/${encodeURIComponent(universeId)}${UNIVERSE_DELETION_PATH}`, request);
	}
}
