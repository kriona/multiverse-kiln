/**
 * Pathfinder 1E's size categories
 *
 * Open Game Content from the Pathfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';

/**
 * The sizes, smallest first
 */
export const PF1E_SIZES = [
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

export type Pf1eSize = typeof PF1E_SIZES[number];

/**
 * Each size's name
 */
export const PF1E_SIZE_NAMES: Record<Pf1eSize, MessageDescriptor> = defineMessages({
	fine: {
		id: 'pf1e.size.fine',
		defaultMessage: 'Fine',
		description: 'Size of a creature in Pathfinder, the smallest: an insect'
	},
	diminutive: {
		id: 'pf1e.size.diminutive',
		defaultMessage: 'Diminutive',
		description: 'Size of a creature in Pathfinder, between Fine and Tiny: a rat'
	},
	tiny: {
		id: 'pf1e.size.tiny',
		defaultMessage: 'Tiny',
		description: 'Size of a creature in Pathfinder, between Diminutive and Small: a cat'
	},
	small: {
		id: 'pf1e.size.small',
		defaultMessage: 'Small',
		description: 'Size of a creature in Pathfinder, between Tiny and Medium: a halfling or gnome'
	},
	medium: {
		id: 'pf1e.size.medium',
		defaultMessage: 'Medium',
		description: 'Size of a creature in Pathfinder, between Small and Large: a human'
	},
	large: {
		id: 'pf1e.size.large',
		defaultMessage: 'Large',
		description: 'Size of a creature in Pathfinder, between Medium and Huge: an ogre or horse'
	},
	huge: {
		id: 'pf1e.size.huge',
		defaultMessage: 'Huge',
		description: 'Size of a creature in Pathfinder, between Large and Gargantuan: a giant'
	},
	gargantuan: {
		id: 'pf1e.size.gargantuan',
		defaultMessage: 'Gargantuan',
		description: 'Size of a creature in Pathfinder, between Huge and Colossal: an old dragon'
	},
	colossal: {
		id: 'pf1e.size.colossal',
		defaultMessage: 'Colossal',
		description: 'Size of a creature in Pathfinder, the largest: an ancient dragon'
	}
});
