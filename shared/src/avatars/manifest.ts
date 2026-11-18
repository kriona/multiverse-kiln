/**
 * The avatar manifest: the art types, and each art type's bases and item drawings, and the backgrounds
 * (see Avatars in STRUCTURE-OVERVIEW.md). The art is drawn by hand and ships with the engine, in
 * shared/assets/avatars/: each art type's files in a folder named after its key, and the backgrounds in
 * backgrounds/. Each art type's own file (stickFigure.ts, lucia.ts) lists what has been drawn so far
 */
import { defineMessages, type MessageDescriptor } from '../localization.js';
import type { Ruleset } from '../universes.js';
import type { BodyType } from './bodyTypes.js';

/**
 * How wide and tall an avatar is, in pixels: every base and background is this size
 */
export const AVATAR_WIDTH = 200;
export const AVATAR_HEIGHT = 300;

/**
 * Where the server serves characters' avatars: AVATARS_PATH/<character ID>.png?look=<hash>
 */
export const AVATARS_PATH = '/avatars';

/**
 * Where the server serves Create Character's previews:
 * AVATAR_PREVIEWS_PATH/<art type>/<ruleset>/<race key>-<body type>-<background>.png
 */
export const AVATAR_PREVIEWS_PATH = '/avatar-previews';

/**
 * The layer of a part drawn behind the base, such as the back of a cloak
 */
export const BEHIND_BASE_LAYER = 'behindBase';

/**
 * Where an item held in both hands is drawn: a drawing listing it among its slots is for a two-handed grip
 */
export const BOTH_HANDS_POSITION = 'bothHands';

/**
 * A place on a base, in pixels from its top left corner
 */
export interface AvatarPoint
{
	x: number;
	y: number;
}

/**
 * Where a part goes on each base: by the race's key, then the body type
 */
export type BaseOffsets = Readonly<Record<string, Partial<Record<BodyType, AvatarPoint>>>>;

/**
 * One image of an item drawing
 */
export interface DrawingPart
{
	/**
	 * The PNG, relative to the art type's folder, e.g. items/longsword.png. Several parts, drawings and
	 * items can use the same file
	 */
	file: string;

	/**
	 * The layer it is drawn in: BEHIND_BASE_LAYER, or a slot of the ruleset's draw order (slotDrawOrder()).
	 * Left out, it is drawn in the layer of the slot the item is in
	 */
	layer?: string;

	/**
	 * Where its top left corner goes on each base. A base it has no offset for doesn't draw it
	 */
	offsets: BaseOffsets;

	/**
	 * Where its top left corner goes, drawn flipped horizontally, when the drawing is used in the off hand
	 * or the right ring. A base it has no mirrored offset for draws nothing there
	 */
	mirroredOffsets?: BaseOffsets;
}

/**
 * A drawing of an item, for some races and perhaps only some of their body types and some slots. The most
 * specific drawing that matches is used: one listing body types before one that doesn't, then one listing
 * slots before one that doesn't, then the first
 */
export interface ItemDrawing
{
	/**
	 * The default races' keys it is drawn for
	 */
	races: readonly string[];

	/**
	 * The body types it is drawn for; left out, every body type
	 */
	bodyTypes?: readonly BodyType[];

	/**
	 * The slots it is drawn for, and BOTH_HANDS_POSITION for an item held in both hands; left out, every
	 * slot. The off hand and right ring use the main hand's and left ring's drawings, flipped
	 */
	slots?: readonly string[];

	parts: readonly DrawingPart[];
}

/**
 * One art type's bases and item drawings
 */
export interface ArtTypeManifest
{
	/**
	 * Its name: a message, or plain text for an artist's name, which isn't translated
	 */
	name: MessageDescriptor | string;

	/**
	 * Each base's PNG, relative to the art type's folder: by ruleset, the default race's key, then the
	 * body type. A base not drawn yet is left out
	 */
	bases: Readonly<Record<Ruleset, Readonly<Record<string, Partial<Record<BodyType, string>>>>>>;

	/**
	 * Each default item's drawings: by ruleset, then the item's key
	 */
	items: Readonly<Record<Ruleset, Readonly<Record<string, readonly ItemDrawing[]>>>>;
}

/**
 * The whole manifest
 */
export interface AvatarManifest
{
	/**
	 * Each art type, by key, in the order Create Character offers them. The first is the one an art type
	 * without a base for a character falls back to
	 */
	artTypes: Readonly<Record<string, ArtTypeManifest>>;

	/**
	 * Each background's PNG, relative to shared/assets/avatars/, by key, in the order they are offered
	 */
	backgrounds: Readonly<Record<string, string>>;
}

/**
 * The art type characters made before avatars existed have, which every other art type falls back to
 */
export const DEFAULT_ART_TYPE = 'stickFigure';

/**
 * The backgrounds, in the order they are offered
 */
export const BACKGROUNDS = ['darkGreen', 'darkRed'] as const;

export type AvatarBackground = typeof BACKGROUNDS[number];

/**
 * The background characters made before avatars existed have
 */
export const DEFAULT_BACKGROUND: AvatarBackground = 'darkGreen';

/**
 * Each background's name
 */
export const BACKGROUND_NAMES: Record<AvatarBackground, MessageDescriptor> = defineMessages({
	darkGreen: {
		id: 'avatar.background.darkGreen',
		defaultMessage: 'Dark green',
		description: 'A background behind a character\'s avatar (the picture of the character): a dark green gradient. A choice on Create Character\'s Appearance step and in the Appearance dialog of a character\'s sheet'
	},
	darkRed: {
		id: 'avatar.background.darkRed',
		defaultMessage: 'Dark red',
		description: 'A background behind a character\'s avatar (the picture of the character): a dark red gradient. A choice on Create Character\'s Appearance step and in the Appearance dialog of a character\'s sheet'
	}
});

/**
 * Whether a string is one of the backgrounds
 *
 * @param value The string
 * @return True when it is
 */
export function isAvatarBackground(value: string): value is AvatarBackground
{
	return((BACKGROUNDS as readonly string[]).includes(value));
}

/**
 * The names of the art types that aren't named after their artist
 */
export const ART_TYPE_MESSAGES = defineMessages({
	stickFigure: {
		id: 'avatar.artType.stickFigure',
		defaultMessage: 'Stick figure',
		description: 'An art type for a character\'s avatar (the picture of the character): drawn as a simple stick figure. A choice on Create Character\'s Appearance step and in the Appearance dialog of a character\'s sheet, beside art types named after the artists who drew them'
	}
});
