import { SessionServerMessageType, type AccountPayload } from '@multiverse-kiln/shared';

import { AdminApi } from './network/adminApi';
import { EditorApiError } from './network/editorApi';
import { createClient, type ServerConnection } from './network/serverConnection';
import { startPage } from './pageStart';
import { currentPageAddress, loginPageUrl } from './pages';
import { getElement, setPageTitle } from './ui/dom';

/**
 * Starts one of the admin pages (admin.html, which links to the others, and admin/settings.html,
 * admin/sessions.html, admin/players.html, admin/admins.html, admin/universes.html and
 * admin/translations.html) in the player's language, then loads what it shows. Only
 * server admins can use them: the page shows why when the server refuses (showAdminRefusal())
 *
 * The pages load what they show over HTTP, so they don't wait for the session room. It tells them when
 * the browser isn't logged in, such as after logging out in another window, and they go to the login page
 *
 * @param show Loads and shows the page's content
 */
export async function startAdminPage(show: (api: AdminApi) => Promise<void>): Promise<void>
{
	const { server } = await startPage();

	setPageTitle(document.title);
	void followLogin(server);
	await show(new AdminApi(createClient()));
}

/**
 * Goes to the login page, which comes back here, whenever the session room says the browser isn't
 * logged in
 *
 * @param connection The page's connection to the server (startPage())
 */
async function followLogin(connection: Promise<ServerConnection>): Promise<void>
{
	let server: ServerConnection;

	try
	{
		server = await connection;
	}
	catch
	{
		return;
	}

	server.session.onMessage(SessionServerMessageType.Account, (account: AccountPayload) =>
	{
		if (!account.player)
		{
			window.location.replace(loginPageUrl(currentPageAddress()));
		}
	});
}

/**
 * Shows, in place of the page's content, why the server refused to load it: a browser that isn't logged
 * in goes to the login page, which comes back here, and a player who isn't a server admin is told so
 *
 * @param error What loading the page's content threw
 * @return Whether it was such a refusal; anything else is left to the page to show
 */
export function showAdminRefusal(error: unknown): boolean
{
	if (!(error instanceof EditorApiError))
	{
		return(false);
	}

	if (error.status === 401)
	{
		window.location.replace(loginPageUrl(currentPageAddress()));
		return(true);
	}

	if (error.status !== 403)
	{
		return(false);
	}

	const content = getElement('admin-content', HTMLElement);
	const message = getElement('admin-refusal-message', HTMLElement);
	const hadFocus = content.contains(document.activeElement);

	content.hidden = true;
	message.textContent = error.message;
	getElement('admin-refusal', HTMLElement).hidden = false;

	// Hiding the content takes focus to the top of the page, as after an admin removes themself
	if (hadFocus)
	{
		message.focus();
	}

	return(true);
}
