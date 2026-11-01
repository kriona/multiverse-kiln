import { ADMIN_TWO_FACTOR_ERROR_ID, SessionServerMessageType, type AccountPayload } from '@multiverse-kiln/shared';

import { AdminApi } from './network/adminApi';
import { EditorApiError } from './network/editorApi';
import { createClient, type ServerConnection } from './network/serverConnection';
import { startPage } from './pageStart';
import { currentPageAddress, loginPageUrl } from './pages';
import { getElement, setPageTitle } from './ui/dom';

/**
 * Starts one of the admin pages (admin.html, which links to the others, and admin/settings.html,
 * admin/sessions.html and admin/players.html) in the player's language, then loads what it shows. Only
 * server admins with 2FA on can use them: the page shows why when the server refuses (showAdminRefusal())
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
 * in goes to the login page, which comes back here, a player who isn't a server admin is told so, and
 * an admin without 2FA is offered a link to turn it on
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

	getElement('admin-content', HTMLElement).hidden = true;
	getElement('admin-refusal-message', HTMLElement).textContent = error.message;
	getElement('admin-two-factor-link', HTMLAnchorElement).hidden = (errorId(error.data) !== ADMIN_TWO_FACTOR_ERROR_ID);
	getElement('admin-refusal', HTMLElement).hidden = false;

	return(true);
}

/**
 * The ID of the message an error response carries (ErrorPayload)
 *
 * @param data The response's body
 * @return The ID, or undefined when the body isn't an ErrorPayload
 */
function errorId(data: unknown): string | undefined
{
	if ((typeof data !== 'object') || (data === null) || !('error' in data))
	{
		return(undefined);
	}

	const { error } = data;

	return((((typeof error === 'object') && (error !== null) && ('id' in error) && (typeof error.id === 'string')) ? error.id : undefined));
}
