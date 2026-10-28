import { defineMessages, isTileGraphic, TILE_GRAPHIC_KEYS, TILE_GRAPHICS, type MessageDescriptor, type TileGraphic, type TileGraphicFormat, type TileSettings, type UploadedTileGraphic } from '@multiverse-kiln/shared';

import { t } from '../../localization';
import { TILE_GRAPHIC_URLS, uploadedTileGraphicUrl } from '../../rendering/tileGraphics';
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
	},
	stoneWall: {
		id: 'editor.tile.graphic.stoneWall',
		defaultMessage: 'Stone Wall',
		description: 'One of the graphics a tile can be drawn with, in the tile editor\'s list of them and read out for the Tilesets table\'s pictures of tiles: the top of a thick stone wall seen from above, which joins up with the same tile in the cells around it'
	},
	hedge: {
		id: 'editor.tile.graphic.hedge',
		defaultMessage: 'Hedge',
		description: 'One of the graphics a tile can be drawn with, in the tile editor\'s list of them and read out for the Tilesets table\'s pictures of tiles: a clipped hedge seen from above, which joins up with the same tile in the cells around it'
	}
});

/**
 * A tile's graphic, as one setting: one that ships with the engine, one the universe's editors uploaded, or none
 */
export type TileGraphicChoice = Pick<TileSettings, 'graphic' | 'uploadedGraphicId'>;

/**
 * An uploaded tileset as the Tilesets tab shows it, with what saving the tab will do to it
 *
 * - saved: uploaded already
 * - new: chosen in the upload dialog, uploaded when the tab is saved; until then it has a staged ID
 *   and shows from previewUrl
 * - deleted: uploaded, and deleted when the tab is saved
 */
export interface ShownUpload extends UploadedTileGraphic
{
	state: 'saved' | 'new' | 'deleted';

	/**
	 * The image as a data URL, for a new upload the server doesn't have yet
	 */
	previewUrl?: string;
}

/**
 * How a tile's graphic is laid out and drawn: its format, and a Dual-Grid graphic's draw order
 *
 * @param choice The tile's graphic
 * @param uploads The universe's uploaded graphics, with those waiting for the tab to be saved
 * @return The format and draw order (null for a blob graphic), or undefined for no graphic, or an
 * uploaded one that isn't listed
 */
export function tileGraphicLayout(choice: TileGraphicChoice, uploads: readonly ShownUpload[]): { format: TileGraphicFormat; drawOrder: number | null } | undefined
{
	if (choice.uploadedGraphicId !== null)
	{
		const upload = uploads.find((candidate) => ((candidate.id === choice.uploadedGraphicId) && (candidate.state !== 'deleted')));

		return((upload ? { format: upload.format, drawOrder: upload.drawOrder } : undefined));
	}

	if (!isTileGraphic(choice.graphic))
	{
		return(undefined);
	}

	const graphic = TILE_GRAPHICS[choice.graphic];

	return({
		format: graphic.format,
		drawOrder: ((graphic.format === 'dualGrid') ? graphic.drawOrder : null)
	});
}

/**
 * The name of a graphic that ships with the engine, in the player's language
 *
 * @param graphic The graphic
 * @return Its name
 */
export function tileGraphicName(graphic: TileGraphic): string
{
	return(t(TILE_GRAPHIC_NAMES[graphic]));
}

/**
 * A tile's graphic as the value of a choice in tileGraphicOptions()
 *
 * @param choice The tile's graphic
 * @return The value: '' for none, built-in:<key> or upload:<ID>
 */
export function tileGraphicValue(choice: TileGraphicChoice): string
{
	if (choice.uploadedGraphicId !== null)
	{
		return(`upload:${choice.uploadedGraphicId}`);
	}

	return((isTileGraphic(choice.graphic) ? `built-in:${choice.graphic}` : ''));
}

/**
 * The graphic a choice in tileGraphicOptions() stands for
 *
 * @param value The choice's value, from tileGraphicValue()
 * @return The tile's graphic
 */
export function parseTileGraphicValue(value: string): TileGraphicChoice
{
	if (value.startsWith('upload:'))
	{
		return({ graphic: null, uploadedGraphicId: value.slice('upload:'.length) });
	}

	if (value.startsWith('built-in:'))
	{
		return({ graphic: value.slice('built-in:'.length), uploadedGraphicId: null });
	}

	return({ graphic: null, uploadedGraphicId: null });
}

/**
 * The choices for a tile's graphic: none, which draws the tile in its color, then each graphic that
 * ships with the engine, then each the universe's editors uploaded. Those marked to delete are left out
 *
 * @param uploads The universe's uploaded graphics, with those waiting for the tab to be saved
 * @return The choices
 */
export function tileGraphicOptions(uploads: readonly ShownUpload[]): SelectOption[]
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
			value: tileGraphicValue({ graphic, uploadedGraphicId: null }),
			label: tileGraphicName(graphic)
		})),
		...uploads
			.filter((upload) => (upload.state !== 'deleted'))
			.map((upload) => ({
				value: tileGraphicValue({ graphic: null, uploadedGraphicId: upload.id }),
				label: t({
					id: 'editor.tile.uploadedGraphic',
					defaultMessage: '{name} (custom)',
					description: 'A tileset this universe\'s editors uploaded, in the tile editor\'s list of graphics; {name} is the name it was given. "custom" marks it as made for this universe rather than coming with the game, as the editor tags custom tiles and items'
				}, {
					name: upload.name
				})
			}))
	]);
}

/**
 * Shows a tile in a swatch: its graphic, filled with the tile on every side, or its color. Screen
 * readers read the graphic's name, or the color's hex code, which the tile editor also shows. A tile
 * whose uploaded graphic is marked to delete shows its color, as it will be drawn once that is saved
 *
 * @param swatch The swatch
 * @param tile The tile's color and graphic
 * @param uploads The universe's uploaded graphics, which name an uploaded graphic and show one not uploaded yet
 * @param night Whether to show it at night
 */
export function showTileSwatch(swatch: HTMLElement, tile: Pick<TileSettings, 'color' | 'graphic' | 'uploadedGraphicId'>, uploads: readonly ShownUpload[], night = false): void
{
	const color = colorToHex((night ? nightColor(tile.color) : tile.color));
	const overlay = (night ? NIGHT_OVERLAY : 'transparent');
	let url: string | undefined;
	let blob = false;
	let label = colorToHex(tile.color);

	const upload = uploads.find((candidate) => (candidate.id === tile.uploadedGraphicId));

	if ((tile.uploadedGraphicId !== null) && (upload?.state !== 'deleted'))
	{
		url = (upload?.previewUrl ?? uploadedTileGraphicUrl(tile.uploadedGraphicId));
		blob = (upload?.format === 'blob');
		label = (upload?.name ?? label);
	}
	else if (isTileGraphic(tile.graphic))
	{
		url = TILE_GRAPHIC_URLS[tile.graphic];
		blob = (TILE_GRAPHICS[tile.graphic].format === 'blob');
		label = tileGraphicName(tile.graphic);
	}

	swatch.classList.add('swatch');
	swatch.classList.toggle('graphic', (url !== undefined));
	swatch.classList.toggle('blob', blob);
	swatch.style.backgroundColor = color;
	swatch.style.backgroundImage = ((url === undefined) ? '' : `linear-gradient(${overlay}, ${overlay}), url("${url}")`);
	swatch.setAttribute('role', 'img');
	swatch.setAttribute('aria-label', label);
}
