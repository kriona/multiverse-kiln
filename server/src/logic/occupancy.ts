/**
 * Which player holds each grid cell
 *
 * Pure data structure: no Colyseus, database, network or timers (CLAUDE.md architecture rule 4)
 */
import type { Cell, IsCellFree } from './movement.js';

/**
 * Tracks the cells each player holds, so a player can only move into cells no one else holds
 */
export class CellOccupancy
{
	private readonly holders = new Map<string, string>();
	private readonly cellsByHolder = new Map<string, Cell[]>();

	/**
	 * Sets the cells a player holds, replacing any it held before
	 *
	 * @param holderId The player's ID
	 * @param cells The cells it now holds
	 */
	hold(holderId: string, cells: Cell[]): void
	{
		this.release(holderId);

		for (const cell of cells)
		{
			this.holders.set(cellKey(cell), holderId);
		}

		this.cellsByHolder.set(holderId, cells);
	}

	/**
	 * Frees every cell a player holds
	 *
	 * @param holderId The player's ID
	 */
	release(holderId: string): void
	{
		for (const cell of this.cellsByHolder.get(holderId) ?? [])
		{
			const key = cellKey(cell);

			if (this.holders.get(key) === holderId)
			{
				this.holders.delete(key);
			}
		}

		this.cellsByHolder.delete(holderId);
	}

	/**
	 * Checks cells from one player's point of view: its own cells count as free
	 *
	 * @param holderId The player's ID
	 * @return A check for stepOnGrid and findFreeCell
	 */
	isFreeFor(holderId: string): IsCellFree
	{
		return((cell) =>
		{
			const holder = this.holders.get(cellKey(cell));

			return((holder === undefined) || (holder === holderId));
		});
	}
}

/**
 * A cell of an area
 */
export interface PlacedCell extends Cell
{
	areaId: string;
}

/**
 * Tracks the cells each player holds across every area of a room, so a player can't move into a cell
 * another holds, even one across a seam with a neighboring area that the other is in or stepping into
 */
export class AreaOccupancy
{
	private readonly holders = new Map<string, string>();
	private readonly keysByHolder = new Map<string, string[]>();

	/**
	 * Sets the cells a player holds, replacing any it held before
	 *
	 * @param holderId The player's ID
	 * @param cells The cells it now holds, each in the area it is in
	 */
	hold(holderId: string, cells: readonly PlacedCell[]): void
	{
		this.release(holderId);

		const keys = cells.map(placedKey);

		for (const key of keys)
		{
			this.holders.set(key, holderId);
		}

		this.keysByHolder.set(holderId, keys);
	}

	/**
	 * Frees every cell a player holds
	 *
	 * @param holderId The player's ID
	 */
	release(holderId: string): void
	{
		for (const key of this.keysByHolder.get(holderId) ?? [])
		{
			if (this.holders.get(key) === holderId)
			{
				this.holders.delete(key);
			}
		}

		this.keysByHolder.delete(holderId);
	}

	/**
	 * Whether a cell is free from one player's point of view: its own cells count as free
	 *
	 * @param holderId The player's ID
	 * @param cell The cell
	 * @return True when nobody else holds it
	 */
	isFree(holderId: string, cell: PlacedCell): boolean
	{
		const holder = this.holders.get(placedKey(cell));

		return((holder === undefined) || (holder === holderId));
	}
}

/**
 * A map key for a cell
 *
 * @param cell The cell
 * @return "column,row"
 */
function cellKey(cell: Cell): string
{
	return(`${cell.column},${cell.row}`);
}

/**
 * A map key for a cell of an area
 *
 * @param cell The cell
 * @return "areaId:column,row"
 */
function placedKey(cell: PlacedCell): string
{
	return(`${cell.areaId}:${cell.column},${cell.row}`);
}
