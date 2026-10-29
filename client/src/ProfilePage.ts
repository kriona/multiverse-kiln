import { SessionServerMessageType, type AccountPayload } from '@multiverse-kiln/shared';

import { t } from './localization';
import { AuthApi } from './network/authApi';
import { CharacterApi } from './network/characterApi';
import { EditorApiError } from './network/editorApi';
import { ProfileApi } from './network/profileApi';
import type { ServerConnection } from './network/serverConnection';
import { isLeavingPage } from './pageLifecycle';
import { currentPageAddress, loginPageUrl } from './pages';
import { CharacterSheetDialog } from './ui/CharacterSheetDialog';
import { showNoticeScreen, showStatus } from './ui/dom';
import { OwnProfileScreen } from './ui/OwnProfileScreen';
import { pageMessages } from './ui/pageMessages';
import { PlayerProfileScreen } from './ui/PlayerProfileScreen';

/**
 * Runs the profile page (profile.html): the player's own profile at /profile, where they change it, or
 * another player's at /player/<username>, as players see it (see Profile edit and Profile view in
 * STRUCTURE-OVERVIEW.md). Both need a login: a browser that isn't logged in goes to the login page,
 * which comes back here
 *
 * Like Create Character, the page joins the session room, so being open counts as using the session
 */
export class ProfilePage
{
	private readonly profileApi: ProfileApi;
	private readonly authApi: AuthApi;
	private readonly characterApi: CharacterApi;

	/**
	 * The player's own profile, once it is shown
	 */
	private ownScreen: OwnProfileScreen | undefined;

	/**
	 * Whether the profile has been loaded; it loads once, the first time the browser is logged in
	 */
	private loaded = false;

	/**
	 * @param server The connection to the server and the joined session room
	 * @param username The player whose profile the address names, or undefined for the player's own
	 */
	constructor(server: ServerConnection, private readonly username: string | undefined)
	{
		const { client, session } = server;

		this.profileApi = new ProfileApi(client);
		this.authApi = new AuthApi(client);
		this.characterApi = new CharacterApi(client);

		session.onMessage(SessionServerMessageType.Account, (account: AccountPayload) =>
		{
			this.onAccount(account);
		});

		session.onLeave(() =>
		{
			if (!isLeavingPage())
			{
				showStatus(t(pageMessages.disconnected));
			}
		});
	}

	/**
	 * Loads the profile the first time the browser is logged in, and goes to the login page when it isn't
	 *
	 * @param account The browser's player
	 */
	private onAccount(account: AccountPayload): void
	{
		if (!account.player)
		{
			window.location.replace(loginPageUrl(currentPageAddress()));
			return;
		}

		if (!this.loaded)
		{
			this.loaded = true;
			void this.load();
		}
	}

	/**
	 * Shows the profile the address names, or a notice when it can't
	 */
	private async load(): Promise<void>
	{
		showStatus(t(pageMessages.loading));

		try
		{
			if (this.username === undefined)
			{
				const sheet = new CharacterSheetDialog(this.characterApi, () =>
				{
					void this.ownScreen?.reloadCharacters();
				});

				this.ownScreen = new OwnProfileScreen(this.profileApi, this.authApi, sheet);
				await this.ownScreen.load();
			}
			else
			{
				new PlayerProfileScreen().show(await this.profileApi.getPlayerProfile(this.username));
			}
		}
		catch (error)
		{
			console.error('Could not load the profile:', error);
			showNoticeScreen((((error instanceof EditorApiError) && (error.status === 404)) ? t({
				id: 'profile.notFound',
				defaultMessage: 'No player has that username. They may have changed it.',
				description: 'Shown on the whole of a player\'s profile page when no player has the username its address names'
			}) : t({
				id: 'profile.loadFailed',
				defaultMessage: 'Could not load the profile. Reload the page to try again.',
				description: 'Shown on the whole of a profile page when the profile couldn\'t be loaded, such as when the server can\'t be reached'
			})), t({
				id: 'profile.unavailableTitle',
				defaultMessage: 'Profile',
				description: 'The browser tab\'s title on a profile page when the profile couldn\'t be shown, before the game engine\'s name'
			}));
		}
	}
}
