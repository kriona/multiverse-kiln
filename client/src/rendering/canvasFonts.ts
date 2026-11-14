/**
 * The site's fonts for text drawn on a canvas. Phaser draws a text with the font it has when the text is
 * made, and doesn't draw it again when the font arrives, so a scene's text waits for the font to load
 */

/**
 * The font loading, once it has started
 */
let loading: Promise<void> | undefined;

/**
 * Whether the font has loaded, or failed to
 */
let loaded = false;

/**
 * The body font, as the page's styles set it (--font-body in _shared.scss)
 *
 * @return The font's CSS font-family list
 */
export function bodyFontFamily(): string
{
	const family = getComputedStyle(document.documentElement)
		.getPropertyValue('--font-body')
		.trim();

	return((family === '') ? 'sans-serif' : family);
}

/**
 * Loads the body font's upright Latin characters, which canvas text is drawn with, once
 *
 * @return A promise settled once it has loaded, or failed to, when the text is drawn in a fallback font
 */
export function loadCanvasFonts(): Promise<void>
{
	loading ??= document.fonts.load(`16px ${bodyFontFamily()}`)
		.catch(() => [])
		.then(() =>
		{
			loaded = true;
		});

	return(loading);
}

/**
 * Whether the canvas fonts have loaded (or failed to), so text can be drawn at once
 *
 * @return True once loadCanvasFonts() has settled
 */
export function canvasFontsLoaded(): boolean
{
	return(loaded);
}
