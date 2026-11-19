/**
 * What an avatar draws: one pure function from a character's look and the manifest to the avatar's
 * layers and their hash (see Avatars in STRUCTURE-OVERVIEW.md). The server composes the layers into a
 * PNG; the hash names the picture, so a page asks for it again only when it changes
 */
import { BOTH_HANDS_POSITION, BEHIND_BASE_LAYER, DEFAULT_ART_TYPE, type ArtTypeManifest, type AvatarManifest, type AvatarPoint, type BaseOffsets, type ItemDrawing } from './manifest.js';
import { PF1E_RACE_BODY_TYPES } from '../rulesets/pf1e/races.js';
import { SF1E_RACE_BODY_TYPES } from '../rulesets/sf1e/races.js';
import { RULESET_EQUIPMENT, type EquipmentLayer } from '../equipment.js';
import type { BodyType } from './bodyTypes.js';
import type { Ruleset } from '../universes.js';

/**
 * Each default race's body types, by ruleset and the race's key
 */
export const RACE_BODY_TYPES: Record<Ruleset, Readonly<Record<string, readonly BodyType[]>>> = {
	pf1e: PF1E_RACE_BODY_TYPES,
	sf1e: SF1E_RACE_BODY_TYPES
};

/**
 * The slots whose items draw flipped, with the slot whose drawing they use
 */
const MIRRORED_SLOTS: Readonly<Record<string, string>> = {
	offHand: 'mainHand',
	ringRight: 'ringLeft'
};

/**
 * An item in one of a character's slots, as far as drawing it goes
 */
export interface AvatarEquippedItem
{
	slot: string;
	layer: EquipmentLayer;

	/**
	 * The key of the default item it is drawn as: its own, or the one it "looks like"; null draws nothing
	 */
	itemKey: string | null;

	/**
	 * Whether it is held in both hands, which uses the drawings for a two-handed grip
	 */
	bothHands: boolean;
}

/**
 * A character's look: everything their avatar depends on
 */
export interface AvatarLook
{
	ruleset: Ruleset;

	/**
	 * The key of the default race the character is drawn as: their race's own, or the one it "looks like";
	 * null when it looks like none, which has no avatar
	 */
	raceKey: string | null;

	bodyType: string;
	artType: string;
	background: string;

	/**
	 * Their stats and social slots' items
	 */
	equipment: readonly AvatarEquippedItem[];

	/**
	 * The slots drawn empty
	 */
	hiddenSlots: readonly string[];
}

/**
 * One image of an avatar, drawn over the ones before it
 */
export interface AvatarLayer
{
	/**
	 * The PNG, relative to shared/assets/avatars/
	 */
	file: string;

	/**
	 * Where its top left corner goes, in pixels
	 */
	x: number;
	y: number;

	/**
	 * Whether it is drawn flipped horizontally
	 */
	flipped: boolean;
}

/**
 * What an avatar draws, without its hash
 */
export interface AvatarDrawing
{
	/**
	 * The art type and body type it is drawn in, after falling back
	 */
	artType: string;
	bodyType: BodyType;

	/**
	 * Its images, from the first drawn to the last: the background, the parts behind the base, the base,
	 * then the items' parts in layer order
	 */
	layers: AvatarLayer[];
}

/**
 * What an avatar draws, with its hash
 */
export interface AvatarPicture extends AvatarDrawing
{
	/**
	 * A hash of the layers and the versions of their files, which changes whenever the picture does
	 */
	hash: string;
}

/**
 * The body types a default race's avatars are drawn in
 *
 * @param ruleset The ruleset
 * @param raceKey The default race's key, or null for none
 * @return The body types; none for a race without a list
 */
export function raceBodyTypes(ruleset: Ruleset, raceKey: string | null): readonly BodyType[]
{
	const lists = RACE_BODY_TYPES[ruleset];

	return((((raceKey !== null) && Object.hasOwn(lists, raceKey)) ? lists[raceKey] : []));
}

