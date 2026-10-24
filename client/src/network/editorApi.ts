import { ServerError, type Client } from '@colyseus/sdk';
import { EDITOR_UNIVERSES_PATH, isLocalizedMessage, MAX_TILES_PER_PAGE, type CellChange, type ChunkListPayload, type ChunkRange, type ClassListPayload, type ClassSettings, type CreatedPayload, type DifficultyLevel, type DifficultyLevelListPayload, type DifficultyLevelSettings, type EditableUniverse, type EditableUniverseListPayload, type EditorClass, type EditorRace, type EditorTile, type EditorArea, type EditorAreaLink, type ItemListPayload, type ItemListQuery, type ItemSettings, type MapBounds, type NewUniverseRequest, type NewAreaRequest, type RaceListPayload, type RaceSettings, type ResizeConflictPayload, type RulesetSettings, type EditorTheme, type ThemeListPayload, type ThemeSettings, type TileListPayload, type TileListQuery, type TileSettings, type UniverseSettingsUpdate, type AreaLinkListPayload, type AreaLinkTarget, type AreaListPayload, type AreaSettingsUpdate, type MessageSource, type MessageValues } from '@multiverse-kiln/shared';

import { localizedText, t } from '../localization';

/**
 * A request to the world editor's API that the server refused or couldn't answer
 */
export class EditorApiError extends Error
{
	/**
	 * @param message What went wrong, in the player's language
	 * @param status The HTTP status, or 0 when the server couldn't be reached
	 * @param data The response body, for answers that carry more than a message
	 */
	constructor(message: string, readonly status: number, readonly data: unknown)
	{
		super(message);
		this.name = 'EditorApiError';
	}
}

/**
 * The world editor's REST API (see shared/src/editor.ts), for one browser
 *
 * Requests carry the browser ID cookie, so the server knows which player is asking. Every method
 * throws EditorApiError when the server refuses the request
 */
export class EditorApi
{
	/**
	 * @param client Client for the server
	 */
	constructor(private readonly client: Client)
	{
	}

	/**
	 * The universes the player has a role in
	 *
	 * @return The universes, by name
	 */
	async listUniverses(): Promise<EditableUniverseListPayload>
	{
		return(this.send<EditableUniverseListPayload>('GET', ''));
	}

	/**
	 * Creates a universe the player is the creator of
	 *
	 * @param universe What the Create Universe dialog asked for
	 * @return The new universe's ID
	 */
	async createUniverse(universe: NewUniverseRequest): Promise<string>
	{
		return((await this.send<CreatedPayload>('POST', '', universe)).id);
	}

	/**
	 * A universe's settings and the player's role in it
	 *
	 * @param universeId The universe's ID
	 * @return The universe
	 */
	async getUniverse(universeId: string): Promise<EditableUniverse>
	{
		return(this.send<EditableUniverse>('GET', universePath(universeId)));
	}

	/**
	 * Changes a universe's settings
	 *
	 * @param universeId The universe's ID
	 * @param update The settings to change
	 */
	async updateUniverse(universeId: string, update: UniverseSettingsUpdate): Promise<void>
	{
		await this.send('PATCH', universePath(universeId), update);
	}

	/**
	 * How a universe plays under its ruleset
	 *
	 * @param universeId The universe's ID
	 * @return The settings
	 */
	async getRulesetSettings(universeId: string): Promise<RulesetSettings>
	{
		return(this.send<RulesetSettings>('GET', `${universePath(universeId)}/ruleset`));
	}

	/**
	 * Changes how a universe plays under its ruleset
	 *
	 * @param universeId The universe's ID
	 * @param settings The settings, for the universe's ruleset
	 */
	async saveRulesetSettings(universeId: string, settings: RulesetSettings): Promise<void>
	{
		await this.send('PUT', `${universePath(universeId)}/ruleset`, settings);
	}

	/**
	 * A page of a universe's tiles
	 *
	 * @param universeId The universe's ID
	 * @param query The filters, and which page
	 * @return The page, and how many tiles match
	 */
	async listTiles(universeId: string, query: TileListQuery): Promise<TileListPayload>
	{
		return(this.send<TileListPayload>('GET', `${universePath(universeId)}/tiles?${queryString(query)}`));
	}

	/**
	 * Every tile a universe can use, loaded a page at a time
	 *
	 * @param universeId The universe's ID
	 * @return The tiles
	 */
	async listAllTiles(universeId: string): Promise<EditorTile[]>
	{
		const tiles: EditorTile[] = [];
		let total = 1;

		while (tiles.length < total)
		{
			const page = await this.listTiles(universeId, { offset: tiles.length, limit: MAX_TILES_PER_PAGE });

			if (page.tiles.length === 0)
			{
				break;
			}

			tiles.push(...page.tiles);
			total = page.total;
		}

		return(tiles);
	}

