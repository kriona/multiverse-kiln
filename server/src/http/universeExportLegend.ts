/**
 * The legend an export of the world holds beside its areas' cells (UNIVERSE_EXPORT_AREA_LEGEND): how to
 * read an ExportedAreaCells file, which tile each number in its cells is, and which area each file is,
 * in Markdown, in the language of the player exporting it
 */
import { CHUNK_SIZE, DEFAULT_TILE_CELL, DEFAULT_TILE_NAMES, defineMessages, VOID_CELL, type ExportedArea, type ExportedTile, type Ruleset, type Translator } from '@multiverse-kiln/shared';

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
		defaultMessage: 'Each JSON file in this folder holds one area\'s cells: which tile is on each square of its ground. The Areas table below says which area each file is.',
		description: 'First paragraph of the legend file in the areas folder of a universe\'s exported zip file'
	},
	readingHeading: {
		id: 'export.legend.readingHeading',
		defaultMessage: 'Reading a file',
		description: 'Heading of the part of the legend file in a universe\'s exported zip file that explains how an area\'s cells are laid out in its file'
	},
	chunkSize: {
		id: 'export.legend.chunkSize',
		defaultMessage: '"chunkSize" is how many cells run along each side of a chunk: {size, number}.',
		description: 'Line of the legend file in a universe\'s exported zip file explaining a field of an area\'s file; keep "chunkSize" as it is, since it is the field\'s name in the file. {size} is the number'
	},
	chunks: {
		id: 'export.legend.chunks',
		defaultMessage: '"chunks" lists the area\'s chunks: squares of {size, number} by {size, number} cells. A chunk that isn\'t listed holds only the area\'s default tile.',
		description: 'Line of the legend file in a universe\'s exported zip file explaining a field of an area\'s file; keep "chunks" as it is, since it is the field\'s name in the file. {size} is the cells along each side of a chunk'
	},
	position: {
		id: 'export.legend.position',
		defaultMessage: '"chunkColumn" and "chunkRow" say where a chunk is, counted in chunks. The chunk at column 0, row 0 starts at the area\'s cell at column 0, row 0 and runs east and south from it; columns grow to the east and rows to the south.',
		description: 'Line of the legend file in a universe\'s exported zip file explaining two fields of an area\'s file; keep "chunkColumn" and "chunkRow" as they are, since they are the fields\' names in the file'
	},
	cells: {
		id: 'export.legend.cells',
		defaultMessage: '"cells" holds the chunk\'s {count, number} cells row by row, starting at its north-west corner: the first {size, number} are its top row, from west to east, then the next row down, and so on.',
		description: 'Line of the legend file in a universe\'s exported zip file explaining a field of an area\'s file; keep "cells" as it is, since it is the field\'s name in the file. {count} is how many cells a chunk has, {size} how many along each side'
	},
	formula: {
		id: 'export.legend.formula',
		defaultMessage: 'The cell at place n in the list, counting from 0, is on column chunkColumn × {size, number} + (n mod {size, number}) and row chunkRow × {size, number} + floor(n ÷ {size, number}) of the area.',
		description: 'Line of the legend file in a universe\'s exported zip file giving the arithmetic that finds a cell\'s square from its place in a chunk\'s list; keep chunkColumn and chunkRow as they are, since they are the fields\' names in the file. {size} is the cells along each side of a chunk'
	},
	outside: {
		id: 'export.legend.outside',
		defaultMessage: 'A chunk on the edge of an area can reach past it. Its cells outside the columns and rows the Areas table gives aren\'t part of the area.',
		description: 'Line of the legend file in a universe\'s exported zip file explaining that chunks are whole squares even where an area\'s edge cuts through them'
	},
	values: {
		id: 'export.legend.values',
		defaultMessage: 'Each cell holds the number of a tile in the Tiles table below, {defaultCell, number} for the area\'s default tile (which the Areas table names), or {voidCell, number} for nothing at all: void, drawn black, which no one can enter.',
		description: 'Line of the legend file in a universe\'s exported zip file explaining the numbers in an area\'s cells; {defaultCell} and {voidCell} are the two numbers that aren\'t tiles'
	},
	example: {
		id: 'export.legend.example',
		defaultMessage: 'For example, place {place, number} of the list in the chunk at column -1, row 0 is the second cell of the chunk\'s second row: column {column, number}, row 1 of the area.',
		description: 'Line of the legend file in a universe\'s exported zip file working through finding one cell\'s square; {place} is the place in a chunk\'s list of cells, and {column} the column it works out to'
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
 * @param areas The areas the export lists
 * @param translator The language the player exporting reads
 * @return The legend, in Markdown
 */
export function areaCellsLegend(universeName: string, ruleset: Ruleset, tiles: readonly ExportedTile[], areas: readonly ExportedArea[], translator: Translator): string
{
	const size = { size: CHUNK_SIZE };
	const tileNames = new Map(tiles.map((tile) => [tile.id, tileName(tile, ruleset, translator)]));
	const lines = [
		`# ${escape(translator.format(messages.title, { universe: universeName }))}`,
		'',
		translator.format(messages.intro),
		'',
		`## ${translator.format(messages.readingHeading)}`,
		'',
		`- ${translator.format(messages.chunkSize, size)}`,
		`- ${translator.format(messages.chunks, size)}`,
		`- ${translator.format(messages.position)}`,
		`- ${translator.format(messages.cells, { count: CHUNK_SIZE * CHUNK_SIZE, ...size })}`,
		`- ${translator.format(messages.formula, size)}`,
		`- ${translator.format(messages.outside)}`,
		`- ${translator.format(messages.values, { defaultCell: DEFAULT_TILE_CELL, voidCell: VOID_CELL })}`,
		`- ${translator.format(messages.example, { place: CHUNK_SIZE + 1, column: -CHUNK_SIZE + 1 })}`,
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
