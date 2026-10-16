import Phaser from 'phaser';
import type { EditorTile, EditorZone, ZonePayload } from '@multiverse-kiln/shared';

import { MAP_EDITOR_SCENE_KEY, MapEditorScene, type CameraState, type MapEditorHost } from '../scenes/MapEditorScene';

/**
 * A canvas showing a zone's map in the map editor scene: one Phaser game, created the first time a
 * map is shown, running a fresh start of the scene for each map
 */
export class MapCanvas
{
	private game?: Phaser.Game;
	private current?: MapEditorScene;

	/**
	 * @param parent The element the canvas goes in
	 * @param width The canvas's width in pixels
	 * @param height The canvas's height in pixels
	 */
	constructor(private readonly parent: HTMLElement, private readonly width: number, private readonly height: number)
	{
	}

	/**
	 * The scene showing the map, once it is ready
	 *
	 * @return The scene, or undefined while none is showing
	 */
	get scene(): MapEditorScene | undefined
	{
		return(this.current);
	}

	/**
	 * Shows a map in place of the one before
	 *
	 * @param zone The zone, with the tiles its map can use
	 * @param chunks The zone's loaded chunks, by chunkKey(); the host changes them and calls refreshChunks
	 * @param host Decides what clicks do and hears what happens
	 * @param camera Where the camera starts, or undefined for the zone's center cell
	 * @return The scene, once it is ready
	 */
	show(zone: ZonePayload, chunks: ReadonlyMap<string, readonly number[]>, host: MapEditorHost, camera?: CameraState): Promise<MapEditorScene>
	{
		this.current = undefined;

		return(new Promise((resolve) =>
		{
			const data = {
				zone,
				chunks,
				host,
				camera,
				onReady: (scene: MapEditorScene) =>
				{
					this.current = scene;
					resolve(scene);
				}
			};

			if (!this.game)
			{
				// The editor uses no keys, so the game mustn't take any from the page's text fields
				this.game = new Phaser.Game({
					type: Phaser.WEBGL,
					parent: this.parent,
					width: this.width,
					height: this.height,
					backgroundColor: '#111111',
					input: { keyboard: false },
					scene: []
				});
				this.game.scene.add(MAP_EDITOR_SCENE_KEY, MapEditorScene, true, data);
				return;
			}

			this.game.scene.start(MAP_EDITOR_SCENE_KEY, data);
		}));
	}

	/**
	 * Stops showing a map
	 */
	stop(): void
	{
		this.current = undefined;
		this.game?.scene.stop(MAP_EDITOR_SCENE_KEY);
	}
}

/**
 * What the map editor scene needs to draw a zone
 *
 * @param zone The zone as the editor knows it
 * @param tiles Every tile the universe can use
 * @return The zone in the form the renderer draws, without chunks (they are passed separately)
 */
export function editorZonePayload(zone: EditorZone, tiles: readonly EditorTile[]): ZonePayload
{
	return({
		zoneId: zone.id,
		name: zone.name,
		indoors: zone.indoors,
		bounds: zone.bounds,
		loopsEastWest: zone.loopsEastWest,
		loopsNorthSouth: zone.loopsNorthSouth,
		defaultTileId: zone.defaultTileId,
		tiles: tiles.map((tile) => ({
			id: tile.id,
			name: tile.name,
			color: tile.color
		})),
		chunks: [],
		links: []
	});
}