	/**
	 * Adds a tile to a universe
	 *
	 * @param universeId The universe's ID
	 * @param tile The tile's settings
	 * @return The new tile's ID
	 */
	async createTile(universeId: string, tile: TileSettings): Promise<number>
	{
		return((await this.send<CreatedPayload<number>>('POST', `${universePath(universeId)}/tiles`, tile)).id);
	}

	/**
	 * Changes one of a universe's own tiles, or stores its edited copy of a default tile
	 *
	 * @param universeId The universe's ID
	 * @param tileId The tile's ID
	 * @param tile The tile's settings
	 */
	async saveTile(universeId: string, tileId: number, tile: TileSettings): Promise<void>
	{
		await this.send('PUT', `${universePath(universeId)}/tiles/${tileId}`, tile);
	}

	/**
	 * Deletes one of a universe's own tiles, or restores a default tile it has edited
	 *
	 * @param universeId The universe's ID
	 * @param tileId The tile's ID
	 */
	async deleteTile(universeId: string, tileId: number): Promise<void>
	{
		await this.send('DELETE', `${universePath(universeId)}/tiles/${tileId}`);
	}

	/**
	 * A page of a universe's items
	 *
	 * @param universeId The universe's ID
	 * @param query The filters, and which page
	 * @return The page, and how many items match
	 */
	async listItems(universeId: string, query: ItemListQuery): Promise<ItemListPayload>
	{
		return(this.send<ItemListPayload>('GET', `${universePath(universeId)}/items?${queryString(query)}`));
	}

	/**
	 * Adds an item to a universe
	 *
	 * @param universeId The universe's ID
	 * @param item The item's settings
	 * @return The new item's ID
	 */
	async createItem(universeId: string, item: ItemSettings): Promise<number>
	{
		return((await this.send<CreatedPayload<number>>('POST', `${universePath(universeId)}/items`, item)).id);
	}

	/**
	 * Changes one of a universe's own items, or stores its edited copy of a default item
	 *
	 * @param universeId The universe's ID
	 * @param itemId The item's ID
	 * @param item The item's settings
	 */
	async saveItem(universeId: string, itemId: number, item: ItemSettings): Promise<void>
	{
		await this.send('PUT', `${universePath(universeId)}/items/${itemId}`, item);
	}

	/**
	 * Deletes one of a universe's own items, or restores a default item it has edited
	 *
	 * @param universeId The universe's ID
	 * @param itemId The item's ID
	 */
	async deleteItem(universeId: string, itemId: number): Promise<void>
	{
		await this.send('DELETE', `${universePath(universeId)}/items/${itemId}`);
	}

	/**
	 * Every race a universe can use
	 *
	 * @param universeId The universe's ID
	 * @return The races, by ID
	 */
	async listRaces(universeId: string): Promise<EditorRace[]>
	{
		return((await this.send<RaceListPayload>('GET', `${universePath(universeId)}/races`)).races);
	}

	/**
	 * Adds a race to a universe
	 *
	 * @param universeId The universe's ID
	 * @param settings The race's settings, with a name
	 * @return The new race's ID
	 */
	async createRace(universeId: string, settings: RaceSettings): Promise<number>
	{
		return((await this.send<CreatedPayload<number>>('POST', `${universePath(universeId)}/races`, settings)).id);
	}

	/**
	 * Changes one of a universe's races, or stores its edited copy of a default race
	 *
	 * @param universeId The universe's ID
	 * @param raceId The race's ID
	 * @param settings The race's settings
	 */
	async saveRace(universeId: string, raceId: number, settings: RaceSettings): Promise<void>
	{
		await this.send('PUT', `${universePath(universeId)}/races/${raceId}`, settings);
	}

	/**
	 * Deletes one of a universe's own races, or restores a default race it has edited
	 *
	 * @param universeId The universe's ID
	 * @param raceId The race's ID
	 */
	async deleteRace(universeId: string, raceId: number): Promise<void>
	{
		await this.send('DELETE', `${universePath(universeId)}/races/${raceId}`);
	}

	/**
	 * Every class a universe can use
	 *
	 * @param universeId The universe's ID
	 * @return The classes, by ID
	 */
	async listClasses(universeId: string): Promise<EditorClass[]>
	{
		return((await this.send<ClassListPayload>('GET', `${universePath(universeId)}/classes`)).classes);
	}

