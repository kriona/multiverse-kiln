import { ServerError, type Client } from '@colyseus/sdk';
import { EDITOR_UNIVERSES_PATH, isLocalizedMessage, MAX_TILES_PER_PAGE, type ChunkListPayload, type ChunkRange, type ClassListPayload, type CreatedPayload, type DifficultyLevel, type DifficultyLevelListPayload, type EditableUniverse, type EditableUniverseListPayload, type EditorClass, type EditorRace, type EditorTile, type EditorArea, type EditorAreaLink, type ItemListPayload, type ItemListQuery, type NewUniverseRequest, type RaceListPayload, type RulesetSettings, type EditorTheme, type ThemeListPayload, type TileGraphicListPayload, type TileListPayload, type TileListQuery, type TileUsagePayload, type UploadedTileGraphic, type AreaLinkListPayload, type AreaListPayload, type MessageSource, type MessageValues, type EditorChange, type SaveChangesPayload, type SaveChangesRequest } from '@multiverse-kiln/shared';

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
 * Requests carry the session cookie, so the server knows which player is asking. Every method
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
	 * The areas whose maps use one of a universe's tiles
	 *
	 * @param universeId The universe's ID
	 * @param tileId The tile's ID
	 * @return The areas, by name
	 */
	async tileUsage(universeId: string, tileId: number): Promise<TileUsagePayload['areas']>
	{
		return((await this.send<TileUsagePayload>('GET', `${universePath(universeId)}/tiles/${tileId}/usage`)).areas);
	}

	/**
	 * The tile graphics a universe's editors uploaded
	 *
	 * @param universeId The universe's ID
	 * @return The graphics, by name
	 */
	async listTileGraphics(universeId: string): Promise<UploadedTileGraphic[]>
	{
		return((await this.send<TileGraphicListPayload>('GET', `${universePath(universeId)}/tile-graphics`)).graphics);
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
	 * Saves the editor's changes to a universe, all or nothing. A refused save throws an EditorApiError
	 * whose data is a SaveRefusedPayload naming the change refused
	 *
	 * @param universeId The universe's ID
	 * @param changes The changes, in the order the server saves them
	 * @return The ID each thing made was saved with, by its ref
	 */
	async saveChanges(universeId: string, changes: EditorChange[]): Promise<SaveChangesPayload['ids']>
	{
		const body: SaveChangesRequest = { changes };

		return((await this.send<SaveChangesPayload>('POST', `${universePath(universeId)}/changes`, body)).ids);
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
 * Sends a request to one of the server's REST routes, with the session cookie
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
