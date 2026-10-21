import { DEFAULT_TILE_CELL, isInBounds, VOID_CELL, type EditorTile, type EditorAreaLink, type Ruleset } from '@multiverse-kiln/shared';

import type { BrushCell } from '../../editor/brush';
import type { EditorMap } from '../../editor/EditorMap';
import { t } from '../../localization';
import { tileName } from '../tileNames';
import { mapMessages } from './mapMessages';

/**
 * An area's map as the editor has loaded it, with what is needed to name what its cells hold
 */
export interface DescribedMap
{
	map: EditorMap;

	/**
	 * The tile of cells holding DEFAULT_TILE_CELL
	 */
	defaultTileId: number;

	/**
	 * Every tile the universe can use
	 */
	tiles: readonly EditorTile[];

	links: readonly EditorAreaLink[];

	/**
	 * The universe's ruleset, which names its default tiles
	 */
	ruleset: Ruleset;
}

/**
 * A cell's coordinates and what it holds, as the map editor shows it under the map and reads it out
 * on the keyboard's cursor, e.g. "3, -2: Grass"
 *
 * @param described The map
 * @param cell The cell
 * @return The description, or an empty string for a cell outside the map
 */
export function describeCell(described: DescribedMap, cell: BrushCell): string
{
	const { map } = described;

	if (!isInBounds(map.bounds, cell.column, cell.row))
	{
		return('');
	}

	const value = map.valueAt(cell.column, cell.row);
	const tileId = ((value === DEFAULT_TILE_CELL) ? described.defaultTileId : value);
	const link = described.links.find((each) => ((each.column === cell.column) && (each.row === cell.row)));
	const tile = described.tiles.find((candidate) => (candidate.id === tileId));
	let contents: string;

	if (value === VOID_CELL)
	{
		contents = t(mapMessages.void);
	}
	else if (tileId === undefined)
	{
		contents = t({
			id: 'editor.map.cellLoading',
			defaultMessage: 'loading...',
			description: 'What the cell under the pointer holds, while that part of the map is loading'
		});
	}
	else if (tile)
	{
		contents = tileName(tile, described.ruleset);
	}
	else
	{
		contents = t({
			id: 'editor.map.unknownTile',
			defaultMessage: 'unknown tile',
			description: 'What the cell under the pointer holds, when it is a tile the editor doesn\'t know'
		});
	}

	return((link
		? t({
			id: 'editor.map.cellWithLink',
			defaultMessage: '{column}, {row}: {contents} ({mode, select, automatic {automatic link} other {manual link}})',
			description: 'Under the map, the cell under the pointer when it has an area link: its coordinates, what it holds and the kind of link'
		}, {
			column: cell.column,
			row: cell.row,
			contents,
			mode: link.mode
		})
		: t({
			id: 'editor.map.cell',
			defaultMessage: '{column}, {row}: {contents}',
			description: 'Under the map, the cell under the pointer: its coordinates and what it holds, e.g. "3, -2: Grass"'
		}, {
			column: cell.column,
			row: cell.row,
			contents
		})));
}
