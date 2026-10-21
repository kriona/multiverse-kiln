import Phaser from 'phaser';
import type { EditorTile, EditorArea, MapBounds, Ruleset, AreaPayload } from '@multiverse-kiln/shared';

import { MAP_EDITOR_SCENE_KEY, MapEditorScene, type CameraState, type MapEditorHost } from '../scenes/MapEditorScene';
import { announce } from '../ui/announcer';
import { cellsBetween, type BrushCell } from './brush';

/**
 * How many cells the keyboard's cursor moves at a time with Shift held
 */
const FAST_CURSOR_STEP = 10;

/**
 * Which way each arrow key moves the keyboard's cursor
 */
const ARROW_STEPS: Record<string, BrushCell> = {
	ArrowLeft: { column: -1, row: 0 },
	ArrowRight: { column: 1, row: 0 },
	ArrowUp: { column: 0, row: -1 },
	ArrowDown: { column: 0, row: 1 }
};

/**
 * A canvas showing an area's map in the map editor scene: one Phaser game, created the first time a
 * map is shown, running a fresh start of the scene for each map
 *
 * The canvas's element can be focused, and then the keyboard works the map with a cursor: the arrow
 * keys move it (FAST_CURSOR_STEP cells at a time with Shift), Space or Enter paints or picks its cell
 * as a click does, holding Space while moving keeps painting as a drag does, + and - zoom, and Home
 * goes back to the center cell. Each cell the cursor moves onto is read out to screen readers
 */
export class MapCanvas
{
	private game?: Phaser.Game;
	private current?: MapEditorScene;
	private host?: MapEditorHost;
	private bounds?: MapBounds;

	/**
	 * The keyboard's cursor, once the map has had focus
	 */
	private cursor: BrushCell | undefined;

	/**
	 * Whether Space is held to paint a stroke along the cursor's path
	 */
	private painting = false;

