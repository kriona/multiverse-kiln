/**
 * Requests to the world editor's API for tests: logged-in browsers, sending requests, and making the
 * universes and areas a test starts from
 */
import assert from 'assert';
import { randomUUID } from 'crypto';
import { EDITOR_UNIVERSES_PATH, TILE_GRAPHIC_SIZES, type CreatedPayload, type EditorChange, type NewRef, type Ruleset, type SaveChangesPayload, type SaveRefusedPayload } from '@multiverse-kiln/shared';
import sharp from 'sharp';

import { loadOrCreatePlayerByName } from '../src/db/playerRepo.js';
import { BROWSER_ID_COOKIE } from '../src/http/browserId.js';
import { onlinePlayers } from '../src/players/onlinePlayers.js';
import { testServerUrl } from './testServer.js';

/**
 * A logged-in browser to make editor requests from
 */
export interface Editor
{
	browserId: string;
	playerId: string;
}

/**
 * What an editor request answered
 */
export interface EditorResponse<T>
{
	status: number;
	body: T;
	headers: Headers;
}

/**
 * Logs a new browser in as a player
 *
 * @param name The player's name
 * @return The browser and its player
 */
export async function logIn(name: string): Promise<Editor>
{
	const browserId = randomUUID();
	const { id: playerId } = await loadOrCreatePlayerByName(name);

	onlinePlayers.logIn(browserId, playerId, name);

	return({ browserId, playerId });
}

/**
 * Sends a request to an editor route
 *
 * @param editor The browser sending it, or undefined for one that isn't logged in
 * @param method The HTTP method
 * @param path The path under EDITOR_UNIVERSES_PATH, starting with / (or empty)
 * @param options The JSON body, a raw body, and the Origin header to send
 * @return The status, the parsed JSON body (undefined when there is none) and the headers
 */
export async function send<T = unknown>(editor: Editor | undefined, method: string, path: string, options: { body?: unknown; rawBody?: string; origin?: string } = {}): Promise<EditorResponse<T>>
{
	const headers: Record<string, string> = {};

	if (editor)
	{
		headers['Cookie'] = `${BROWSER_ID_COOKIE}=${editor.browserId}`;
	}

	if (options.origin !== undefined)
	{
		headers['Origin'] = options.origin;
	}

	if ((options.body !== undefined) || (options.rawBody !== undefined))
	{
		headers['Content-Type'] = 'application/json';
	}

	const response = await fetch(`${testServerUrl}${EDITOR_UNIVERSES_PATH}${path}`, {
		method,
		headers,
		body: (options.rawBody ?? ((options.body === undefined) ? undefined : JSON.stringify(options.body)))
	});
	const text = await response.text();

	return({
		status: response.status,
		body: ((text === '') ? undefined : JSON.parse(text)) as T,
		headers: response.headers
	});
}

/**
 * Saves editor changes to a universe in one request
 *
 * @param editor The browser saving them
 * @param universeId The universe's ID
 * @param changes The changes
 * @return The answer: the IDs of the things made, or why the save was refused
 */
export async function saveChanges(editor: Editor, universeId: string, changes: unknown[]): Promise<EditorResponse<SaveChangesPayload & SaveRefusedPayload>>
{
	return(send<SaveChangesPayload & SaveRefusedPayload>(editor, 'POST', `/${universeId}/changes`, { body: { changes } }));
}

/**
 * What saving one change answered, with the ID of what a create change made as id
 */
export type SaveAnswer<Id extends number | string = number> = EditorResponse<SaveChangesPayload & SaveRefusedPayload & { id: Id }>;

/**
 * Saves one editor change
 *
 * @param editor The browser saving it
 * @param universeId The universe's ID
 * @param change The change, which may name things that don't exist or be invalid
 * @return The answer, with the ID of what a create change made as id: a number, unless Id says otherwise
 */
export async function saveChange<Id extends number | string = number>(editor: Editor, universeId: string, change: Record<string, unknown>): Promise<SaveAnswer<Id>>
{
	const response = await saveChanges(editor, universeId, [change]);
	const ref = change.ref;
	const id = (((response.status === 200) && (typeof ref === 'string')) ? response.body.ids[ref as NewRef] : undefined);

	return({ ...response, body: { ...response.body, id: id as Id } });
}

/**
 * Saves editor changes that must all be saved
 *
 * @param editor The browser saving them
 * @param universeId The universe's ID
 * @param changes The changes
 * @return The ID each thing made was saved with, by its ref
 */
export async function saveAll(editor: Editor, universeId: string, changes: EditorChange[]): Promise<SaveChangesPayload['ids']>
{
	const response = await saveChanges(editor, universeId, changes);

	assert.strictEqual(response.status, 200, JSON.stringify(response.body));

	return(response.body.ids);
}

/**
 * Creates a universe through the API
 *
 * @param editor The browser creating it
 * @param name The universe's name
 * @param ruleset The universe's ruleset
 * @return The universe's ID
 */
export async function createUniverse(editor: Editor, name: string = 'Kilnhaven', ruleset: Ruleset = 'pf1e'): Promise<string>
{
	const response = await send<CreatedPayload>(editor, 'POST', '', { body: { name, shortDescription: 'A small town.', ruleset } });

	assert.strictEqual(response.status, 201, JSON.stringify(response.body));

	return(response.body.id);
}

/**
 * Creates an area through the API
 *
 * @param editor The browser creating it
 * @param universeId The universe's ID
 * @param settings The area's settings
 * @return The area's ID
 */
export async function createArea(editor: Editor, universeId: string, settings: Record<string, unknown> = {}): Promise<string>
{
	const response = await saveChange<string>(editor, universeId, { kind: 'createArea', ref: 'new:area', area: { name: 'Meadow', ...settings } });

	assert.strictEqual(response.status, 200, JSON.stringify(response.body));

	return(response.body.id);
}

/**
 * A PNG filled with one color
 *
 * @param size Its width and height in pixels: a Dual-Grid sheet's, unless given
 * @param withCopyright Whether to give it metadata, which uploads must not keep
 * @return The PNG, base64-encoded as an upload carries it
 */
export async function solidPng(size: { width: number; height: number } = TILE_GRAPHIC_SIZES.dualGrid, withCopyright: boolean = false): Promise<string>
{
	let image = sharp({
		create: {
			width: size.width,
			height: size.height,
			channels: 4,
			background: { r: 40, g: 140, b: 60, alpha: 1 }
		}
	});

	if (withCopyright)
	{
		image = image.withExif({ IFD0: { Copyright: 'hidden-metadata-marker' } });
	}

	return((await image.png().toBuffer()).toString('base64'));
}
