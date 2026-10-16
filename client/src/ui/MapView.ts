import Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH } from '@multiverse-kiln/shared';

import type { MapConnection, MapRoom } from '../network/serverConnection';
import { MAP_SCENE_KEY, MapScene, type MapSceneData } from '../scenes/MapScene';

/**
 * The map the lobby and group screens show: one Phaser game, whose canvas moves to whichever screen is
 * showing a map, running a fresh start of the map scene for each room
 *
 * The game is created the first time a map is shown and kept afterward
 */
export class MapView
{
	private game?: Phaser.Game;

	/**
	 * Shows a joined room's map in an element
	 *
	 * @param parent The element to show the map in
	 * @param connection The joined room
	 */
	show(parent: HTMLElement, connection: MapConnection<MapRoom>): void
	{
		const data: MapSceneData = { connection };

		if (!this.game)
		{
			// One world unit is one pixel; the camera follows the player around zones larger than the canvas
			this.game = new Phaser.Game({
				type: Phaser.WEBGL,
				parent,
				width: VIEW_WIDTH,
				height: VIEW_HEIGHT,
				backgroundColor: '#1d1f27',
				scene: []
			});

			this.game.scene.add(MAP_SCENE_KEY, MapScene, true, data);
			return;
		}

		if (this.game.canvas.parentElement !== parent)
		{
			parent.append(this.game.canvas);
		}

		this.game.scene.start(MAP_SCENE_KEY, data);
	}

	/**
	 * Stops drawing a map; whoever joined the room leaves it
	 */
	hide(): void
	{
		this.game?.scene.stop(MAP_SCENE_KEY);
	}
}