	/**
	 * Adds a class to a universe
	 *
	 * @param universeId The universe's ID
	 * @param settings The class's settings, with a name
	 * @return The new class's ID
	 */
	async createClass(universeId: string, settings: ClassSettings): Promise<number>
	{
		return((await this.send<CreatedPayload<number>>('POST', `${universePath(universeId)}/classes`, settings)).id);
	}

	/**
	 * Changes one of a universe's classes, or stores its edited copy of a default class
	 *
	 * @param universeId The universe's ID
	 * @param classId The class's ID
	 * @param settings The class's settings
	 */
	async saveClass(universeId: string, classId: number, settings: ClassSettings): Promise<void>
	{
		await this.send('PUT', `${universePath(universeId)}/classes/${classId}`, settings);
	}

	/**
	 * Deletes one of a universe's own classes, or restores a default class it has edited
	 *
	 * @param universeId The universe's ID
	 * @param classId The class's ID
	 */
	async deleteClass(universeId: string, classId: number): Promise<void>
	{
		await this.send('DELETE', `${universePath(universeId)}/classes/${classId}`);
	}

	/**
	 * Every theme a universe can use, in a ruleset with themes
	 *
	 * @param universeId The universe's ID
	 * @return The themes, by ID
	 */
	async listThemes(universeId: string): Promise<EditorTheme[]>
	{
		return((await this.send<ThemeListPayload>('GET', `${universePath(universeId)}/themes`)).themes);
	}

	/**
	 * Adds a theme to a universe
	 *
	 * @param universeId The universe's ID
	 * @param settings The theme's settings, with a name
	 * @return The new theme's ID
	 */
	async createTheme(universeId: string, settings: ThemeSettings): Promise<number>
	{
		return((await this.send<CreatedPayload<number>>('POST', `${universePath(universeId)}/themes`, settings)).id);
	}

	/**
	 * Changes one of a universe's themes, or stores its edited copy of a default theme
	 *
	 * @param universeId The universe's ID
	 * @param themeId The theme's ID
	 * @param settings The theme's settings
	 */
	async saveTheme(universeId: string, themeId: number, settings: ThemeSettings): Promise<void>
	{
		await this.send('PUT', `${universePath(universeId)}/themes/${themeId}`, settings);
	}

	/**
	 * Deletes one of a universe's own themes, or restores a default theme it has edited
	 *
	 * @param universeId The universe's ID
	 * @param themeId The theme's ID
	 */
	async deleteTheme(universeId: string, themeId: number): Promise<void>
	{
		await this.send('DELETE', `${universePath(universeId)}/themes/${themeId}`);
	}

	/**
	 * Every difficulty level of a universe
	 *
	 * @param universeId The universe's ID
	 * @return The levels, easiest first
	 */
	async listDifficultyLevels(universeId: string): Promise<DifficultyLevel[]>
	{
		return((await this.send<DifficultyLevelListPayload>('GET', `${universePath(universeId)}/difficulty-levels`)).difficultyLevels);
	}

	/**
	 * Adds a difficulty level to a universe
	 *
	 * @param universeId The universe's ID
	 * @param settings The level's settings, with a name
	 * @return The new level's ID
	 */
	async createDifficultyLevel(universeId: string, settings: DifficultyLevelSettings): Promise<number>
	{
		return((await this.send<CreatedPayload<number>>('POST', `${universePath(universeId)}/difficulty-levels`, settings)).id);
	}

	/**
	 * Changes one of a universe's difficulty levels
	 *
	 * @param universeId The universe's ID
	 * @param levelId The level's ID
	 * @param settings The level's settings
	 */
	async saveDifficultyLevel(universeId: string, levelId: number, settings: DifficultyLevelSettings): Promise<void>
	{
		await this.send('PUT', `${universePath(universeId)}/difficulty-levels/${levelId}`, settings);
	}

	/**
	 * Deletes one of a universe's difficulty levels other than its default, moving its groups to the default
	 *
	 * @param universeId The universe's ID
	 * @param levelId The level's ID
	 */
	async deleteDifficultyLevel(universeId: string, levelId: number): Promise<void>
	{
		await this.send('DELETE', `${universePath(universeId)}/difficulty-levels/${levelId}`);
	}

	/**
	 * Every area of a universe
	 *
	 * @param universeId The universe's ID
	 * @return The areas, and which are the lobby and starting areas
	 */
	async listAreas(universeId: string): Promise<AreaListPayload>
	{
		return(this.send<AreaListPayload>('GET', `${universePath(universeId)}/areas`));
	}