/**
 * The body type a character is drawn in: their own, or their race's first when its list doesn't have it
 *
 * @param ruleset The ruleset
 * @param raceKey The key of the default race they are drawn as
 * @param bodyType Their body type
 * @return The body type, or undefined for a race with no body types
 */
export function drawnBodyType(ruleset: Ruleset, raceKey: string | null, bodyType: string): BodyType | undefined
{
	const bodyTypes = raceBodyTypes(ruleset, raceKey);

	return(bodyTypes.find((each) => (each === bodyType)) ?? bodyTypes[0]);
}

/**
 * The file of an art type's base for a race and body type
 *
 * @param art The art type
 * @param ruleset The ruleset
 * @param raceKey The default race's key
 * @param bodyType The body type
 * @return The file, relative to the art type's folder, or undefined when it isn't drawn yet
 */
function baseFile(art: ArtTypeManifest, ruleset: Ruleset, raceKey: string, bodyType: BodyType): string | undefined
{
	const races = art.bases[ruleset];

	return((Object.hasOwn(races, raceKey) ? races[raceKey][bodyType] : undefined));
}

/**
 * The art types with a base for a race and body type, in the order the manifest lists them
 *
 * @param manifest The manifest
 * @param ruleset The ruleset
 * @param raceKey The key of the default race the character is drawn as, or null for none
 * @param bodyType The body type
 * @return The art types' keys
 */
export function artTypesFor(manifest: AvatarManifest, ruleset: Ruleset, raceKey: string | null, bodyType: string): string[]
{
	const drawn = drawnBodyType(ruleset, raceKey, bodyType);

	if ((raceKey === null) || (drawn === undefined))
	{
		return([]);
	}

	return(Object.entries(manifest.artTypes)
		.filter(([, art]) => (baseFile(art, ruleset, raceKey, drawn) !== undefined))
		.map(([key]) => key));
}

/**
 * The art types with a base for any of a race's body types, in the order the manifest lists them
 *
 * @param manifest The manifest
 * @param ruleset The ruleset
 * @param raceKey The key of the default race, or null for none
 * @return The art types' keys
 */
export function artTypesForRace(manifest: AvatarManifest, ruleset: Ruleset, raceKey: string | null): string[]
{
	const bodyTypes = raceBodyTypes(ruleset, raceKey);

	return(Object.keys(manifest.artTypes)
		.filter((artType) => bodyTypes.some((bodyType) => artTypesFor(manifest, ruleset, raceKey, bodyType).includes(artType))));
}

/**
 * The art type a character is drawn in: their own while it has a base for them, or else the stick
 * figure (DEFAULT_ART_TYPE) while it has one
 *
 * @param manifest The manifest
 * @param ruleset The ruleset
 * @param raceKey The key of the default race they are drawn as, or null for none
 * @param bodyType Their body type
 * @param artType Their art type
 * @return The art type, or undefined when neither has a base for them
 */
export function drawnArtType(manifest: AvatarManifest, ruleset: Ruleset, raceKey: string | null, bodyType: string, artType: string): string | undefined
{
	const drawable = artTypesFor(manifest, ruleset, raceKey, bodyType);

	return([artType, DEFAULT_ART_TYPE].find((each) => drawable.includes(each)));
}

/**
 * The drawing an item uses in a position: the most specific that matches the race, body type and position
 *
 * @param drawings The item's drawings
 * @param raceKey The default race's key
 * @param bodyType The body type
 * @param position The slot, or BOTH_HANDS_POSITION for an item held in both hands
 * @return The drawing, or undefined when none matches
 */
export function matchingDrawing(drawings: readonly ItemDrawing[], raceKey: string, bodyType: BodyType, position: string): ItemDrawing | undefined
{
	let best: ItemDrawing | undefined;
	let bestScore = -1;

	for (const drawing of drawings)
	{
		const matches = (drawing.races.includes(raceKey) && ((drawing.bodyTypes === undefined) || drawing.bodyTypes.includes(bodyType)) && ((drawing.slots === undefined) || drawing.slots.includes(position)));
		const score = (((drawing.bodyTypes === undefined) ? 0 : 2) + ((drawing.slots === undefined) ? 0 : 1));

		if (matches && (score > bestScore))
		{
			best = drawing;
			bestScore = score;
		}
	}

	return(best);
}

