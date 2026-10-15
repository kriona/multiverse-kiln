import type Phaser from 'phaser';
import { GRID_CELL_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from '@multiverse-kiln/shared';

const GRID_LINE_COLOR = 0x2c2f3b;

/**
 * Draws the lines between the grid cells players move on, behind everything else
 *
 * @param scene Scene to draw in
 * @return The grid's Graphics object
 */
export function drawGrid(scene: Phaser.Scene): Phaser.GameObjects.Graphics
{
	const graphics = scene.add.graphics().setDepth(-1);

	graphics.lineStyle(1, GRID_LINE_COLOR, 1);

	// Lines sit on half pixels so a 1px line covers exactly one pixel column or row instead of blurring across two
	for (let x = GRID_CELL_SIZE; x < WORLD_WIDTH; x += GRID_CELL_SIZE)
	{
		graphics.lineBetween(x + 0.5, 0, x + 0.5, WORLD_HEIGHT);
	}

	for (let y = GRID_CELL_SIZE; y < WORLD_HEIGHT; y += GRID_CELL_SIZE)
	{
		graphics.lineBetween(0, y + 0.5, WORLD_WIDTH, y + 0.5);
	}

	return(graphics);
}