	/**
	 * Adds an area to a universe
	 *
	 * @param universeId The universe's ID
	 * @param area The area's name and any settings that shouldn't take their defaults
	 * @return The new area's ID
	 */
	async createArea(universeId: string, area: NewAreaRequest): Promise<string>
	{
		return((await this.send<CreatedPayload>('POST', `${universePath(universeId)}/areas`, area)).id);
	}

	/**
	 * An area's settings and bounds
	 *
	 * @param universeId The universe's ID
	 * @param areaId The area's ID
	 * @return The area
	 */
	async getArea(universeId: string, areaId: string): Promise<EditorArea>
	{
		return(this.send<EditorArea>('GET', areaPath(universeId, areaId)));
	}

	/**
	 * Changes an area's settings
	 *
	 * @param universeId The universe's ID
	 * @param areaId The area's ID
	 * @param update The settings to change
	 */
	async updateArea(universeId: string, areaId: string, update: AreaSettingsUpdate): Promise<void>
	{
		await this.send('PATCH', areaPath(universeId, areaId), update);
	}

	/**
	 * Deletes an area
	 *
	 * @param universeId The universe's ID
	 * @param areaId The area's ID
	 */
	async deleteArea(universeId: string, areaId: string): Promise<void>
	{
		await this.send('DELETE', areaPath(universeId, areaId));
	}

	/**
	 * Gives an area's map new bounds
	 *
	 * @param universeId The universe's ID
	 * @param areaId The area's ID
	 * @param bounds The new bounds
	 * @param discard Whether to go ahead when that discards painted cells or links
	 * @return undefined when the map was resized, or what would be discarded when it wasn't
	 */
	async resizeArea(universeId: string, areaId: string, bounds: MapBounds, discard: boolean): Promise<ResizeConflictPayload | undefined>
	{
		try
		{
			await this.send('PUT', `${areaPath(universeId, areaId)}/bounds`, { bounds, discard });
		}
		catch (error)
		{
			if ((error instanceof EditorApiError) && (error.status === 409))
			{
				return(error.data as ResizeConflictPayload);
			}

			throw error;
		}

		return(undefined);
	}

	/**
	 * The stored chunks of an area's map in a range
	 *
	 * @param universeId The universe's ID
	 * @param areaId The area's ID
	 * @param range The chunks, inclusive at both ends
	 * @return The stored chunks
	 */
	async loadChunks(universeId: string, areaId: string, range: ChunkRange): Promise<ChunkListPayload>
	{
		const parameters = new URLSearchParams(Object.entries(range).map(([key, value]) => [key, String(value)]));

		return(this.send<ChunkListPayload>('GET', `${areaPath(universeId, areaId)}/chunks?${parameters.toString()}`));
	}

	/**
	 * Changes cells of an area's map
	 *
	 * @param universeId The universe's ID
	 * @param areaId The area's ID
	 * @param changes Up to MAX_CELL_CHANGES cells
	 */
	async editCells(universeId: string, areaId: string, changes: CellChange[]): Promise<void>
	{
		await this.send('PATCH', `${areaPath(universeId, areaId)}/cells`, { changes });
	}

	/**
	 * The links on an area's cells
	 *
	 * @param universeId The universe's ID
	 * @param areaId The area's ID
	 * @return The links
	 */
	async listLinks(universeId: string, areaId: string): Promise<EditorAreaLink[]>
	{
		return((await this.send<AreaLinkListPayload>('GET', `${areaPath(universeId, areaId)}/links`)).links);
	}

	/**
	 * Adds or replaces the link on a cell
	 *
	 * @param universeId The universe's ID
	 * @param areaId The area's ID
	 * @param column The cell's column
	 * @param row The cell's row
	 * @param target Where the link goes
	 */
	async saveLink(universeId: string, areaId: string, column: number, row: number, target: AreaLinkTarget): Promise<void>
	{
		await this.send('PUT', `${areaPath(universeId, areaId)}/links/${column}/${row}`, target);
	}

	/**
	 * Deletes the link on a cell
	 *
	 * @param universeId The universe's ID
	 * @param areaId The area's ID
	 * @param column The cell's column
	 * @param row The cell's row
	 */
	async deleteLink(universeId: string, areaId: string, column: number, row: number): Promise<void>
	{
		await this.send('DELETE', `${areaPath(universeId, areaId)}/links/${column}/${row}`);
	}

