import type { AreaLinkTarget, ChunkListPayload, ChunkRange, EditorArea, EditorAreaLink } from '@multiverse-kiln/shared';

/**
 * Where the map editor and the link dialog get an area, its links and its map's chunks: the server for
 * a saved area, and the page for one added since the Areas tab was last saved
 */
export interface AreaSource
{
	/**
	 * An area's settings and bounds
	 *
	 * @param areaId The area's ID
	 * @return The area
	 */
	getArea(areaId: string): Promise<EditorArea>;

	/**
	 * The links on an area's cells
	 *
	 * @param areaId The area's ID
	 * @return The links
	 */
	listLinks(areaId: string): Promise<EditorAreaLink[]>;

	/**
	 * The stored chunks in a range of an area's map
	 *
	 * @param areaId The area's ID
	 * @param range The chunks
	 * @return The stored chunks
	 */
	loadChunks(areaId: string, range: ChunkRange): Promise<ChunkListPayload>;
}

/**
 * A link added, changed or deleted on a cell, kept on the page until the Areas tab is saved
 */
export interface LinkChange
{
	/**
	 * The area the cell is in
	 */
	areaId: string;

	column: number;
	row: number;

	/**
	 * Where the link goes, or null to delete it
	 */
	target: AreaLinkTarget | null;
}
