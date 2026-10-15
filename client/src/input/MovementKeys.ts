import Phaser from 'phaser';
import type { Direction, MovePayload } from '@multiverse-kiln/shared';

const KeyCodes = Phaser.Input.Keyboard.KeyCodes;

/**
 * Reads the movement keys (arrow keys and WASD) as a Move payload
 */
export class MovementKeys
{
	private readonly left: Phaser.Input.Keyboard.Key[];
	private readonly right: Phaser.Input.Keyboard.Key[];
	private readonly up: Phaser.Input.Keyboard.Key[];
	private readonly down: Phaser.Input.Keyboard.Key[];

	/**
	 * Registers the keys; Phaser captures them so the arrow keys don't scroll the page
	 *
	 * @param keyboard The scene's keyboard plugin
	 */
	constructor(private readonly keyboard: Phaser.Input.Keyboard.KeyboardPlugin)
	{
		this.left = [keyboard.addKey(KeyCodes.LEFT), keyboard.addKey(KeyCodes.A)];
		this.right = [keyboard.addKey(KeyCodes.RIGHT), keyboard.addKey(KeyCodes.D)];
		this.up = [keyboard.addKey(KeyCodes.UP), keyboard.addKey(KeyCodes.W)];
		this.down = [keyboard.addKey(KeyCodes.DOWN), keyboard.addKey(KeyCodes.S)];
	}

	/**
	 * The direction currently held on each axis; opposite keys held together cancel out
	 *
	 * @return The held direction
	 */
	read(): MovePayload
	{
		return({
			x: toDirection(isAnyDown(this.left), isAnyDown(this.right)),
			y: toDirection(isAnyDown(this.up), isAnyDown(this.down))
		});
	}

	/**
	 * Marks every key as released
	 *
	 * Called when the window loses focus or the page is hidden: the browser doesn't send key-up events
	 * to an unfocused page, so a key held while switching away would otherwise stay down
	 */
	release(): void
	{
		this.keyboard.resetKeys();
	}
}

/**
 * Whether any of the keys is held
 *
 * @param keys Keys to check
 * @return True when at least one is down
 */
function isAnyDown(keys: Phaser.Input.Keyboard.Key[]): boolean
{
	return(keys.some((key) => key.isDown));
}

/**
 * Turns the two keys of one axis into a direction
 *
 * @param negative Whether the left or up key is held
 * @param positive Whether the right or down key is held
 * @return -1, 0 or 1
 */
function toDirection(negative: boolean, positive: boolean): Direction
{
	if (negative === positive)
	{
		return(0);
	}

	return((negative ? -1 : 1));
}
