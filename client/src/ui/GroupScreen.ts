import { defineMessages, GROUP_QUERY_PARAMETER } from '@multiverse-kiln/shared';

import { t } from '../localization';
import type { GameConnection } from '../network/serverConnection';
import { getElement } from './dom';
import type { MapView } from './MapView';

/**
 * How long the Share button's confirmation stays up, in milliseconds
 */
const SHARE_CONFIRMATION_MS = 3000;

/**
 * Text the group screen shows in more than one place (see src/localization.ts)
 */
const messages = defineMessages({
	joining: {
		id: 'group.joining',
		defaultMessage: 'Joining...',
		description: 'Shown in the game\'s toolbar while the player goes into the game'
	}
});

/**
 * Builds the link that lets another player join a group
 *
 * @param groupId The group's ID
 * @return The page's URL with the group in its query string
 */
export function buildJoinLink(groupId: string): string
{
	const url = new URL(window.location.pathname, window.location.origin);

	url.searchParams.set(GROUP_QUERY_PARAMETER, groupId);

	return(url.toString());
}

/**
 * The group screen: the game's map, and the Share and Leave group buttons
 */
export class GroupScreen
{
	private readonly status = getElement('group-status', HTMLElement);
	private readonly shareButton = getElement('share-group', HTMLButtonElement);
	private readonly leaveButton = getElement('leave-group', HTMLButtonElement);
	private readonly map = getElement('group-map', HTMLElement);
	private groupId?: string;
	private statusTimer?: number;

	/**
	 * @param mapView The map, shared with the lobby screen
	 * @param onLeave Called when the player presses Leave group
	 */
	constructor(private readonly mapView: MapView, onLeave: () => void)
	{
		this.shareButton.addEventListener('click', () =>
		{
			void this.share();
		});

		this.leaveButton.addEventListener('click', () =>
		{
			this.leaveButton.disabled = true;
			onLeave();
		});
	}

	/**
	 * Gets the screen ready while the group's room is being joined
	 *
	 * @param groupId The group's ID
	 */
	prepare(groupId: string): void
	{
		this.groupId = groupId;
		this.leaveButton.disabled = false;
		document.title = t({
			id: 'group.pageTitle',
			defaultMessage: 'Game - Multiverse Kiln',
			description: 'The browser tab\'s title while the player is in a group\'s game; Multiverse Kiln is the game engine\'s name'
		});
		this.setStatus(t(messages.joining));
	}

	/**
	 * Starts drawing a joined group's room
	 *
	 * @param connection The joined room
	 */
	start(connection: GameConnection): void
	{
		// Keeps any message that arrived while joining
		if (this.status.textContent === t(messages.joining))
		{
			this.setStatus('');
		}

		this.mapView.show(this.map, connection);
	}

	/**
	 * Stops drawing the group's room; the caller leaves the room
	 */
	stop(): void
	{
		this.groupId = undefined;
		this.mapView.hide();
	}

	/**
	 * Copies the group's join link to the clipboard, or shows it when the browser won't allow that
	 */
	private async share(): Promise<void>
	{
		if (this.groupId === undefined)
		{
			return;
		}

		const link = buildJoinLink(this.groupId);

		// Shown first, so the link is there to copy by hand if the browser refuses the clipboard or never answers
		this.setStatus(t({
			id: 'group.joinLink',
			defaultMessage: 'Join link: {link}',
			description: 'Shown in the game\'s toolbar after pressing Share; {link} is the address others can open to join'
		}, {
			link
		}));

		try
		{
			await navigator.clipboard.writeText(link);
			this.setStatus(t({
				id: 'group.joinLinkCopied',
				defaultMessage: 'Join link copied. Send it to the players you want to invite.',
				description: 'Shown in the game\'s toolbar when Share has copied the join link to the clipboard'
			}), SHARE_CONFIRMATION_MS);
		}
		catch (error)
		{
			console.warn('Could not copy the join link:', error);
		}
	}

	/**
	 * Shows a message in the toolbar
	 *
	 * @param message Text to show; empty to clear it
	 * @param durationMs How long to show it, or undefined to keep it until the next message
	 */
	setStatus(message: string, durationMs?: number): void
	{
		window.clearTimeout(this.statusTimer);
		this.status.textContent = message;

		if (durationMs !== undefined)
		{
			this.statusTimer = window.setTimeout(() =>
			{
				this.status.textContent = '';
			}, durationMs);
		}
	}
}
