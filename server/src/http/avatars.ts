/**
 * The avatar routes, open to anyone with the address like uploaded tile graphics: character IDs are random,
 * and an avatar shows only what is drawn (see Avatars in STRUCTURE-OVERVIEW.md)
 *
 * - GET AVATARS_PATH/<character ID>.png?look=<hash>: a character's avatar. Asked for with the hash of the
 *   character's look now, which the server sends with the character, it is kept by browsers for good; with
 *   any other hash, or none, they ask again each time, and get 304 while its ETag, the hash, is the same
 * - GET AVATAR_PREVIEWS_PATH/<art type>/<ruleset>/<race key>-<body type>-<background>.png: Create
 *   Character's preview of a base over a background. Its ETag is its hash, so browsers ask whether it
 *   changed each time and get 304 while it hasn't
 *
 * Colyseus's CORS hook (responseHeaders.ts) lets the allowed origins read them
 */
import type { Application, Request, Response } from 'express';
import { AVATAR_PREVIEWS_PATH, AVATARS_PATH, defineMessages, isAvatarBackground, raceBodyTypes, RULESETS, type Ruleset } from '@multiverse-kiln/shared';

import { avatarManifest, characterAvatarPng, previewPicture, previewPng } from '../avatars/characterAvatars.js';
import { sendError } from './errors.js';

/**
 * How long browsers may keep an avatar asked for with its hash: a year, the most HTTP caches honor
 */
const CACHE_SECONDS = 365 * 24 * 60 * 60;

/**
 * An avatar's file name: the character's ID, then .png
 */
const AVATAR_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.png$/;

/**
 * A preview's file name: the race's key, the body type and the background, then .png
 */
const PREVIEW_FILE = /^([a-z_]+)-([A-Za-z]+)-([A-Za-z]+)\.png$/;

const messages = defineMessages({
	noSuchAvatar: {
		id: 'error.noSuchAvatar',
		defaultMessage: 'The character has no avatar.',
		description: 'Why a character\'s avatar (the picture of the character) couldn\'t be loaded: there is no such character, or nothing is drawn for their race yet'
	},
	noSuchPreview: {
		id: 'error.noSuchAvatarPreview',
		defaultMessage: 'Nothing is drawn for that appearance.',
		description: 'Why the preview of a character\'s avatar on Create Character\'s Appearance step couldn\'t be loaded: no art is drawn for the race, body type and art type chosen'
	}
});

/**
 * Adds the avatar routes
 *
 * @param app Express app to add the routes to
 */
export function addAvatarRoutes(app: Application): void
{
	app.get(`${AVATARS_PATH}/:file`, serveAvatar);
	app.get(`${AVATAR_PREVIEWS_PATH}/:artType/:ruleset/:file`, servePreview);
}

/**
 * GET AVATARS_PATH/:file: a character's avatar
 *
 * @param request The request
 * @param response The response
 */
async function serveAvatar(request: Request, response: Response): Promise<void>
{
	const characterId = AVATAR_FILE.exec(String(request.params.file))?.[1];
	const avatar = ((characterId === undefined) ? undefined : await characterAvatarPng(characterId, request.get('If-None-Match')));

	if (!avatar)
	{
		sendError(response, 404, messages.noSuchAvatar);
		return;
	}

	response.set('Cache-Control', ((request.query.look === avatar.hash) ? `public, max-age=${CACHE_SECONDS}, immutable` : 'no-cache'));
	response.set('ETag', etagOf(avatar.hash));

	if (avatar.png === null)
	{
		response.sendStatus(304);
		return;
	}

	response.type('png').send(avatar.png);
}

/**
 * The ETag of an avatar or preview: its hash, quoted
 *
 * @param hash The hash
 * @return The ETag
 */
export function etagOf(hash: string): string
{
	return(`"${hash}"`);
}

/**
 * GET AVATAR_PREVIEWS_PATH/:artType/:ruleset/:file: a preview of a base over a background
 *
 * @param request The request
 * @param response The response
 */
async function servePreview(request: Request, response: Response): Promise<void>
{
	const artType = String(request.params.artType);
	const ruleset = String(request.params.ruleset);
	const [, raceKey, bodyType, background] = (PREVIEW_FILE.exec(String(request.params.file)) ?? []);

	if (!Object.hasOwn(avatarManifest().artTypes, artType) || !(RULESETS as readonly string[]).includes(ruleset) || (raceKey === undefined) || !raceBodyTypes(ruleset as Ruleset, raceKey).some((each) => (each === bodyType)) || !isAvatarBackground(background))
	{
		sendError(response, 404, messages.noSuchPreview);
		return;
	}

	const picture = await previewPicture(artType, ruleset as Ruleset, raceKey, bodyType, background);

	if (!picture)
	{
		sendError(response, 404, messages.noSuchPreview);
		return;
	}

	const etag = etagOf(picture.hash);

	response.set('Cache-Control', 'no-cache');
	response.set('ETag', etag);

	if (request.get('If-None-Match') === etag)
	{
		response.sendStatus(304);
		return;
	}

	response.type('png').send(await previewPng(picture, artType, ruleset as Ruleset, raceKey, bodyType, background));
}
