/**
 * Characters' avatars: what each one draws now, and their PNGs in object storage (see Avatars in
 * STRUCTURE-OVERVIEW.md)
 *
 * A character's avatar is stored once, at avatarStorageKey(), with the hash of the layers it was made from
 * in characters.avatar_hash. Pages ask for it with the hash of the character's look now, which the server
 * sends with the character, and the avatar route makes it again first when the stored one is out of date.
 * So nothing has to make an avatar as the look changes: equipping, a universe save unequipping items or
 * changing "Looks like", and new art all show the next time it is asked for
 *
 * Create Character's previews (the base over the background, without items) are stored the same way,
 * one for each art type, race, body type and background, with their hash in the file's metadata
 */
import { avatarPicture, AVATAR_MANIFEST, layersHash, type AvatarEquippedItem, type AvatarLook, type AvatarManifest, type AvatarPicture, type Ruleset } from '@multiverse-kiln/shared';

import { findStoredLooks, saveAvatarHash, type StoredLook } from '../db/avatarRepo.js';
import { listLayeredEquipmentOf } from '../db/equipmentRepo.js';
import { findAvatarItemKeys } from '../db/itemRepo.js';
import { findAvatarRaceKeys } from '../db/raceRepo.js';
import { getObject, getObjectWithMetadata, putObject } from '../storage/objectStorage.js';
import { composeLayers, fileVersionsOf, useArtFolder } from './avatarArt.js';

/**
 * The metadata key a stored preview keeps its hash under
 */
const PREVIEW_HASH_METADATA = 'look-hash';

/**
 * The manifest avatars are drawn from: AVATAR_MANIFEST, but for tests
 */
let manifest: AvatarManifest = AVATAR_MANIFEST;

/**
 * Draws avatars from another manifest and art folder, for tests that make their own art
 *
 * @param art The manifest and the folder its files are in, or undefined for the engine's
 */
export function useAvatarArt(art: { manifest: AvatarManifest; folder: string } | undefined): void
{
	manifest = (art?.manifest ?? AVATAR_MANIFEST);
	useArtFolder(art?.folder);
}

/**
 * The manifest avatars are drawn from
 *
 * @return The manifest
 */
export function avatarManifest(): AvatarManifest
{
	return(manifest);
}

/**
 * A character's avatar now
 */
export interface CharacterAvatar
{
	look: StoredLook;

	/**
	 * The key of the default race the character is drawn as, or null when their race looks like none
	 */
	raceKey: string | null;

	/**
	 * What it draws, with the hash of its layers and their files; null when the character has no avatar
	 */
	picture: AvatarPicture | null;
}

/**
 * Where a character's avatar is stored
 *
 * @param characterId The character's ID
 * @return The key in object storage
 */
export function avatarStorageKey(characterId: string): string
{
	return(`avatars/${characterId}.png`);
}

/**
 * Where a preview is stored
 *
 * @param artType The art type
 * @param ruleset The ruleset
 * @param raceKey The default race's key
 * @param bodyType The body type
 * @param background The background
 * @return The key in object storage
 */
function previewStorageKey(artType: string, ruleset: Ruleset, raceKey: string, bodyType: string, background: string): string
{
	return(`avatars/previews/${artType}/${ruleset}/${raceKey}-${bodyType}-${background}.png`);
}

/**
 * What a picture draws, with its hash counting its files' versions
 *
 * @param look The look
 * @return The picture, or null for no avatar
 */
async function versionedPicture(look: AvatarLook): Promise<AvatarPicture | null>
{
	const picture = avatarPicture(manifest, look);

	if (picture === null)
	{
		return(null);
	}

	return({
		...picture,
		hash: layersHash(picture.layers, await fileVersionsOf(picture.layers))
	});
}

/**
 * The avatars of some characters now, in a few queries however many there are
 *
 * @param characterIds The characters' IDs
 * @return Each character's avatar, by ID; a character who doesn't exist is left out
 */
