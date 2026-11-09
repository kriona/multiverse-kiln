/**
 * The legend an export of the world holds beside its areas' files (UNIVERSE_EXPORT_AREA_LEGEND): how to
 * read the cells of an ExportedArea's file, which tile each number in them is, and which area each file
 * is, in Markdown, in the language of the player exporting it
 */
import { DEFAULT_TILE_CELL, DEFAULT_TILE_NAMES, defineMessages, VOID_CELL, type EditorArea, type ExportedTile, type Ruleset, type Translator } from '@multiverse-kiln/shared';

/**
 * An area the legend lists, and its file's path in the archive
 */
export type LegendArea = EditorArea & { file: string };

/**
 * What the legend says (see shared/src/localization.ts)
 */
const messages = defineMessages({
	title: {
		id: 'export.legend.title',
		defaultMessage: '{universe}: area cells',
		description: 'Heading of the legend file in the areas folder of a universe\'s exported zip file, which explains the files holding each area\'s cells; {universe} is the universe\'s name'
	},
	intro: {
		id: 'export.legend.intro',
		defaultMessage: 'Each JSON file in this folder holds one area: its settings, the links on its cells, and its cells, which say which tile is on each square of its ground. The Areas table below says which area each file is.',
		description: 'First paragraph of the legend file in the areas folder of a universe\'s exported zip file'
	},
	readingHeading: {
		id: 'export.legend.readingHeading',
		defaultMessage: 'Reading a file',
		description: 'Heading of the part of the legend file in a universe\'s exported zip file that explains how an area\'s cells are laid out in its file'
	},
	start: {
		id: 'export.legend.start',
		defaultMessage: '"bounds" gives the columns and rows the area covers, both ends included: "minColumn" and "minRow" are its westmost column and northmost row, the column and row of its north-west corner, and "maxColumn" and "maxRow" its eastmost column and southmost row.',
		description: 'Line of the legend file in a universe\'s exported zip file explaining a field of an area\'s file; keep "bounds", "minColumn", "minRow", "maxColumn" and "maxRow" as they are, since they are the fields\' names in the file'
	},
	rows: {
		id: 'export.legend.rows',
		defaultMessage: '"rows" holds the area\'s rows from north to south, each with its cells from west to east, so the first cell of the first row is the north-west corner. Columns grow to the east and rows to the south.',
		description: 'Line of the legend file in a universe\'s exported zip file explaining a field of an area\'s file; keep "rows" as it is, since it is the field\'s name in the file'
	},
	place: {
		id: 'export.legend.place',
		defaultMessage: 'The cell at place c of row r of the list, counting both from 0, is on column minColumn + c and row minRow + r of the area, taking minColumn and minRow from "bounds".',
		description: 'Line of the legend file in a universe\'s exported zip file giving the arithmetic that finds a cell\'s column and row from its place in the rows; keep minColumn and minRow as they are, since they are the fields\' names in the file, and c and r as letters standing for numbers'
	},
	exactly: {
		id: 'export.legend.exactly',
		defaultMessage: 'There is a row for every row of the area, and each row has a cell for every column of it, as "bounds" gives them. Importing a file whose rows don\'t match its bounds is refused, so to make the area larger or smaller, change both together.',
		description: 'Line of the legend file in a universe\'s exported zip file telling someone editing an area\'s file that its rows must match its bounds; keep "bounds" as it is, since it is the field\'s name in the file'
	},
	values: {
		id: 'export.legend.values',
		defaultMessage: 'Each cell holds the number of a tile in the Tiles table below, {defaultCell, number} for the area\'s default tile (which the Areas table names), or {voidCell, number} for nothing at all: void, drawn black, which no one can enter.',
		description: 'Line of the legend file in a universe\'s exported zip file explaining the numbers in an area\'s cells; {defaultCell} and {voidCell} are the two numbers that aren\'t tiles'
	},
	example: {
		id: 'export.legend.example',
		defaultMessage: 'For example, in a file whose bounds have a minColumn of {minColumn, number} and a minRow of {minRow, number}, the third cell of the second row is on column {column, number}, row {row, number}.',
		description: 'Line of the legend file in a universe\'s exported zip file working through finding one cell\'s column and row; keep minColumn and minRow as they are, since they are the fields\' names in the file'
	},
	tilesHeading: {
		id: 'export.legend.tilesHeading',
		defaultMessage: 'Tiles',
		description: 'Heading of the table in the legend file of a universe\'s exported zip file listing what each number in an area\'s cells stands for'
	},
	numberColumn: {
		id: 'export.legend.numberColumn',
		defaultMessage: 'Number',
		description: 'Heading of the column of numbers, as the cells hold them, in the legend file\'s table of tiles in a universe\'s exported zip file'
	},
	tileColumn: {
		id: 'export.legend.tileColumn',
		defaultMessage: 'Tile',
		description: 'Heading of the column of tile names in the legend file\'s table of tiles in a universe\'s exported zip file'
	},
	colorColumn: {
		id: 'export.legend.colorColumn',
		defaultMessage: 'Color',
		description: 'Heading of the column of tile colors, as hex codes such as #7AFF3D, in the legend file\'s table of tiles in a universe\'s exported zip file'
	},
	defaultTile: {
		id: 'export.legend.defaultTile',
		defaultMessage: 'The area\'s default tile',
		description: 'In the legend file\'s table of tiles in a universe\'s exported zip file: what the number 0 in an area\'s cells stands for'
	},
	voidCell: {
		id: 'export.legend.voidCell',
		defaultMessage: 'Void (nothing)',
		description: 'In the legend file\'s table of tiles in a universe\'s exported zip file: what the number -1 in an area\'s cells stands for, a cell with nothing on it'
	},
	areasHeading: {
		id: 'export.legend.areasHeading',
		defaultMessage: 'Areas',
		description: 'Heading of the table in the legend file of a universe\'s exported zip file listing which area each file holds'
	},
	fileColumn: {
		id: 'export.legend.fileColumn',
		defaultMessage: 'File',
		description: 'Heading of the column of file names in the legend file\'s table of areas in a universe\'s exported zip file'
	},
	areaColumn: {
		id: 'export.legend.areaColumn',
		defaultMessage: 'Area',
		description: 'Heading of the column of area names in the legend file\'s table of areas in a universe\'s exported zip file'
	},
	defaultTileColumn: {
		id: 'export.legend.defaultTileColumn',
		defaultMessage: 'Default tile',
		description: 'Heading of the column naming each area\'s default tile, which cells holding 0 are, in the legend file\'s table of areas in a universe\'s exported zip file'
	},
	sizeColumn: {
		id: 'export.legend.sizeColumn',
		defaultMessage: 'Columns and rows',
		description: 'Heading of the column giving each area\'s extent in the legend file\'s table of areas in a universe\'s exported zip file, such as "-15 to 15, -8 to 8"'
	},
	extent: {
		id: 'export.legend.extent',
		defaultMessage: 'Columns {minColumn, number} to {maxColumn, number}, rows {minRow, number} to {maxRow, number}',
		description: 'In the legend file\'s table of areas in a universe\'s exported zip file: which columns and rows an area\'s ground covers, both ends included'
	}
});

