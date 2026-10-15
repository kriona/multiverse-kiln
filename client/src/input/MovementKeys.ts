import Phaser from 'phaser';
import type { Direction, MovePayload } from '@multiverse-kiln/shared';

const KeyCodes = Phaser.Input.Keyboard.KeyCodes;

/**
 * Reads the movement keys (arrow keys, WASD and the numeric keypad) as a Move payload
 *
 * Keypad 7, 9, 1 and 3 move diagonally by counting toward both of their axes. With Num Lock off the
 * keypad sends Home, Page Up, End and Page Down for those keys and the arrow keys for 8, 4, 6 and 2,
 * so those are mapped too
 */
export class MovementKeys
{
	private readonly left: Phaser.Input.Keyboard.Key[];
	private readonly right: Phaser.Input.Keyboard.Key[];
	private readonly up: Phaser.Input.Keyboard.Key[];
	private readonly down: Phaser.Input.Keyboard.Key[];

	/**
	 * Registers the keys; Phaser captures them so they don't scroll the page
	 *
	 * @param keyboard The scene's keyboard plugin
	 */
	constructor(private readonly keyboard: Phaser.Input.Keyboard.KeyboardPlugin)
	{
		this.left = this.addKeys([KeyCodes.LEFT, KeyCodes.A, KeyCodes.NUMPAD_FOUR, KeyCodes.NUMPAD_SEVEN, KeyCodes.NUMPAD_ONE, KeyCodes.HOME, KeyCodes.END]);
		this.right = this.addKeys([KeyCodes.RIGHT, KeyCodes.D, KeyCodes.NUMPAD_SIX, KeyCodes.NUMPAD_NINE, KeyCodes.NUMPAD_THREE, KeyCodes.PAGE_UP, KeyCodes.PAGE_DOWN]);
		this.up = this.addKeys([KeyCodes.UP, KeyCodes.W, KeyCodes.NUMPAD_EIGHT, KeyCodes.NUMPAD_SEVEN, KeyCodes.NUMPAD_NINE, KeyCodes.HOME, KeyCodes.PAGE_UP]);
		this.down = this.addKeys([KeyCodes.DOWN, KeyCodes.S, KeyCodes.NUMPAD_TWO, KeyCodes.NUMPAD_ONE, KeyCodes.NUMPAD_THREE, KeyCodes.END, KeyCodes.PAGE_DOWN]);
	}

	/**
	 * Registers keys with the keyboard plugin
	 *
	 * A key listed for two axes (a diagonal) is registered once and shared, since the plugin keeps one Key per key code
	 *
	 * @param keyCodes Key codes to register
	 * @return The keys
	 */
	private addKeys(keyCodes: number[]): Phaser.Input.Keyboard.Key[]
	{
		return(keyCodes.map((keyCode) => this.keyboard.addKey(keyCode)));
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
