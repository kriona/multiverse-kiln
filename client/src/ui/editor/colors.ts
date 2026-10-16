/**
 * Tile colors as the editor shows and reads them
 */

/**
 * A 3 or 6 digit hex color, with or without a leading #
 */
const hexColor = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Writes a color as CSS hex
 *
 * @param color 0xRRGGBB
 * @return e.g. #7aff3d
 */
export function colorToHex(color: number): string
{
	return(`#${color.toString(16).padStart(6, '0')}`);
}

/**
 * Reads a hex color typed by the player
 *
 * @param text e.g. #7AFF3D, 7aff3d or #0A1
 * @return 0xRRGGBB, or undefined when the text isn't a hex color
 */
export function parseHexColor(text: string): number | undefined
{
	const match = hexColor.exec(text.trim());

	if (!match)
	{
		return(undefined);
	}

	const digits = ((match[1].length === 3) ? [...match[1]].map((digit) => (digit + digit)).join('') : match[1]);

	return(parseInt(digits, 16));
}

/**
 * Roughly how a color looks at night, for the tile editor's preview: darker, and bluer
 *
 * @param color 0xRRGGBB
 * @return 0xRRGGBB
 */
export function nightColor(color: number): number
{
	const red = Math.round(((color >> 16) & 0xff) * 0.25);
	const green = Math.round(((color >> 8) & 0xff) * 0.3);
	const blue = Math.min(0xff, Math.round((color & 0xff) * 0.45) + 0x18);

	return((red << 16) | (green << 8) | blue);
}
