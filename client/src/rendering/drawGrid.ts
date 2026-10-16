import type Phaser from 'phaser';
import { GRID_CELL_SIZE, type MapBounds } from '@multiverse-kiln/shared';

const GRID_LINE_COLOR = 0x2c2f3b;

const EDGE_COLOR = 0x5c6070;

/**
 * Draws the lines between a zone's grid cells, and its edge, behind everything else
 *
 * Lines are drawn for the whole zone, so this only suits small zones; drawing the zone's tiles near the
 * camera comes with the tile renderer
 *
 * @param scene Scene to draw in
 * @param bounds The zone's cells
 * @return The grid's Graphics object
 */
export function drawGrid(scene: Phaser.Scene, bounds: MapBounds): Phaser.GameObjects.Graphics
{
	const graphics = scene.add.graphics().setDepth(-1);
	const left = bounds.minColumn * GRID_CELL_SIZE;
	const top = bounds.minRow * GRID_CELL_SIZE;
	const right = (bounds.maxColumn + 1) * GRID_CELL_SIZE;
	const bottom = (bounds.maxRow + 1) * GRID_CELL_SIZE;

	graphics.lineStyle(1, GRID_LINE_COLOR, 1);

	// Lines sit on half pixels so a 1px line covers exactly one pixel column or row instead of blurring across two
	for (let x = left + GRID_CELL_SIZE; x < right; x += GRID_CELL_SIZE)
	{
		graphics.lineBetween(x + 0.5, top, x + 0.5, bottom);
	}

	for (let y = top + GRID_CELL_SIZE; y < bottom; y += GRID_CELL_SIZE)
	{
		graphics.lineBetween(left, y + 0.5, right, y + 0.5);
	}

	graphics.lineStyle(1, EDGE_COLOR, 1);
	graphics.strokeRect(left + 0.5, top + 0.5, right - left - 1, bottom - top - 1);

	return(graphics);
}
