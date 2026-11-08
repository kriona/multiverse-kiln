import leaveIcon from 'virtual:icon/ph:sign-out';

import { t } from '../../localization';
import { describeEditorError, type EditorApi } from '../../network/editorApi';
import { currentPageAddress, HOME_PAGE_URL, twoFactorSetupPageUrl } from '../../pages';
import { askToConfirm } from '../confirmDialog';
import { getElement, showMessage, showScreen } from '../dom';
import { editorTitleLink, setEditorPageTitle } from './EditorScreen';

/**
 * The page the editor shows in place of a universe that requires its editors to have 2FA on, to a
 * player without it: why, with a link to turn it on, Leave Universe (the only change they may save)
 * and a link to Home
 */
export class EditorTwoFactorScreen
{
	private readonly title = getElement('editor-two-factor-title', HTMLElement);
	private readonly message = getElement('editor-two-factor-message', HTMLElement);
	private readonly setupLink = getElement('editor-two-factor-link', HTMLAnchorElement);
	private readonly error = getElement('editor-two-factor-error', HTMLElement);
	private readonly leaveButton = getElement('editor-two-factor-leave', HTMLButtonElement);

	/**
	 * The player, once the browser is known to be logged in
	 */
	private playerId: string | undefined;

	/**
	 * Whether the page shows it, which keeps the page from showing the editor again
	 */
	private shown = false;

	/**
	 * @param api The editor's API
	 * @param universeId The universe
	 */
	constructor(private readonly api: EditorApi, private readonly universeId: string)
	{
		this.leaveButton.addEventListener('click', () =>
		{
			void this.leave();
		});
	}

	/**
	 * Remembers the player, who leaving takes out of the universe's editors
	 *
	 * @param playerId The player's ID
	 */
	setPlayer(playerId: string): void
	{
		this.playerId = playerId;
	}

	/**
	 * Whether the page shows it
	 *
	 * @return True once show() has been called
	 */
	isShown(): boolean
	{
		return(this.shown);
	}

	/**
	 * Shows it in place of the editor, its toolbar and the browser tab's title naming the universe as the
	 * editor's do
	 *
	 * @param message Why, in the player's language, naming the universe
	 * @param universeName The universe's name, or undefined to leave the toolbar's heading and the tab's
	 * title as they are
	 */
	show(message: string, universeName: string | undefined): void
	{
		this.shown = true;

		if (universeName !== undefined)
		{
			this.title.replaceChildren(editorTitleLink(this.universeId, universeName));
			setEditorPageTitle(universeName);
		}

		this.message.textContent = message;

		// Back to the editor once 2FA is on, which then opens the universe
		this.setupLink.href = twoFactorSetupPageUrl(currentPageAddress());
		showMessage(this.error, undefined);
		showScreen('editor-two-factor');
	}

	/**
	 * Takes the player out of the universe's editors once they confirm, then goes Home. A save that only
	 * leaves is the one the server takes from them; one it refuses, such as from its last creator, says why
	 */
	private async leave(): Promise<void>
	{
		const playerId = this.playerId;

		if (playerId === undefined)
		{
			return;
		}

		const confirmed = await askToConfirm({
			title: t({
				id: 'editor.twoFactorLeaveTitle',
				defaultMessage: 'Leave this universe?',
				description: 'Title of the dialog asking a player to confirm leaving a universe, from the page the world editor shows in place of a universe that requires its editors to have two-factor authentication on, to a player without it'
			}),
			question: t({
				id: 'editor.twoFactorLeaveQuestion',
				defaultMessage: 'You lose your role in this universe and can no longer open it in the editor. Only a creator can give you a role again.',
				description: 'Asked before a player leaves a universe from the page the world editor shows in place of a universe that requires its editors to have two-factor authentication on, to a player without it'
			}),
			confirmLabel: t({
				id: 'editor.twoFactorLeave',
				defaultMessage: 'Leave Universe',
				description: 'Button on the page the world editor shows in place of a universe that requires its editors to have two-factor authentication on, to a player without it: gives up their role in the universe, after asking'
			}),
			confirmIcon: leaveIcon
		});

		if (!confirmed)
		{
			return;
		}

		// Leaving changes the universe whichever version the address named, and a draft named may be gone
		this.api.version = 'live';
		showMessage(this.error, undefined);

		try
		{
			await this.api.saveChanges(this.universeId, [{ kind: 'removeEditor', playerId }]);
		}
		catch (error)
		{
			showMessage(this.error, describeEditorError(error, {
				id: 'editor.twoFactorLeaveFailed',
				defaultMessage: 'Could not leave the universe.',
				description: 'Shown on the page the world editor shows in place of a universe that requires its editors to have two-factor authentication on, when leaving the universe failed, followed by why'
			}));
			return;
		}

		window.location.assign(HOME_PAGE_URL);
	}
}
