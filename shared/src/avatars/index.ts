/**
 * Avatars: pictures of characters, drawn from the art the engine ships (see Avatars in
 * STRUCTURE-OVERVIEW.md)
 */
import { LUCIA_ART } from './lucia.js';
import { STICK_FIGURE_ART } from './stickFigure.js';
import type { AvatarBackground, AvatarManifest } from './manifest.js';

export * from './bodyTypes.js';
export * from './layers.js';
export * from './manifest.js';

/**
 * The art types, in the order Create Character offers them, the stick figure first
 */
export const ART_TYPES = ['stickFigure', 'lucia'] as const;

export type ArtType = typeof ART_TYPES[number];

/**
 * Whether a string is one of the art types
 *
 * @param value The string
 * @return True when it is
 */
export function isArtType(value: string): value is ArtType
{
	return((ART_TYPES as readonly string[]).includes(value));
}

/**
 * The engine's avatar art
 */
export const AVATAR_MANIFEST: AvatarManifest = {
	artTypes: {
		stickFigure: STICK_FIGURE_ART,
		lucia: LUCIA_ART
	} satisfies Record<ArtType, AvatarManifest['artTypes'][string]>,
	// Each background drawn so far
	backgrounds: {
		darkGreen: 'backgrounds/darkGreen.png',
		darkRed: 'backgrounds/darkRed.png'
	} satisfies Partial<Record<AvatarBackground, string>>
};