export async function findCharacterAvatars(characterIds: readonly string[]): Promise<Map<string, CharacterAvatar>>
{
	const [looks, equipment] = await Promise.all([
		findStoredLooks(characterIds),
		listLayeredEquipmentOf(characterIds)
	]);
	const itemIds = [...equipment.values()].flatMap((items) => items.map((item) => item.itemId));
	const [raceKeys, itemKeys] = await Promise.all([
		findAvatarRaceKeys([...looks.values()].map((look) => look.raceId)),
		findAvatarItemKeys(itemIds)
	]);
	const avatars = new Map<string, CharacterAvatar>();

	for (const look of looks.values())
	{
		const equipped: AvatarEquippedItem[] = (equipment.get(look.characterId) ?? []).map(({ layer, slot, itemId, bothHands }) => ({
			layer,
			slot,
			itemKey: (itemKeys.get(itemId) ?? null),
			bothHands
		}));

		const raceKey = (raceKeys.get(look.raceId) ?? null);

		avatars.set(look.characterId, {
			look,
			raceKey,
			picture: await versionedPicture({
				ruleset: look.ruleset,
				raceKey,
				bodyType: look.bodyType,
				artType: look.artType,
				background: look.background,
				equipment: equipped,
				hiddenSlots: look.hiddenSlots
			})
		});
	}

	return(avatars);
}

/**
 * The hash of the avatar of each of some characters now, which pages ask for it with
 *
 * @param characterIds The characters' IDs
 * @return Each character's hash, by ID; null for a character with no avatar, and one who doesn't exist
 * is left out
 */
export async function avatarHashesOf(characterIds: readonly string[]): Promise<Map<string, string | null>>
{
	const avatars = await findCharacterAvatars(characterIds);

	return(new Map([...avatars].map(([characterId, { picture }]) => [characterId, (picture?.hash ?? null)])));
}

/**
 * The hash of one character's avatar now
 *
 * @param characterId The character's ID
 * @return The hash, or null for a character with no avatar or who doesn't exist
 */
export async function avatarHashOf(characterId: string): Promise<string | null>
{
	return((await avatarHashesOf([characterId])).get(characterId) ?? null);
}

/**
 * A character's avatar as a PNG, made and stored again first when the stored one isn't of their look now
 *
 * @param characterId The character's ID
 * @param knownEtag The ETag the browser already has the avatar with, if any: when it is the hash of the
 * look now (quoted), the PNG isn't read
 * @return The PNG, or null when the browser already has it, and the hash of the look it draws; undefined
 * when the character has no avatar or doesn't exist
 */
export async function characterAvatarPng(characterId: string, knownEtag?: string): Promise<{ png: Buffer | null; hash: string } | undefined>
{
	const avatar = (await findCharacterAvatars([characterId])).get(characterId);
	const picture = avatar?.picture;

	if (!avatar || !picture)
	{
		return(undefined);
	}

	if ((knownEtag === `"${picture.hash}"`) && (avatar.look.avatarHash === picture.hash))
	{
		return({
			png: null,
			hash: picture.hash
		});
	}

	const stored = ((avatar.look.avatarHash === picture.hash) ? await getObject(avatarStorageKey(characterId)) : undefined);

	if (stored)
	{
		return({
			png: stored,
			hash: picture.hash
		});
	}

	const png = await composeLayers(picture.layers);

	await putObject(avatarStorageKey(characterId), png, 'image/png');
	await saveAvatarHash(characterId, picture.hash);

	return({
		png,
		hash: picture.hash
	});
}

/**
 * What a preview draws: the base over the background, without items
 *
 * @param artType The art type
 * @param ruleset The ruleset
 * @param raceKey The default race's key
 * @param bodyType The body type
 * @param background The background
 * @return The picture, or null when nothing is drawn for it
 */
export async function previewPicture(artType: string, ruleset: Ruleset, raceKey: string, bodyType: string, background: string): Promise<AvatarPicture | null>
{
	return(versionedPicture({
		ruleset,
		raceKey,
		bodyType,
		artType,
		background,
		equipment: [],
		hiddenSlots: []
	}));
}

/**
 * A preview as a PNG, made and stored again first when the stored one isn't of the picture now. Every
 * player choosing the same art type, race, body type and background shares it
 *
 * @param picture What the preview draws (previewPicture())
 * @param artType The art type asked for
 * @param ruleset The ruleset
 * @param raceKey The default race's key
 * @param bodyType The body type asked for
 * @param background The background
 * @return The PNG
 */
export async function previewPng(picture: AvatarPicture, artType: string, ruleset: Ruleset, raceKey: string, bodyType: string, background: string): Promise<Buffer>
{
	const key = previewStorageKey(artType, ruleset, raceKey, bodyType, background);
	const stored = await getObjectWithMetadata(key);

	if (stored && (stored.metadata[PREVIEW_HASH_METADATA] === picture.hash))
	{
		return(stored.body);
	}

	const png = await composeLayers(picture.layers);

	await putObject(key, png, 'image/png', { [PREVIEW_HASH_METADATA]: picture.hash });
	return(png);
}
