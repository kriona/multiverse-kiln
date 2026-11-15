/**
 * Pathfinder 1E's rulebooks, and the book each default race, class and item comes from (see Rulebooks in
 * STRUCTURE-OVERVIEW.md)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';
import type { Pf1eClassKey } from './classes.js';
import type { Pf1eDefaultItemKey, Pf1eItemType } from './items.js';
import type { Pf1eRaceKey } from './races.js';

/**
 * The books, in the order the Ruleset tab lists them: the Core Rulebook, which is always on, first
 */
export const PF1E_RULEBOOKS = ['core', 'apg', 'arg', 'acg'] as const;

export type Pf1eRulebook = typeof PF1E_RULEBOOKS[number];

/**
 * Each book's name
 */
export const PF1E_RULEBOOK_NAMES: Record<Pf1eRulebook, MessageDescriptor> = defineMessages({
	core: {
		id: 'pf1e.rulebook.core',
		defaultMessage: 'Core Rulebook',
		description: 'Name of the main rulebook of Pathfinder First Edition, on the editor\'s Ruleset tab. Use the title of the book\'s official translated edition where there is one, such as the German "Grundregelwerk"'
	},
	apg: {
		id: 'pf1e.rulebook.apg',
		defaultMessage: 'Advanced Player\'s Guide',
		description: 'Name of a Pathfinder First Edition rulebook that adds classes such as the witch, on the editor\'s Ruleset tab. Use the title of the book\'s official translated edition where there is one'
	},
	arg: {
		id: 'pf1e.rulebook.arg',
		defaultMessage: 'Advanced Race Guide',
		description: 'Name of a Pathfinder First Edition rulebook that adds playable races such as the tiefling, on the editor\'s Ruleset tab. Use the title of the book\'s official translated edition where there is one'
	},
	acg: {
		id: 'pf1e.rulebook.acg',
		defaultMessage: 'Advanced Class Guide',
		description: 'Name of a Pathfinder First Edition rulebook that adds classes such as the arcanist, on the editor\'s Ruleset tab. Use the title of the book\'s official translated edition where there is one'
	}
});

/**
 * The book each default race comes from
 */
export const PF1E_RACE_RULEBOOKS: Record<Pf1eRaceKey, Pf1eRulebook> = {
	aasimar: 'arg',
	catfolk: 'arg',
	changeling: 'arg',
	dhampir: 'arg',
	drow: 'arg',
	duergar: 'arg',
	dwarf: 'core',
	elf: 'core',
	fetchling: 'arg',
	gillman: 'arg',
	gnome: 'core',
	goblin: 'arg',
	grippli: 'arg',
	half_elf: 'core',
	half_orc: 'core',
	halfling: 'core',
	hobgoblin: 'arg',
	human: 'core',
	ifrit: 'arg',
	kitsune: 'arg',
	kobold: 'arg',
	merfolk: 'arg',
	nagaji: 'arg',
	orc: 'arg',
	oread: 'arg',
	ratfolk: 'arg',
	samsaran: 'arg',
	strix: 'arg',
	suli: 'arg',
	svirfneblin: 'arg',
	sylph: 'arg',
	tengu: 'arg',
	tiefling: 'arg',
	undine: 'arg',
	vanara: 'arg',
	vishkanya: 'arg',
	wayang: 'arg'
};

/**
 * The book each default class comes from
 */
export const PF1E_CLASS_RULEBOOKS: Record<Pf1eClassKey, Pf1eRulebook> = {
	alchemist: 'apg',
	arcanist: 'acg',
	barbarian: 'core',
	bard: 'core',
	bloodrager: 'acg',
	brawler: 'acg',
	cavalier: 'apg',
	cleric: 'core',
	druid: 'core',
	fighter: 'core',
	hunter: 'acg',
	inquisitor: 'apg',
	investigator: 'acg',
	monk: 'core',
	oracle: 'apg',
	paladin: 'core',
	ranger: 'core',
	rogue: 'core',
	shaman: 'acg',
	skald: 'acg',
	slayer: 'acg',
	sorcerer: 'core',
	summoner: 'apg',
	swashbuckler: 'acg',
	warpriest: 'acg',
	witch: 'apg',
	wizard: 'core'
};

/**
 * The book each default item comes from (scratchpad/rulebooks-rules.md has the source of each)
 */
export const PF1E_ITEM_RULEBOOKS: Record<Pf1eDefaultItemKey, Pf1eRulebook> = {
	dagger: 'core',
	cestus: 'apg',
	sword_cane: 'apg',
	wooden_armor: 'apg',
	quilted_cloth: 'apg',
	kobold_long_lash: 'arg',
	kobold_spiked_tail: 'arg',
	ratfolk_tailblade: 'arg',
	arcanist_kit: 'acg',
	bloodrager_kit: 'acg',
	brawler_kit: 'acg',
	hunter_kit: 'acg',
	investigator_kit: 'acg',
	shaman_kit: 'acg',
	skald_kit: 'acg',
	slayer_kit: 'acg',
	swashbuckler_kit: 'acg',
	warpriest_kit: 'acg'
};

/**
 * The book each item type an optional book brings comes from. The other types are the Core Rulebook's
 */
export const PF1E_ITEM_TYPE_RULEBOOKS: Partial<Record<Pf1eItemType, Pf1eRulebook>> = {
	cestus: 'apg',
	sword_cane: 'apg',
	wooden_armor: 'apg',
	quilted_cloth: 'apg',
	kobold_long_lash: 'arg',
	kobold_spiked_tail: 'arg',
	ratfolk_tailblade: 'arg'
};
