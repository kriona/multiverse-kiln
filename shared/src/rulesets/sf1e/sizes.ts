/**
 * Starfinder 1E's size categories
 *
 * Open Game Content from the Starfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';

/**
 * The sizes, smallest first
 */
export const SF1E_SIZES = [
	'fine',
	'diminutive',
	'tiny',
	'small',
	'medium',
	'large',
	'huge',
	'gargantuan',
	'colossal'
] as const;

export type Sf1eSize = typeof SF1E_SIZES[number];

/**
 * Each size's name
 */
export const SF1E_SIZE_NAMES: Record<Sf1eSize, MessageDescriptor> = defineMessages({
	fine: {
		id: 'sf1e.size.fine',
		defaultMessage: 'Fine',
		description: 'Size of a creature in Starfinder, the smallest: an insect'
	},
	diminutive: {
		id: 'sf1e.size.diminutive',
		defaultMessage: 'Diminutive',
		description: 'Size of a creature in Starfinder, between Fine and Tiny: a rat'
	},
	tiny: {
		id: 'sf1e.size.tiny',
		defaultMessage: 'Tiny',
		description: 'Size of a creature in Starfinder, between Diminutive and Small: a cat'
	},
	small: {
		id: 'sf1e.size.small',
		defaultMessage: 'Small',
		description: 'Size of a creature in Starfinder, between Tiny and Medium: a ysoki'
	},
	medium: {
		id: 'sf1e.size.medium',
		defaultMessage: 'Medium',
		description: 'Size of a creature in Starfinder, between Small and Large: a human'
	},
	large: {
		id: 'sf1e.size.large',
		defaultMessage: 'Large',
		description: 'Size of a creature in Starfinder, between Medium and Huge: a horse'
	},
	huge: {
		id: 'sf1e.size.huge',
		defaultMessage: 'Huge',
		description: 'Size of a creature in Starfinder, between Large and Gargantuan: a giant'
	},
	gargantuan: {
		id: 'sf1e.size.gargantuan',
		defaultMessage: 'Gargantuan',
		description: 'Size of a creature in Starfinder, between Huge and Colossal: an old dragon'
	},
	colossal: {
		id: 'sf1e.size.colossal',
		defaultMessage: 'Colossal',
		description: 'Size of a creature in Starfinder, the largest: an ancient dragon'
	}
});
