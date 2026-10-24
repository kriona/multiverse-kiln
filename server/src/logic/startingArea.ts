/**
 * Where a new character starts (see STRUCTURE-OVERVIEW.md, Tab: Characters)
 *
 * The most specific choice wins: the class's entry for the character's race, then the class, then the
 * race, then the universe. A class with a starting area of its own has no per-race entries, so every
 * member of it starts there whatever their race. Each choice names a cell of its area as well, which
 * goes with it
 */
import type { ClassRaceArea, MapBounds, StartingCell } from '@multiverse-kiln/shared';

/**
 * An area and the cell of it a character starts nearest
 */
export interface StartingPlace extends StartingCell
{
	areaId: string;
}

/**
 * What a character's race says about where they start
 */
export interface StartingAreaRace
{
	/**
	 * The race's ID, which the class's per-race entries list it by
	 */
	id: number;

	/**
	 * The race's area, or null to leave it to the universe
	 */
	startingAreaId: string | null;

	/**
	 * The cell of the race's area
	 */
	startingColumn: number;

	startingRow: number;
}

/**
 * What a character's class says about where they start
 */
export interface StartingAreaClass
{
	/**
	 * The class's area for every race, or null to leave it to raceAreas, then the race
	 */
	startingAreaId: string | null;

	/**
	 * The cell of the class's area
	 */
	startingColumn: number;

	startingRow: number;

	/**
	 * The class's area for some races
	 */
	raceAreas: readonly ClassRaceArea[];
}

/**
 * The place a new character starts
 *
 * @param universePlace The universe's starting area and cell, or null while it has no area
 * @param race The character's race
 * @param characterClass The character's class
 * @return The area and cell, or null when nothing names an area
 */
export function chooseStartingArea(universePlace: StartingPlace | null, race: StartingAreaRace, characterClass: StartingAreaClass): StartingPlace | null
{
	const classForRace = characterClass.raceAreas.find((entry) => (entry.raceId === race.id));

	if (classForRace)
	{
		return({
			areaId: classForRace.areaId,
			column: classForRace.column,
			row: classForRace.row
		});
	}

	for (const choice of [characterClass, race])
	{
		if (choice.startingAreaId !== null)
		{
			return({
				areaId: choice.startingAreaId,
				column: choice.startingColumn,
				row: choice.startingRow
			});
		}
	}

	return(universePlace);
}

/**
 * The cell of a map nearest a starting cell: the cell itself when it is on the map, which may have been
 * made smaller since the cell was chosen
 *
 * @param bounds The map's bounds
 * @param cell The starting cell
 * @return The cell
 */
export function startingCellOn(bounds: MapBounds, cell: StartingCell): StartingCell
{
	return({
		column: Math.min(Math.max(cell.column, bounds.minColumn), bounds.maxColumn),
		row: Math.min(Math.max(cell.row, bounds.minRow), bounds.maxRow)
	});
}
