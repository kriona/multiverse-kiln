/**
 * Body types: the shapes a race's avatars are drawn in (see Avatars in STRUCTURE-OVERVIEW.md). Each
 * default race lists the body types it has, in its ruleset's races data, the same for every art type
 */
import { defineMessages, type MessageDescriptor } from '../localization.js';

/**
 * Every body type a race can list
 */
export const BODY_TYPES = ['femmeThicc', 'femmeThin', 'mascThicc', 'mascThin'] as const;

export type BodyType = typeof BODY_TYPES[number];

/**
 * The body types every race starts with, until its list changes as the art is drawn. A race's first
 * body type is the one Create Character starts on
 */
export const STARTING_BODY_TYPES: readonly BodyType[] = ['femmeThicc', 'femmeThin', 'mascThicc', 'mascThin'];

/**
 * The body type characters made before avatars existed have, and a character's when none is chosen
 */
export const DEFAULT_BODY_TYPE: BodyType = 'femmeThicc';

/**
 * Each body type's name
 */
export const BODY_TYPE_NAMES: Record<BodyType, MessageDescriptor> = defineMessages({
	femmeThicc: {
		id: 'avatar.bodyType.femmeThicc',
		defaultMessage: 'femme thicc',
		description: 'A body type for a character\'s avatar (the picture of the character): feminine and heavily built. A choice on Create Character\'s Appearance step and in the Appearance dialog of a character\'s sheet'
	},
	femmeThin: {
		id: 'avatar.bodyType.femmeThin',
		defaultMessage: 'Femme thin',
		description: 'A body type for a character\'s avatar (the picture of the character): feminine and slightly built. A choice on Create Character\'s Appearance step and in the Appearance dialog of a character\'s sheet'
	},
	mascThicc: {
		id: 'avatar.bodyType.mascThicc',
		defaultMessage: 'masc thicc',
		description: 'A body type for a character\'s avatar (the picture of the character): masculine and heavily built. A choice on Create Character\'s Appearance step and in the Appearance dialog of a character\'s sheet'
	},
	mascThin: {
		id: 'avatar.bodyType.mascThin',
		defaultMessage: 'Masc thin',
		description: 'A body type for a character\'s avatar (the picture of the character): masculine and slightly built. A choice on Create Character\'s Appearance step and in the Appearance dialog of a character\'s sheet'
	}
});

/**
 * Whether a string is one of the body types
 *
 * @param value The string
 * @return True when it is
 */
export function isBodyType(value: string): value is BodyType
{
	return((BODY_TYPES as readonly string[]).includes(value));
}
