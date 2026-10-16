import Phaser from 'phaser';
import { GROUP_QUERY_PARAMETER, VIEW_HEIGHT, VIEW_WIDTH } from '@multiverse-kiln/shared';

import type { GameConnection } from '../network/serverConnection';
import { GAME_SCENE_KEY, GameScene, type GameSceneData } from '../scenes/GameScene';
import { getElement } from './dom';

/**
 * How long the Share button's confirmation stays up, in milliseconds
 */
const SHARE_CONFIRMATION_MS = 3000;

const JOINING_MESSAGE = 'Joining...';

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
 * The group screen: the game, and the Share and Leave group buttons
 *
 * The Phaser game is created the first time a group is shown and kept afterward; each group runs a
 * fresh start of the game scene
 */
export class GroupScreen
{
	private readonly status = getElement('group-status', HTMLElement);
	private readonly shareButton = getElement('share-group', HTMLButtonElement);
	private readonly leaveButton = getElement('leave-group', HTMLButtonElement);
	private game?: Phaser.Game;
	private groupId?: string;
	private statusTimer?: number;

	/**
	 * @param onLeave Called when the player presses Leave group
	 */
	constructor(onLeave: () => void)
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
		this.setStatus(JOINING_MESSAGE);
	}

	/**
	 * Starts drawing a joined group's room
	 *
	 * @param connection The joined room
	 */
	start(connection: GameConnection): void
	{
		const data: GameSceneData = { connection };

		// Keeps any message that arrived while joining
		if (this.status.textContent === JOINING_MESSAGE)
		{
			this.setStatus('');
		}

		if (!this.game)
		{
			// One world unit is one pixel; the camera follows the player around zones larger than the canvas
			this.game = new Phaser.Game({
				type: Phaser.WEBGL,
				parent: 'game',
				width: VIEW_WIDTH,
				height: VIEW_HEIGHT,
				backgroundColor: '#1d1f27',
				scene: []
			});

			this.game.scene.add(GAME_SCENE_KEY, GameScene, true, data);
		}
		else
		{
			this.game.scene.start(GAME_SCENE_KEY, data);
		}
	}

	/**
	 * Stops drawing the group's room; the caller leaves the room
	 */
	stop(): void
	{
		this.groupId = undefined;
		this.game?.scene.stop(GAME_SCENE_KEY);
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
		this.setStatus(`Join link: ${link}`);

		try
		{
			await navigator.clipboard.writeText(link);
			this.setStatus('Join link copied. Send it to the players you want to invite.', SHARE_CONFIRMATION_MS);
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