	/**
	 * Sends a request to an editor route
	 *
	 * @param method The HTTP method
	 * @param path The path under EDITOR_UNIVERSES_PATH
	 * @param body The JSON body, if any
	 * @return The response body
	 */
	private async send<T = unknown>(method: HttpMethod, path: string, body?: object): Promise<T>
	{
		return(sendRequest<T>(this.client, method, `${EDITOR_UNIVERSES_PATH}${path}`, body));
	}
}

/**
 * The HTTP methods the server's REST routes use
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Sends a request to one of the server's REST routes, with the browser ID cookie
 *
 * @param client Client for the server
 * @param method The HTTP method
 * @param url The route's path
 * @param body The JSON body, if any
 * @return The response body
 * @throws EditorApiError when the server refuses the request or can't be reached
 */
export async function sendRequest<T = unknown>(client: Client, method: HttpMethod, url: string, body?: object): Promise<T>
{
	const http = client.http;
	const options = ((body === undefined) ? undefined : { body });

	try
	{
		let data: unknown;

		switch (method)
		{
			case 'GET':
				data = (await http.get(url, options)).data;
				break;

			case 'POST':
				data = (await http.post(url, options)).data;
				break;

			case 'PUT':
				data = (await http.put(url, options)).data;
				break;

			case 'PATCH':
				data = (await http.patch(url, options)).data;
				break;

			case 'DELETE':
				data = (await http.delete(url, options)).data;
				break;
		}

		return(data as T);
	}
	catch (error)
	{
		if (error instanceof ServerError)
		{
			const status = ((typeof error.status === 'number') ? error.status : 0);

			throw new EditorApiError(describeServerError(status, error.data), status, error.data);
		}

		throw error;
	}
}

/**
 * The path of a universe under EDITOR_UNIVERSES_PATH
 *
 * @param universeId The universe's ID
 * @return The path
 */
function universePath(universeId: string): string
{
	return(`/${encodeURIComponent(universeId)}`);
}

/**
 * A list query as query parameters, leaving out the filters that aren't set
 *
 * @param query The filters, and which page
 * @return The query string, without the ?
 */
function queryString(query: object): string
{
	const parameters = new URLSearchParams();

	for (const [key, value] of Object.entries(query))
	{
		if (value !== undefined)
		{
			parameters.set(key, String(value));
		}
	}

	return(parameters.toString());
}

/**
 * The path of an area under EDITOR_UNIVERSES_PATH
 *
 * @param universeId The universe's ID
 * @param areaId The area's ID
 * @return The path
 */
function areaPath(universeId: string, areaId: string): string
{
	return(`${universePath(universeId)}/areas/${encodeURIComponent(areaId)}`);
}

/**
 * Why the server refused a request, in the player's language
 *
 * @param status The HTTP status, or 0 when the server couldn't be reached
 * @param data The response body, an ErrorPayload
 * @return The reason
 */
function describeServerError(status: number, data: unknown): string
{
	if (status === 0)
	{
		return(t({
			id: 'editor.error.unreachable',
			defaultMessage: 'Could not reach the server.',
			description: 'Why an editor request failed, when the server didn\'t answer'
		}));
	}

	const reason = (((typeof data === 'object') && (data !== null) && ('error' in data)) ? data.error : undefined);

	if (isLocalizedMessage(reason))
	{
		return(localizedText(reason));
	}

	return(t({
		id: 'editor.error.noReason',
		defaultMessage: 'The server refused the request.',
		description: 'Why an editor request failed, when the server didn\'t say why'
	}));
}

/**
 * A message to show for a failed editor request
 *
 * @param error What was thrown
 * @param failure What failed, as a sentence, e.g. "Could not save the tile."
 * @param values The values of the failure message's arguments, if it has any
 * @return The message
 */
export function describeEditorError(error: unknown, failure: MessageSource, values?: MessageValues): string
{
	if (error instanceof EditorApiError)
	{
		return(t({
			id: 'editor.error.failedBecause',
			defaultMessage: '{failure} {reason}',
			description: 'An editor action that failed, followed by why; {failure} is e.g. "Could not save the tile." and {reason} is the server\'s explanation. Change only to reorder the two sentences'
		}, {
			failure: t(failure, values),
			reason: error.message
		}));
	}

	console.error(failure.defaultMessage, error);

	return(t({
		id: 'editor.error.tryAgain',
		defaultMessage: '{failure} Try again in a moment.',
		description: 'An editor action that failed for a reason the player can\'t do anything about; {failure} is e.g. "Could not save the tile."'
	}, {
		failure: t(failure, values)
	}));
}