/**
 * The legend of an export's areas' cells
 *
 * @param universeName The universe's name
 * @param ruleset Its ruleset, whose default tiles' names the legend writes for those the universe kept
 * @param tiles The tiles the export lists
 * @param areas The areas the export holds, with their files' paths
 * @param translator The language the player exporting reads
 * @return The legend, in Markdown
 */
export function areaCellsLegend(universeName: string, ruleset: Ruleset, tiles: readonly ExportedTile[], areas: readonly LegendArea[], translator: Translator): string
{
	const tileNames = new Map(tiles.map((tile) => [tile.id, tileName(tile, ruleset, translator)]));
	const lines = [
		`# ${escape(translator.format(messages.title, { universe: universeName }))}`,
		'',
		translator.format(messages.intro),
		'',
		`## ${translator.format(messages.readingHeading)}`,
		'',
		`- ${translator.format(messages.start)}`,
		`- ${translator.format(messages.rows)}`,
		`- ${translator.format(messages.place)}`,
		`- ${translator.format(messages.exactly)}`,
		`- ${translator.format(messages.values, { defaultCell: DEFAULT_TILE_CELL, voidCell: VOID_CELL })}`,
		`- ${translator.format(messages.example, { minColumn: -4, minRow: -2, column: -2, row: -1 })}`,
		'',
		`## ${translator.format(messages.tilesHeading)}`,
		'',
		row([translator.format(messages.numberColumn), translator.format(messages.tileColumn), translator.format(messages.colorColumn)]),
		row(['---:', '---', '---']),
		row([String(DEFAULT_TILE_CELL), translator.format(messages.defaultTile), '']),
		row([String(VOID_CELL), translator.format(messages.voidCell), '']),
		...[...tiles]
			.sort((a, b) => (a.id - b.id))
			.map((tile) => row([String(tile.id), (tileNames.get(tile.id) ?? ''), `#${tile.color.toString(16).toUpperCase().padStart(6, '0')}`])),
		'',
		`## ${translator.format(messages.areasHeading)}`,
		'',
		row([translator.format(messages.fileColumn), translator.format(messages.areaColumn), translator.format(messages.defaultTileColumn), translator.format(messages.sizeColumn)]),
		row(['---', '---', '---', '---']),
		...areas.map((area) => row([
			`\`${fileName(area.file)}\``,
			area.name,
			(tileNames.get(area.defaultTileId) ?? String(area.defaultTileId)),
			translator.format(messages.extent, { ...area.bounds })
		]))
	];

	return(`${lines.join('\n')}\n`);
}

/**
 * A tile's name as the universe calls it: its own, or one of the ruleset's defaults' in the player's language
 *
 * @param tile The tile
 * @param ruleset The universe's ruleset
 * @param translator The player's language
 * @return The name, or the default's key when the ruleset has no name for it
 */
function tileName(tile: ExportedTile, ruleset: Ruleset, translator: Translator): string
{
	if (tile.name !== null)
	{
		return(tile.name);
	}

	const descriptor = ((tile.key === null) ? undefined : DEFAULT_TILE_NAMES[ruleset][tile.key]);

	return(((descriptor === undefined) ? (tile.key ?? '') : translator.format(descriptor)));
}

/**
 * A file's name, without the folders before it
 *
 * @param path Its path in the archive
 * @return The name
 */
function fileName(path: string): string
{
	return(path.slice(path.lastIndexOf('/') + 1));
}

/**
 * A row of a Markdown table
 *
 * @param cells The cells' text
 * @return The row
 */
function row(cells: readonly string[]): string
{
	return(`| ${cells.map(escape).join(' | ')} |`);
}

/**
 * Text that Markdown shows as it is in a table: a vertical bar would end its cell
 *
 * @param text The text
 * @return The text, escaped
 */
function escape(text: string): string
{
	return(text.replace(/\|/g, '\\|'));
}
