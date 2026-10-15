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
	 * @return A check for stepOnGrid and spawnPosition
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
 * A map key for a cell
 *
 * @param cell The cell
 * @return "column,row"
 */
function cellKey(cell: Cell): string
{
	return(`${cell.column},${cell.row}`);
}
