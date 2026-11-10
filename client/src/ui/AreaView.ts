import Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH } from '@multiverse-kiln/shared';

import type { AreaConnection, AreaRoom } from '../network/serverConnection';
import { sleepGameLoop, wakeGameLoop } from '../rendering/gameLoop';
import { startScene } from '../rendering/sceneStart';
import { AREA_SCENE_KEY, AreaScene, type AreaSceneData } from '../scenes/AreaScene';
import type { UniverseText } from './universeText';

/**
 * The area the lobby and group screens show: one Phaser game, whose canvas moves to whichever screen is
 * showing an area, running a fresh start of the area scene for each room
 *
 * The game is created the first time an area is shown and kept afterward
 */
export class AreaView
{
	private game?: Phaser.Game;

	/**
	 * The names of the universe being played, in the player's language, once the page knows the universe
	 */
	private text: UniverseText | undefined;

	/**
	 * Names the areas shown from now on with a universe's text
	 *
	 * @param text The universe's text
	 */
	useText(text: UniverseText): void
	{
		this.text = text;
	}

	/**
	 * Shows a joined room's area in an element
	 *
	 * @param parent The element to show the area in
	 * @param connection The joined room
	 */
	show(parent: HTMLElement, connection: AreaConnection<AreaRoom>): void
	{
		const data: AreaSceneData = {
			connection,
			text: this.text
		};

		if (!this.game)
		{
			// One world unit is one pixel; the camera follows the player around areas larger than the canvas
			this.game = new Phaser.Game({
				type: Phaser.WEBGL,
				parent,
				width: VIEW_WIDTH,
				height: VIEW_HEIGHT,
				backgroundColor: '#1d1f27',
				scene: []
			});

			this.game.scene.add(AREA_SCENE_KEY, AreaScene, true, data);
			return;
		}

		if (this.game.canvas.parentElement !== parent)
		{
			parent.append(this.game.canvas);
		}

		wakeGameLoop(this.game);
		startScene(this.game, AREA_SCENE_KEY, data);
	}

	/**
	 * Stops drawing an area, and the game's loop with it; whoever joined the room leaves it
	 */
	hide(): void
	{
		if (this.game)
		{
			this.game.scene.stop(AREA_SCENE_KEY);
			sleepGameLoop(this.game);
		}
	}
}
