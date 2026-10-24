import { defineMessages, isTileGraphic, TILE_GRAPHIC_KEYS, type MessageDescriptor, type TileGraphic, type TileSettings } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { TILE_GRAPHIC_URLS } from '../../rendering/tileGraphics';
import type { SelectOption } from '../dom';
import { colorToHex, nightColor } from './colors';

/**
 * Laid over a graphic in the night preview: roughly what nightColor() does to a color
 */
const NIGHT_OVERLAY = 'rgb(10 16 48 / 70%)';

/**
 * Each tile graphic's name
 */
const TILE_GRAPHIC_NAMES: Record<TileGraphic, MessageDescriptor> = defineMessages({
	grass: {
		id: 'editor.tile.graphic.grass',
		defaultMessage: 'Grass',
		description: 'One of the graphics a tile can be drawn with, in the tile editor\'s list of them and read out for the Tilesets table\'s pictures of tiles: grass'
	},
	forest: {
		id: 'editor.tile.graphic.forest',
		defaultMessage: 'Forest',
		description: 'One of the graphics a tile can be drawn with, in the tile editor\'s list of them and read out for the Tilesets table\'s pictures of tiles: woodland'
	},
	mountains: {
		id: 'editor.tile.graphic.mountains',
		defaultMessage: 'Mountains',
		description: 'One of the graphics a tile can be drawn with, in the tile editor\'s list of them and read out for the Tilesets table\'s pictures of tiles: mountains, whose peaks are drawn over players standing just north of them when the tile can\'t be entered'
	}
});

/**
 * The choices for a tile's graphic: none, which draws the tile in its color, then each graphic
 *
 * @return The choices; none's value is ''
 */
export function tileGraphicOptions(): SelectOption[]
{
	return([
		{
			value: '',
			label: t({
				id: 'editor.tile.noGraphic',
				defaultMessage: 'None (use the color)',
				description: 'First choice in the tile editor\'s list of graphics: the tile is drawn in its color'
			})
		},
		...TILE_GRAPHIC_KEYS.map((graphic) => ({
			value: graphic,
			label: t(TILE_GRAPHIC_NAMES[graphic])
		}))
	]);
}

/**
 * Shows a tile in a swatch: its graphic, filled with the tile on every side, or its color. Screen
 * readers read the graphic's name, or the color's hex code, which the tile editor also shows
 *
 * @param swatch The swatch
 * @param tile The tile's color and graphic
 * @param night Whether to show it at night
 */
export function showTileSwatch(swatch: HTMLElement, tile: Pick<TileSettings, 'color' | 'graphic'>, night = false): void
{
	const color = colorToHex((night ? nightColor(tile.color) : tile.color));
	const graphic = (isTileGraphic(tile.graphic) ? tile.graphic : undefined);
	const overlay = (night ? NIGHT_OVERLAY : 'transparent');

	swatch.classList.add('swatch');
	swatch.classList.toggle('graphic', (graphic !== undefined));
	swatch.style.backgroundColor = color;
	swatch.style.backgroundImage = ((graphic === undefined)
		? ''
		: `linear-gradient(${overlay}, ${overlay}), url("${TILE_GRAPHIC_URLS[graphic]}")`);
	swatch.setAttribute('role', 'img');
	swatch.setAttribute('aria-label', ((graphic === undefined) ? colorToHex(tile.color) : t(TILE_GRAPHIC_NAMES[graphic])));
}