	/**
	 * @param parent The element the canvas goes in, which takes focus for the keyboard
	 * @param width The canvas's width in pixels
	 * @param height The canvas's height in pixels
	 */
	constructor(private readonly parent: HTMLElement, private readonly width: number, private readonly height: number)
	{
		parent.addEventListener('keydown', this.onKeyDown);
		parent.addEventListener('keyup', this.onKeyUp);
		parent.addEventListener('focus', this.onFocus);
		parent.addEventListener('blur', this.stopPainting);
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
	 * @param area The area, with the tiles its map can use
	 * @param chunks The area's loaded chunks, by chunkKey(); the host changes them and calls refreshChunks
	 * @param host Decides what clicks do and hears what happens
	 * @param camera Where the camera starts, or undefined for the area's center cell
	 * @return The scene, once it is ready
	 */
	show(area: AreaPayload, chunks: ReadonlyMap<string, readonly number[]>, host: MapEditorHost, camera?: CameraState): Promise<MapEditorScene>
	{
		const { bounds } = area;

		this.stopPainting();
		this.current = undefined;
		this.host = host;
		this.bounds = bounds;

		if (this.cursor && ((this.cursor.column < bounds.minColumn) || (this.cursor.column > bounds.maxColumn) || (this.cursor.row < bounds.minRow) || (this.cursor.row > bounds.maxRow)))
		{
			this.cursor = undefined;
		}

		return(new Promise((resolve) =>
		{
			const data = {
				area,
				chunks,
				host,
				camera,
				onReady: (scene: MapEditorScene) =>
				{
					this.current = scene;

					if (this.cursor && (document.activeElement === this.parent))
					{
						scene.showCursor(this.cursor);
					}

					resolve(scene);
				}
			};

			if (!this.game)
			{
				// The canvas's element handles the keyboard itself (see onKeyDown), so the game mustn't take
				// keys from the page's text fields
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
		this.stopPainting();
		this.current = undefined;
		this.host = undefined;
		this.game?.scene.stop(MAP_EDITOR_SCENE_KEY);
	}

	/**
	 * Puts the keyboard's cursor on the map when it takes focus: where it was, or the center cell
	 */
	private readonly onFocus = (): void =>
	{
		this.moveCursor((this.cursor ?? { column: 0, row: 0 }));
	};

	/**
	 * Moves the cursor, uses the tool on its cell, zooms or goes back to the center cell
	 *
	 * @param event The key press on the map
	 */
	private readonly onKeyDown = (event: KeyboardEvent): void =>
	{
		if ((event.target !== this.parent) || event.altKey || event.ctrlKey || event.metaKey)
		{
			return;
		}

		const arrow = ARROW_STEPS[event.key];
		const cursor = (this.cursor ?? { column: 0, row: 0 });

		if (arrow)
		{
			const step = (event.shiftKey ? FAST_CURSOR_STEP : 1);

			this.moveCursor({
				column: cursor.column + (arrow.column * step),
				row: cursor.row + (arrow.row * step)
			});
		}
		else if ((event.key === ' ') || (event.key === 'Enter'))
		{
			if (!event.repeat)
			{
				this.useTool(cursor, (event.key === ' '));
			}
		}
		else if ((event.key === '+') || (event.key === '=') || (event.key === '-'))
		{
			this.current?.zoomStep(event.key !== '-');
		}
		else if (event.key === 'Home')
		{
			this.moveCursor({ column: 0, row: 0 });
		}
		else
		{
			return;
		}

		// The keys would otherwise scroll the page
		event.preventDefault();
	};

	/**
	 * Ends a stroke when Space is let go
	 *
	 * @param event The key release on the map
	 */
	private readonly onKeyUp = (event: KeyboardEvent): void =>
	{
		if (event.key === ' ')
		{
			this.stopPainting();
		}
	};

	/**
	 * Moves the keyboard's cursor to a cell, kept inside the map, painting the cells on the way while
	 * Space is held, and reads out where it is
	 *
	 * @param target The cell
	 */
	private moveCursor(target: BrushCell): void
	{
		const host = this.host;
		const bounds = this.bounds;

		if (!host || !bounds)
		{
			return;
		}

		const previous = this.cursor;
		const cell = {
			column: Phaser.Math.Clamp(target.column, bounds.minColumn, bounds.maxColumn),
			row: Phaser.Math.Clamp(target.row, bounds.minRow, bounds.maxRow)
		};

		this.cursor = cell;
		this.current?.showCursor(cell);
		host.hover(cell);

		if (this.painting && previous)
		{
			for (const step of cellsBetween(previous, cell, 1).slice(1))
			{
				host.paint(step.column, step.row);
			}
		}

		announce(host.describe(cell));
	}

	/**
	 * Does what a click on the cursor's cell does: paints it or picks it
	 *
	 * @param cell The cursor's cell
	 * @param hold Whether to keep painting as the cursor moves, until stopPainting()
	 */
	private useTool(cell: BrushCell, hold: boolean): void
	{
		const host = this.host;
		const mode = host?.pointerMode();

		if (!host || (mode === 'none'))
		{
			return;
		}

		if (mode === 'pick')
		{
			host.pick(cell.column, cell.row);
			return;
		}

		host.paintStart();
		host.paint(cell.column, cell.row);

		if (hold)
		{
			this.painting = true;
		}
		else
		{
			host.paintEnd();
		}

		announce(host.describe(cell));
	}

	/**
	 * Ends the stroke Space is painting, if there is one
	 */
	private readonly stopPainting = (): void =>
	{
		if (this.painting)
		{
			this.painting = false;
			this.host?.paintEnd();
		}
	};
}

/**
 * What the map editor scene needs to draw an area
 *
 * @param area The area as the editor knows it
 * @param tiles Every tile the universe can use
 * @param ruleset The universe's ruleset, which names its default tiles
 * @return The area in the form the renderer draws, without chunks (they are passed separately)
 */
export function editorAreaPayload(area: EditorArea, tiles: readonly EditorTile[], ruleset: Ruleset): AreaPayload
{
	return({
		areaId: area.id,
		name: area.name,
		ruleset,
		indoors: area.indoors,
		bounds: area.bounds,
		loopsEastWest: area.loopsEastWest,
		loopsNorthSouth: area.loopsNorthSouth,
		defaultTileId: area.defaultTileId,
		tiles: tiles.map((tile) => ({
			id: tile.id,
			key: tile.key,
			name: tile.name,
			color: tile.color
		})),
		chunks: [],
		links: []
	});
}