/**
 * Where a part goes on a base
 *
 * @param offsets The part's offsets
 * @param raceKey The default race's key
 * @param bodyType The body type
 * @return The place, or undefined when it has none for the base
 */
function offsetOn(offsets: BaseOffsets | undefined, raceKey: string, bodyType: BodyType): AvatarPoint | undefined
{
	return((((offsets !== undefined) && Object.hasOwn(offsets, raceKey)) ? offsets[raceKey][bodyType] : undefined));
}

/**
 * An item's part placed on the avatar, before sorting into layers
 */
interface PlacedPart
{
	layer: AvatarLayer;

	/**
	 * Its place in the draw order: -1 behind the base, otherwise the index of its layer's slot
	 */
	order: number;
}

/**
 * The items a character's slots draw: each slot's social item, or else its stats item, but nothing in a
 * hidden slot
 *
 * @param look The character's look
 * @return The items, by slot
 */
function drawnItems(look: AvatarLook): Map<string, AvatarEquippedItem>
{
	const hidden = new Set(look.hiddenSlots);
	const drawn = new Map<string, AvatarEquippedItem>();

	for (const layer of ['stats', 'social'] as const)
	{
		for (const equipped of look.equipment)
		{
			if ((equipped.layer === layer) && !hidden.has(equipped.slot))
			{
				drawn.set(equipped.slot, equipped);
			}
		}
	}

	return(drawn);
}

/**
 * What a character's avatar draws, with its hash
 *
 * @param manifest The manifest
 * @param look The character's look
 * @param fileVersions Each file's version, such as a hash of its contents, by its path relative to
 * shared/assets/avatars/, so the hash changes when a file is drawn again; left out, only the files' names
 * count
 * @return The picture, or null when the character has no avatar: their race looks like none, or no art
 * type has a base for them
 */
export function avatarPicture(manifest: AvatarManifest, look: AvatarLook, fileVersions?: ReadonlyMap<string, string>): AvatarPicture | null
{
	const drawing = avatarDrawing(manifest, look);

	if (drawing === null)
	{
		return(null);
	}

	return({
		...drawing,
		hash: layersHash(drawing.layers, fileVersions)
	});
}

/**
 * What a character's avatar draws, without hashing it: for a caller that hashes the layers itself, such
 * as with versions of their files it reads once it knows the layers
 *
 * @param manifest The manifest
 * @param look The character's look
 * @return The drawing, or null when the character has no avatar: their race looks like none, or no art
 * type has a base for them
 */
