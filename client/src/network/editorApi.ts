import { ServerError, type Client } from '@colyseus/sdk';
import { EDITOR_UNIVERSES_PATH, isLocalizedMessage, MAX_TILES_PER_PAGE, type CellChange, type ChunkListPayload, type ChunkRange, type CreatedPayload, type EditableUniverse, type EditableUniverseListPayload, type EditorTile, type EditorZone, type EditorZoneLink, type MapBounds, type NewUniverseRequest, type NewZoneRequest, type ResizeConflictPayload, type RulesetSettings, type TileListPayload, type TileListQuery, type TileSettings, type UniverseSettingsUpdate, type ZoneLinkListPayload, type ZoneLinkTarget, type ZoneListPayload, type ZoneSettingsUpdate, type MessageSource } from '@multiverse-kiln/shared';

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
		const parameters = new URLSearchParams();

		for (const [key, value] of Object.entries(query))
		{
			if (value !== undefined)
			{
				parameters.set(key, String(value));
			}
		}

		return(this.send<TileListPayload>('GET', `${universePath(universeId)}/tiles?${parameters.toString()}`));
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
	 * Every zone of a universe
	 *
	 * @param universeId The universe's ID
	 * @return The zones, and which are the lobby and starting zones
	 */
	async listZones(universeId: string): Promise<ZoneListPayload>
	{
		return(this.send<ZoneListPayload>('GET', `${universePath(universeId)}/zones`));
	}

	/**
	 * Adds a zone to a universe
	 *
	 * @param universeId The universe's ID
	 * @param zone The zone's name and any settings that shouldn't take their defaults
	 * @return The new zone's ID
	 */
	async createZone(universeId: string, zone: NewZoneRequest): Promise<string>
	{
		return((await this.send<CreatedPayload>('POST', `${universePath(universeId)}/zones`, zone)).id);
	}

	/**
	 * A zone's settings and bounds
	 *
	 * @param universeId The universe's ID
	 * @param zoneId The zone's ID
	 * @return The zone
	 */
	async getZone(universeId: string, zoneId: string): Promise<EditorZone>
	{
		return(this.send<EditorZone>('GET', zonePath(universeId, zoneId)));
	}

	/**
	 * Changes a zone's settings
	 *
	 * @param universeId The universe's ID
	 * @param zoneId The zone's ID
	 * @param update The settings to change
	 */
	async updateZone(universeId: string, zoneId: string, update: ZoneSettingsUpdate): Promise<void>
	{
		await this.send('PATCH', zonePath(universeId, zoneId), update);
	}

	/**
	 * Deletes a zone
	 *
	 * @param universeId The universe's ID
	 * @param zoneId The zone's ID
	 */
	async deleteZone(universeId: string, zoneId: string): Promise<void>
	{
		await this.send('DELETE', zonePath(universeId, zoneId));
	}

	/**
	 * Gives a zone's map new bounds
	 *
	 * @param universeId The universe's ID
	 * @param zoneId The zone's ID
	 * @param bounds The new bounds
	 * @param discard Whether to go ahead when that discards painted cells or links
	 * @return undefined when the map was resized, or what would be discarded when it wasn't
	 */
	async resizeZone(universeId: string, zoneId: string, bounds: MapBounds, discard: boolean): Promise<ResizeConflictPayload | undefined>
	{
		try
		{
			await this.send('PUT', `${zonePath(universeId, zoneId)}/bounds`, { bounds, discard });
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
	 * The stored chunks of a zone's map in a range
	 *
	 * @param universeId The universe's ID
	 * @param zoneId The zone's ID
	 * @param range The chunks, inclusive at both ends
	 * @return The stored chunks
	 */
	async loadChunks(universeId: string, zoneId: string, range: ChunkRange): Promise<ChunkListPayload>
	{
		const parameters = new URLSearchParams(Object.entries(range).map(([key, value]) => [key, String(value)]));

		return(this.send<ChunkListPayload>('GET', `${zonePath(universeId, zoneId)}/chunks?${parameters.toString()}`));
	}

	/**
	 * Changes cells of a zone's map
	 *
	 * @param universeId The universe's ID
	 * @param zoneId The zone's ID
	 * @param changes Up to MAX_CELL_CHANGES cells
	 */
	async editCells(universeId: string, zoneId: string, changes: CellChange[]): Promise<void>
	{
		await this.send('PATCH', `${zonePath(universeId, zoneId)}/cells`, { changes });
	}

	/**
	 * The links on a zone's cells
	 *
	 * @param universeId The universe's ID
	 * @param zoneId The zone's ID
	 * @return The links
	 */
	async listLinks(universeId: string, zoneId: string): Promise<EditorZoneLink[]>
	{
		return((await this.send<ZoneLinkListPayload>('GET', `${zonePath(universeId, zoneId)}/links`)).links);
	}

	/**
	 * Adds or replaces the link on a cell
	 *
	 * @param universeId The universe's ID
	 * @param zoneId The zone's ID
	 * @param column The cell's column
	 * @param row The cell's row
	 * @param target Where the link goes
	 */
	async saveLink(universeId: string, zoneId: string, column: number, row: number, target: ZoneLinkTarget): Promise<void>
	{
		await this.send('PUT', `${zonePath(universeId, zoneId)}/links/${column}/${row}`, target);
	}

	/**
	 * Deletes the link on a cell
	 *
	 * @param universeId The universe's ID
	 * @param zoneId The zone's ID
	 * @param column The cell's column
	 * @param row The cell's row
	 */
	async deleteLink(universeId: string, zoneId: string, column: number, row: number): Promise<void>
	{
		await this.send('DELETE', `${zonePath(universeId, zoneId)}/links/${column}/${row}`);
	}

	/**
	 * Sends a request to an editor route
	 *
	 * @param method The HTTP method
	 * @param path The path under EDITOR_UNIVERSES_PATH
	 * @param body The JSON body, if any
	 * @return The response body
	 */
	private async send<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: object): Promise<T>
	{
		const http = this.client.http;
		const url = `${EDITOR_UNIVERSES_PATH}${path}`;
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
 * The path of a zone under EDITOR_UNIVERSES_PATH
 *
 * @param universeId The universe's ID
 * @param zoneId The zone's ID
 * @return The path
 */
function zonePath(universeId: string, zoneId: string): string
{
	return(`${universePath(universeId)}/zones/${encodeURIComponent(zoneId)}`);
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
 * @return The message
 */
export function describeEditorError(error: unknown, failure: MessageSource): string
{
	if (error instanceof EditorApiError)
	{
		return(t({
			id: 'editor.error.failedBecause',
			defaultMessage: '{failure} {reason}',
			description: 'An editor action that failed, followed by why; {failure} is e.g. "Could not save the tile." and {reason} is the server\'s explanation. Change only to reorder the two sentences'
		}, {
			failure: t(failure),
			reason: error.message
		}));
	}

	console.error(failure.defaultMessage, error);

	return(t({
		id: 'editor.error.tryAgain',
		defaultMessage: '{failure} Try again in a moment.',
		description: 'An editor action that failed for a reason the player can\'t do anything about; {failure} is e.g. "Could not save the tile."'
	}, { failure: t(failure) }));
}
