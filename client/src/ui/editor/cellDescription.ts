import { DEFAULT_TILE_CELL, isInBounds, VOID_CELL, type EditorTile, type EditorAreaLink, type Ruleset } from '@multiverse-kiln/shared';

import type { AreaCells } from '../../editor/AreaCells';
import type { BrushCell } from '../../editor/brush';
import { t } from '../../localization';
import { tileName } from '../tileNames';
import { areaEditorMessages } from './areaEditorMessages';

/**
 * An area's cells as the editor has loaded them, with what is needed to name what they hold
 */
export interface DescribedArea
{
	cells: AreaCells;

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
 * A cell's coordinates and what it holds, as the area editor shows it under the area's cells and reads
 * it out on the keyboard's cursor, e.g. "3, -2: Grass"
 *
 * @param described The area
 * @param cell The cell
 * @return The description, or an empty string for a cell outside the area
 */
export function describeCell(described: DescribedArea, cell: BrushCell): string
{
	const { cells } = described;

	if (!isInBounds(cells.bounds, cell.column, cell.row))
	{
		return('');
	}

	const value = cells.valueAt(cell.column, cell.row);
	const tileId = ((value === DEFAULT_TILE_CELL) ? described.defaultTileId : value);
	const link = described.links.find((each) => ((each.column === cell.column) && (each.row === cell.row)));
	const tile = described.tiles.find((candidate) => (candidate.id === tileId));
	let contents: string;

	if (value === VOID_CELL)
	{
		contents = t(areaEditorMessages.void);
	}
	else if (tileId === undefined)
	{
		contents = t({
			id: 'editor.area.cellLoading',
			defaultMessage: 'loading...',
			description: 'What the cell under the pointer holds, while that part of the area is loading'
		});
	}
	else if (tile)
	{
		contents = tileName(tile, described.ruleset);
	}
	else
	{
		contents = t({
			id: 'editor.area.unknownTile',
			defaultMessage: 'unknown tile',
			description: 'What the cell under the pointer holds, when it is a tile the editor doesn\'t know'
		});
	}

	return((link
		? t({
			id: 'editor.area.cellWithLink',
			defaultMessage: '{column}, {row}: {contents} ({mode, select, automatic {automatic link} other {manual link}})',
			description: 'Under the area editor\'s cells, the cell under the pointer when it has an area link: its coordinates, what it holds and the kind of link'
		}, {
			column: cell.column,
			row: cell.row,
			contents,
			mode: link.mode
		})
		: t({
			id: 'editor.area.cell',
			defaultMessage: '{column}, {row}: {contents}',
			description: 'Under the area editor\'s cells, the cell under the pointer: its coordinates and what it holds, e.g. "3, -2: Grass"'
		}, {
			column: cell.column,
			row: cell.row,
			contents
		})));
}