export function avatarDrawing(manifest: AvatarManifest, look: AvatarLook): AvatarDrawing | null
{
	const { ruleset, raceKey } = look;
	const bodyType = drawnBodyType(ruleset, raceKey, look.bodyType);
	const artType = drawnArtType(manifest, ruleset, raceKey, look.bodyType, look.artType);

	if ((raceKey === null) || (bodyType === undefined) || (artType === undefined))
	{
		return(null);
	}

	const art = manifest.artTypes[artType];
	const base = baseFile(art, ruleset, raceKey, bodyType) ?? '';
	const { drawOrder } = RULESET_EQUIPMENT[ruleset];
	const placed: PlacedPart[] = [];

	/**
	 * Where a layer's slot comes in the draw order
	 *
	 * @param slot The slot, or BEHIND_BASE_LAYER
	 * @return -1 behind the base, the slot's index, or the end for a slot the order doesn't list
	 */
	const orderOf = (slot: string): number =>
	{
		if (slot === BEHIND_BASE_LAYER)
		{
			return(-1);
		}

		const index = drawOrder.indexOf(slot);

		return(((index === -1) ? drawOrder.length : index));
	};

	for (const [slot, equipped] of drawnItems(look))
	{
		const drawings = (((equipped.itemKey !== null) && Object.hasOwn(art.items[ruleset], equipped.itemKey)) ? art.items[ruleset][equipped.itemKey] : []);
		const sourceSlot = (Object.hasOwn(MIRRORED_SLOTS, slot) ? MIRRORED_SLOTS[slot] : undefined);
		const position = ((equipped.bothHands && (slot === 'mainHand')) ? BOTH_HANDS_POSITION : (sourceSlot ?? slot));
		const drawing = matchingDrawing(drawings, raceKey, bodyType, position);

		for (const part of (drawing?.parts ?? []))
		{
			const offset = offsetOn(((sourceSlot === undefined) ? part.offsets : part.mirroredOffsets), raceKey, bodyType);

			if (offset === undefined)
			{
				continue;
			}

			// A part placed in its own slot's layer stays in the mirrored slot's layer when drawn flipped
			const layerSlot = (((part.layer === undefined) || (part.layer === sourceSlot)) ? slot : part.layer);

			placed.push({
				layer: {
					file: `${artType}/${part.file}`,
					x: offset.x,
					y: offset.y,
					flipped: (sourceSlot !== undefined)
				},
				order: orderOf(layerSlot)
			});
		}
	}

	// Stable, so parts in the same layer keep the order of their slots and of their drawing's parts
	placed.sort((a, b) => (a.order - b.order));

	const background = (Object.hasOwn(manifest.backgrounds, look.background) ? manifest.backgrounds[look.background] : undefined);
	const layers: AvatarLayer[] = [
		...((background === undefined) ? [] : [{
			file: background,
			x: 0,
			y: 0,
			flipped: false
		}]),
		...placed
			.filter((part) => (part.order < 0))
			.map((part) => part.layer),
		{
			file: `${artType}/${base}`,
			x: 0,
			y: 0,
			flipped: false
		},
		...placed
			.filter((part) => (part.order >= 0))
			.map((part) => part.layer)
	];

	return({
		artType,
		bodyType,
		layers
	});
}

/**
 * A hash of an avatar's layers and their files' versions
 *
 * @param layers The layers
 * @param fileVersions Each file's version, by path; left out, only the files' names count
 * @return 16 hexadecimal digits
 */
export function layersHash(layers: readonly AvatarLayer[], fileVersions?: ReadonlyMap<string, string>): string
{
	const text = JSON.stringify(layers.map(({ file, x, y, flipped }) => [file, (fileVersions?.get(file) ?? ''), x, y, flipped]));

	return(hashText(text));
}

/**
 * A 64-bit FNV-1a hash of some text, which changes when the text does. Not for anything secret
 *
 * The hash is kept in four 16-bit pieces, lowest first, so each step's products stay well inside the
 * integers a number holds exactly
 *
 * @param text The text
 * @return 16 hexadecimal digits
 */
function hashText(text: string): string
{
	// The offset basis, 0xcbf29ce484222325, from piece0 (the lowest 16 bits) to piece3 (the highest)
	let piece0 = 0x2325;
	let piece1 = 0x8422;
	let piece2 = 0x9ce4;
	let piece3 = 0xcbf2;

	for (const byte of new TextEncoder().encode(text))
	{
		piece0 ^= byte;

		// Times the prime, 0x100000001b3: each piece times 0x1b3, plus the hash moved up 40 bits. Each
		// product carries what passes 16 bits into the next piece's product
		const product0 = (piece0 * 0x1b3);
		const product1 = ((piece1 * 0x1b3) + (product0 >>> 16));
		const product2 = ((piece2 * 0x1b3) + (product1 >>> 16) + (piece0 << 8));
		const product3 = ((piece3 * 0x1b3) + (product2 >>> 16) + (piece1 << 8));

		piece0 = (product0 & 0xffff);
		piece1 = (product1 & 0xffff);
		piece2 = (product2 & 0xffff);
		piece3 = (product3 & 0xffff);
	}

	return([piece3, piece2, piece1, piece0]
		.map((piece) => piece.toString(16).padStart(4, '0'))
		.join(''));
}
