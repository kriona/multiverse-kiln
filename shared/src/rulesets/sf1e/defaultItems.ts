/**
 * Starfinder 1E's default items, which a universe can edit, disable or add to: the Core Rulebook's weapons,
 * ammunition and armor, one item for each model of a weapon or armor (scratchpad/equipment-items.md). Every
 * default item comes from the Core Rulebook
 *
 * Open Game Content from the Starfinder Roleplaying Game Core Rulebook, used under the Open Game License
 * 1.0a (client/license.html)
 */
import { defineMessages, type MessageDescriptor } from '../../localization.js';
import type { Sf1eItemCategory, Sf1eItemType } from './items.js';

/**
 * Each default item's name, by the item's key. The database stores each name's English text
 */
export const SF1E_DEFAULT_ITEM_NAMES = defineMessages({
	survival_knife: {
		id: 'item.sf1e.survival_knife',
		defaultMessage: 'survival knife',
		description: 'Name of an item in Starfinder: a sturdy knife for fighting and for use in the wild'
	},
	tactical_knife: {
		id: 'item.sf1e.tactical_knife',
		defaultMessage: 'tactical knife',
		description: 'Name of an item in Starfinder: a combat knife made for soldiers'
	},
	tactical_baton: {
		id: 'item.sf1e.tactical_baton',
		defaultMessage: 'tactical baton',
		description: 'Name of an item in Starfinder: a club carried by guards and police. "tactical" names its model, the first of 2 from weakest to strongest'
	},
	advanced_baton: {
		id: 'item.sf1e.advanced_baton',
		defaultMessage: 'advanced baton',
		description: 'Name of an item in Starfinder: a club carried by guards and police. "advanced" names its model, the second of 2 from weakest to strongest'
	},
	cestus_battleglove: {
		id: 'item.sf1e.cestus_battleglove',
		defaultMessage: 'cestus battleglove',
		description: 'Name of an item in Starfinder: an armored glove for punching. "cestus" names its model, the first of 4 from weakest to strongest'
	},
	power_battleglove: {
		id: 'item.sf1e.power_battleglove',
		defaultMessage: 'power battleglove',
		description: 'Name of an item in Starfinder: an armored glove for punching. "power" names its model, the second of 4 from weakest to strongest'
	},
	nova_battleglove: {
		id: 'item.sf1e.nova_battleglove',
		defaultMessage: 'nova battleglove',
		description: 'Name of an item in Starfinder: an armored glove for punching. "nova" names its model, the third of 4 from weakest to strongest'
	},
	gravity_battleglove: {
		id: 'item.sf1e.gravity_battleglove',
		defaultMessage: 'gravity battleglove',
		description: 'Name of an item in Starfinder: an armored glove for punching. "gravity" names its model, the fourth of 4 from weakest to strongest'
	},
	club: {
		id: 'item.sf1e.club',
		defaultMessage: 'club',
		description: 'Name of an item in Starfinder: a simple wooden or metal club'
	},
	ultrathin_dagger: {
		id: 'item.sf1e.ultrathin_dagger',
		defaultMessage: 'ultrathin dagger',
		description: 'Name of an item in Starfinder: a short stabbing blade with an extremely sharp edge. "ultrathin" names its model, the first of 3 from weakest to strongest'
	},
	zero_edge_dagger: {
		id: 'item.sf1e.zero_edge_dagger',
		defaultMessage: 'zero-edge dagger',
		description: 'Name of an item in Starfinder: a short stabbing blade with an extremely sharp edge. "zero-edge" names its model, the second of 3 from weakest to strongest'
	},
	molecular_rift_dagger: {
		id: 'item.sf1e.molecular_rift_dagger',
		defaultMessage: 'molecular rift dagger',
		description: 'Name of an item in Starfinder: a short stabbing blade with an extremely sharp edge. "molecular rift" names its model, the third of 3 from weakest to strongest'
	},
	tactical_dueling_sword: {
		id: 'item.sf1e.tactical_dueling_sword',
		defaultMessage: 'tactical dueling sword',
		description: 'Name of an item in Starfinder: a light, slender sword for fencing. "tactical" names its model, the first of 5 from weakest to strongest'
	},
	buzzblade_dueling_sword: {
		id: 'item.sf1e.buzzblade_dueling_sword',
		defaultMessage: 'buzzblade dueling sword',
		description: 'Name of an item in Starfinder: a light, slender sword for fencing. "buzzblade" names its model, the second of 5 from weakest to strongest'
	},
	ultrathin_dueling_sword: {
		id: 'item.sf1e.ultrathin_dueling_sword',
		defaultMessage: 'ultrathin dueling sword',
		description: 'Name of an item in Starfinder: a light, slender sword for fencing. "ultrathin" names its model, the third of 5 from weakest to strongest'
	},
	ripper_dueling_sword: {
		id: 'item.sf1e.ripper_dueling_sword',
		defaultMessage: 'ripper dueling sword',
		description: 'Name of an item in Starfinder: a light, slender sword for fencing. "ripper" names its model, the fourth of 5 from weakest to strongest'
	},
	molecular_rift_dueling_sword: {
		id: 'item.sf1e.molecular_rift_dueling_sword',
		defaultMessage: 'molecular rift dueling sword',
		description: 'Name of an item in Starfinder: a light, slender sword for fencing. "molecular rift" names its model, the fifth of 5 from weakest to strongest'
	},
	incapacitator: {
		id: 'item.sf1e.incapacitator',
		defaultMessage: 'incapacitator',
		description: 'Name of an item in Starfinder: a stun baton that numbs its target'
	},
	peacemaker: {
		id: 'item.sf1e.peacemaker',
		defaultMessage: 'peacemaker',
		description: 'Name of an item in Starfinder: a heavy stun baton used by riot police'
	},
	tactical_spear: {
		id: 'item.sf1e.tactical_spear',
		defaultMessage: 'tactical spear',
		description: 'Name of an item in Starfinder: a long pole with a pointed head. "tactical" names its model, the first of 5 from weakest to strongest'
	},
	sentinel_spear: {
		id: 'item.sf1e.sentinel_spear',
		defaultMessage: 'sentinel spear',
		description: 'Name of an item in Starfinder: a long pole with a pointed head. "sentinel" names its model, the second of 5 from weakest to strongest'
	},
	buzzblade_spear: {
		id: 'item.sf1e.buzzblade_spear',
		defaultMessage: 'buzzblade spear',
		description: 'Name of an item in Starfinder: a long pole with a pointed head. "buzzblade" names its model, the third of 5 from weakest to strongest'
	},
	zero_edge_spear: {
		id: 'item.sf1e.zero_edge_spear',
		defaultMessage: 'zero-edge spear',
		description: 'Name of an item in Starfinder: a long pole with a pointed head. "zero-edge" names its model, the fourth of 5 from weakest to strongest'
	},
	gravity_spear: {
		id: 'item.sf1e.gravity_spear',
		defaultMessage: 'gravity spear',
		description: 'Name of an item in Starfinder: a long pole with a pointed head. "gravity" names its model, the fifth of 5 from weakest to strongest'
	},
	battle_staff: {
		id: 'item.sf1e.battle_staff',
		defaultMessage: 'battle staff',
		description: 'Name of an item in Starfinder: a fighting staff held in two hands. "battle" names its model, the first of 3 from weakest to strongest'
	},
	carbon_staff: {
		id: 'item.sf1e.carbon_staff',
		defaultMessage: 'carbon staff',
		description: 'Name of an item in Starfinder: a fighting staff held in two hands. "carbon" names its model, the second of 3 from weakest to strongest'
	},
	hardlight_staff: {
		id: 'item.sf1e.hardlight_staff',
		defaultMessage: 'hardlight staff',
		description: 'Name of an item in Starfinder: a fighting staff held in two hands. "hardlight" names its model, the third of 3 from weakest to strongest'
	},
	tactical_cryopike: {
		id: 'item.sf1e.tactical_cryopike',
		defaultMessage: 'tactical cryopike',
		description: 'Name of an item in Starfinder: a pike whose head freezes what it strikes. "tactical" names its model, the first of 2 from weakest to strongest'
	},
	advanced_cryopike: {
		id: 'item.sf1e.advanced_cryopike',
		defaultMessage: 'advanced cryopike',
		description: 'Name of an item in Starfinder: a pike whose head freezes what it strikes. "advanced" names its model, the second of 2 from weakest to strongest'
	},
	carbon_steel_curve_blade: {
		id: 'item.sf1e.carbon_steel_curve_blade',
		defaultMessage: 'carbon steel curve blade',
		description: 'Name of an item in Starfinder: a long sword with a curved blade, held in two hands. "carbon steel" names its model, the first of 4 from weakest to strongest'
	},
	ultrathin_curve_blade: {
		id: 'item.sf1e.ultrathin_curve_blade',
		defaultMessage: 'ultrathin curve blade',
		description: 'Name of an item in Starfinder: a long sword with a curved blade, held in two hands. "ultrathin" names its model, the second of 4 from weakest to strongest'
	},
	buzzblade_curve_blade: {
		id: 'item.sf1e.buzzblade_curve_blade',
		defaultMessage: 'buzzblade curve blade',
		description: 'Name of an item in Starfinder: a long sword with a curved blade, held in two hands. "buzzblade" names its model, the third of 4 from weakest to strongest'
	},
	dimensional_slice_curve_blade: {
		id: 'item.sf1e.dimensional_slice_curve_blade',
		defaultMessage: 'dimensional slice curve blade',
		description: 'Name of an item in Starfinder: a long sword with a curved blade, held in two hands. "dimensional slice" names its model, the fourth of 4 from weakest to strongest'
	},
	wrack_devastation_blade: {
		id: 'item.sf1e.wrack_devastation_blade',
		defaultMessage: 'wrack devastation blade',
		description: 'Name of an item in Starfinder: a huge two-handed sword that drains life. "wrack" names its model, the first of 3 from weakest to strongest'
	},
	ruin_devastation_blade: {
		id: 'item.sf1e.ruin_devastation_blade',
		defaultMessage: 'ruin devastation blade',
		description: 'Name of an item in Starfinder: a huge two-handed sword that drains life. "ruin" names its model, the second of 3 from weakest to strongest'
	},
	apocalypse_devastation_blade: {
		id: 'item.sf1e.apocalypse_devastation_blade',
		defaultMessage: 'apocalypse devastation blade',
		description: 'Name of an item in Starfinder: a huge two-handed sword that drains life. "apocalypse" names its model, the third of 3 from weakest to strongest'
	},
	tactical_doshko: {
		id: 'item.sf1e.tactical_doshko',
		defaultMessage: 'tactical doshko',
		description: 'Name of an item in Starfinder: the vesk\'s traditional polearm, with a heavy blade at the end. "tactical" names its model, the first of 6 from weakest to strongest'
	},
	advanced_doshko: {
		id: 'item.sf1e.advanced_doshko',
		defaultMessage: 'advanced doshko',
		description: 'Name of an item in Starfinder: the vesk\'s traditional polearm, with a heavy blade at the end. "advanced" names its model, the second of 6 from weakest to strongest'
	},
	ultrathin_doshko: {
		id: 'item.sf1e.ultrathin_doshko',
		defaultMessage: 'ultrathin doshko',
		description: 'Name of an item in Starfinder: the vesk\'s traditional polearm, with a heavy blade at the end. "ultrathin" names its model, the third of 6 from weakest to strongest'
	},
	zero_edge_doshko: {
		id: 'item.sf1e.zero_edge_doshko',
		defaultMessage: 'zero-edge doshko',
		description: 'Name of an item in Starfinder: the vesk\'s traditional polearm, with a heavy blade at the end. "zero-edge" names its model, the fourth of 6 from weakest to strongest'
	},
	molecular_rift_doshko: {
		id: 'item.sf1e.molecular_rift_doshko',
		defaultMessage: 'molecular rift doshko',
		description: 'Name of an item in Starfinder: the vesk\'s traditional polearm, with a heavy blade at the end. "molecular rift" names its model, the fifth of 6 from weakest to strongest'
	},
	dimensional_blade_doshko: {
		id: 'item.sf1e.dimensional_blade_doshko',
		defaultMessage: 'dimensional blade doshko',
		description: 'Name of an item in Starfinder: the vesk\'s traditional polearm, with a heavy blade at the end. "dimensional blade" names its model, the sixth of 6 from weakest to strongest'
	},
	fangblade: {
		id: 'item.sf1e.fangblade',
		defaultMessage: 'fangblade',
		description: 'Name of an item in Starfinder: a sword with a blade like a row of fangs'
	},
	ember_flame_doshko: {
		id: 'item.sf1e.ember_flame_doshko',
		defaultMessage: 'ember flame doshko',
		description: 'Name of an item in Starfinder: a vesk polearm whose blade burns. "ember" names its model, the first of 4 from weakest to strongest'
	},
	blaze_flame_doshko: {
		id: 'item.sf1e.blaze_flame_doshko',
		defaultMessage: 'blaze flame doshko',
		description: 'Name of an item in Starfinder: a vesk polearm whose blade burns. "blaze" names its model, the second of 4 from weakest to strongest'
	},
	inferno_flame_doshko: {
		id: 'item.sf1e.inferno_flame_doshko',
		defaultMessage: 'inferno flame doshko',
		description: 'Name of an item in Starfinder: a vesk polearm whose blade burns. "inferno" names its model, the third of 4 from weakest to strongest'
	},
	solar_flare_flame_doshko: {
		id: 'item.sf1e.solar_flare_flame_doshko',
		defaultMessage: 'solar flare flame doshko',
		description: 'Name of an item in Starfinder: a vesk polearm whose blade burns. "solar flare" names its model, the fourth of 4 from weakest to strongest'
	},
	grindblade: {
		id: 'item.sf1e.grindblade',
		defaultMessage: 'grindblade',
		description: 'Name of an item in Starfinder: a sword whose edge is a moving saw chain'
	},
	assault_hammer: {
		id: 'item.sf1e.assault_hammer',
		defaultMessage: 'assault hammer',
		description: 'Name of an item in Starfinder: a war hammer held in one hand. "assault" names its model, the first of 4 from weakest to strongest'
	},
	comet_hammer: {
		id: 'item.sf1e.comet_hammer',
		defaultMessage: 'comet hammer',
		description: 'Name of an item in Starfinder: a war hammer held in one hand. "comet" names its model, the second of 4 from weakest to strongest'
	},
	meteoric_hammer: {
		id: 'item.sf1e.meteoric_hammer',
		defaultMessage: 'meteoric hammer',
		description: 'Name of an item in Starfinder: a war hammer held in one hand. "meteoric" names its model, the third of 4 from weakest to strongest'
	},
	gravity_well_hammer: {
		id: 'item.sf1e.gravity_well_hammer',
		defaultMessage: 'gravity well hammer',
		description: 'Name of an item in Starfinder: a war hammer held in one hand. "gravity well" names its model, the fourth of 4 from weakest to strongest'
	},
	injection_glove: {
		id: 'item.sf1e.injection_glove',
		defaultMessage: 'injection glove',
		description: 'Name of an item in Starfinder: a glove with a needle that injects drugs or poison'
	},
	tactical_longsword: {
		id: 'item.sf1e.tactical_longsword',
		defaultMessage: 'tactical longsword',
		description: 'Name of an item in Starfinder: a sword with a long, straight blade. "tactical" names its model, the first of 8 from weakest to strongest'
	},
	sintered_longsword: {
		id: 'item.sf1e.sintered_longsword',
		defaultMessage: 'sintered longsword',
		description: 'Name of an item in Starfinder: a sword with a long, straight blade. "sintered" names its model, the second of 8 from weakest to strongest'
	},
	microserrated_longsword: {
		id: 'item.sf1e.microserrated_longsword',
		defaultMessage: 'microserrated longsword',
		description: 'Name of an item in Starfinder: a sword with a long, straight blade. "microserrated" names its model, the third of 8 from weakest to strongest'
	},
	ultrathin_longsword: {
		id: 'item.sf1e.ultrathin_longsword',
		defaultMessage: 'ultrathin longsword',
		description: 'Name of an item in Starfinder: a sword with a long, straight blade. "ultrathin" names its model, the fourth of 8 from weakest to strongest'
	},
	zero_edge_longsword: {
		id: 'item.sf1e.zero_edge_longsword',
		defaultMessage: 'zero-edge longsword',
		description: 'Name of an item in Starfinder: a sword with a long, straight blade. "zero-edge" names its model, the fifth of 8 from weakest to strongest'
	},
	molecular_rift_longsword: {
		id: 'item.sf1e.molecular_rift_longsword',
		defaultMessage: 'molecular rift longsword',
		description: 'Name of an item in Starfinder: a sword with a long, straight blade. "molecular rift" names its model, the sixth of 8 from weakest to strongest'
	},
	ultraserrated_longsword: {
		id: 'item.sf1e.ultraserrated_longsword',
		defaultMessage: 'ultraserrated longsword',
		description: 'Name of an item in Starfinder: a sword with a long, straight blade. "ultraserrated" names its model, the seventh of 8 from weakest to strongest'
	},
	dimensional_slice_longsword: {
		id: 'item.sf1e.dimensional_slice_longsword',
		defaultMessage: 'dimensional slice longsword',
		description: 'Name of an item in Starfinder: a sword with a long, straight blade. "dimensional slice" names its model, the eighth of 8 from weakest to strongest'
	},
	monowhip: {
		id: 'item.sf1e.monowhip',
		defaultMessage: 'monowhip',
		description: 'Name of an item in Starfinder: a whip of a single, extremely thin wire'
	},
	tactical_pike: {
		id: 'item.sf1e.tactical_pike',
		defaultMessage: 'tactical pike',
		description: 'Name of an item in Starfinder: a very long spear held in two hands. "tactical" names its model, the first of 3 from weakest to strongest'
	},
	advanced_pike: {
		id: 'item.sf1e.advanced_pike',
		defaultMessage: 'advanced pike',
		description: 'Name of an item in Starfinder: a very long spear held in two hands. "advanced" names its model, the second of 3 from weakest to strongest'
	},
	elite_pike: {
		id: 'item.sf1e.elite_pike',
		defaultMessage: 'elite pike',
		description: 'Name of an item in Starfinder: a very long spear held in two hands. "elite" names its model, the third of 3 from weakest to strongest'
	},
	red_star_plasma_doshko: {
		id: 'item.sf1e.red_star_plasma_doshko',
		defaultMessage: 'red star plasma doshko',
		description: 'Name of an item in Starfinder: a vesk polearm with a blade of plasma. "red star" names its model, the first of 4 from weakest to strongest'
	},
	yellow_star_plasma_doshko: {
		id: 'item.sf1e.yellow_star_plasma_doshko',
		defaultMessage: 'yellow star plasma doshko',
		description: 'Name of an item in Starfinder: a vesk polearm with a blade of plasma. "yellow star" names its model, the second of 4 from weakest to strongest'
	},
	white_star_plasma_doshko: {
		id: 'item.sf1e.white_star_plasma_doshko',
		defaultMessage: 'white star plasma doshko',
		description: 'Name of an item in Starfinder: a vesk polearm with a blade of plasma. "white star" names its model, the third of 4 from weakest to strongest'
	},
	blue_star_plasma_doshko: {
		id: 'item.sf1e.blue_star_plasma_doshko',
		defaultMessage: 'blue star plasma doshko',
		description: 'Name of an item in Starfinder: a vesk polearm with a blade of plasma. "blue star" names its model, the fourth of 4 from weakest to strongest'
	},
	tactical_plasma_sword: {
		id: 'item.sf1e.tactical_plasma_sword',
		defaultMessage: 'tactical plasma sword',
		description: 'Name of an item in Starfinder: a sword with a blade of plasma. "tactical" names its model, the first of 5 from weakest to strongest'
	},
	red_star_plasma_sword: {
		id: 'item.sf1e.red_star_plasma_sword',
		defaultMessage: 'red star plasma sword',
		description: 'Name of an item in Starfinder: a sword with a blade of plasma. "red star" names its model, the second of 5 from weakest to strongest'
	},
	yellow_star_plasma_sword: {
		id: 'item.sf1e.yellow_star_plasma_sword',
		defaultMessage: 'yellow star plasma sword',
		description: 'Name of an item in Starfinder: a sword with a blade of plasma. "yellow star" names its model, the third of 5 from weakest to strongest'
	},
	white_star_plasma_sword: {
		id: 'item.sf1e.white_star_plasma_sword',
		defaultMessage: 'white star plasma sword',
		description: 'Name of an item in Starfinder: a sword with a blade of plasma. "white star" names its model, the fourth of 5 from weakest to strongest'
	},
	blue_star_plasma_sword: {
		id: 'item.sf1e.blue_star_plasma_sword',
		defaultMessage: 'blue star plasma sword',
		description: 'Name of an item in Starfinder: a sword with a blade of plasma. "blue star" names its model, the fifth of 5 from weakest to strongest'
	},
	thunderstrike_pulse_gauntlet: {
		id: 'item.sf1e.thunderstrike_pulse_gauntlet',
		defaultMessage: 'thunderstrike pulse gauntlet',
		description: 'Name of an item in Starfinder: a gauntlet that strikes with a blast of sound. "thunderstrike" names its model, the first of 4 from weakest to strongest'
	},
	lfd_pulse_gauntlet: {
		id: 'item.sf1e.lfd_pulse_gauntlet',
		defaultMessage: 'LFD pulse gauntlet',
		description: 'Name of an item in Starfinder: a gauntlet that strikes with a blast of sound. "LFD" names its model, the second of 4 from weakest to strongest'
	},
	hfd_pulse_gauntlet: {
		id: 'item.sf1e.hfd_pulse_gauntlet',
		defaultMessage: 'HFD pulse gauntlet',
		description: 'Name of an item in Starfinder: a gauntlet that strikes with a blast of sound. "HFD" names its model, the third of 4 from weakest to strongest'
	},
	banshee_pulse_gauntlet: {
		id: 'item.sf1e.banshee_pulse_gauntlet',
		defaultMessage: 'banshee pulse gauntlet',
		description: 'Name of an item in Starfinder: a gauntlet that strikes with a blast of sound. "banshee" names its model, the fourth of 4 from weakest to strongest'
	},
	military_quantum_entangler: {
		id: 'item.sf1e.military_quantum_entangler',
		defaultMessage: 'military quantum entangler',
		description: 'Name of an item in Starfinder: a two-handed weapon that twists matter apart. "military" names its model, the first of 2 from weakest to strongest'
	},
	dominion_quantum_entangler: {
		id: 'item.sf1e.dominion_quantum_entangler',
		defaultMessage: 'dominion quantum entangler',
		description: 'Name of an item in Starfinder: a two-handed weapon that twists matter apart. "dominion" names its model, the second of 2 from weakest to strongest'
	},
	static_shock_truncheon: {
		id: 'item.sf1e.static_shock_truncheon',
		defaultMessage: 'static shock truncheon',
		description: 'Name of an item in Starfinder: a club that delivers an electric shock. "static" names its model, the first of 4 from weakest to strongest'
	},
	aurora_shock_truncheon: {
		id: 'item.sf1e.aurora_shock_truncheon',
		defaultMessage: 'aurora shock truncheon',
		description: 'Name of an item in Starfinder: a club that delivers an electric shock. "aurora" names its model, the second of 4 from weakest to strongest'
	},
	storm_shock_truncheon: {
		id: 'item.sf1e.storm_shock_truncheon',
		defaultMessage: 'storm shock truncheon',
		description: 'Name of an item in Starfinder: a club that delivers an electric shock. "storm" names its model, the third of 4 from weakest to strongest'
	},
	tempest_shock_truncheon: {
		id: 'item.sf1e.tempest_shock_truncheon',
		defaultMessage: 'tempest shock truncheon',
		description: 'Name of an item in Starfinder: a club that delivers an electric shock. "tempest" names its model, the fourth of 4 from weakest to strongest'
	},
	tactical_skyfire_sword: {
		id: 'item.sf1e.tactical_skyfire_sword',
		defaultMessage: 'tactical skyfire sword',
		description: 'Name of an item in Starfinder: a sword whose blade heats until it burns. "tactical" names its model, the first of 2 from weakest to strongest'
	},
	inferno_skyfire_sword: {
		id: 'item.sf1e.inferno_skyfire_sword',
		defaultMessage: 'inferno skyfire sword',
		description: 'Name of an item in Starfinder: a sword whose blade heats until it burns. "inferno" names its model, the second of 2 from weakest to strongest'
	},
	sentinel_staff: {
		id: 'item.sf1e.sentinel_staff',
		defaultMessage: 'sentinel staff',
		description: 'Name of an item in Starfinder: a fighting staff with defensive fields. "sentinel" names its model, the first of 2 from weakest to strongest'
	},
	repeller_staff: {
		id: 'item.sf1e.repeller_staff',
		defaultMessage: 'repeller staff',
		description: 'Name of an item in Starfinder: a fighting staff with defensive fields. "repeller" names its model, the second of 2 from weakest to strongest'
	},
	tactical_starknife: {
		id: 'item.sf1e.tactical_starknife',
		defaultMessage: 'tactical starknife',
		description: 'Name of an item in Starfinder: a four-pointed blade, the holy weapon of the sun goddess Sarenrae. "tactical" names its model, the first of 5 from weakest to strongest'
	},
	sintered_starknife: {
		id: 'item.sf1e.sintered_starknife',
		defaultMessage: 'sintered starknife',
		description: 'Name of an item in Starfinder: a four-pointed blade, the holy weapon of the sun goddess Sarenrae. "sintered" names its model, the second of 5 from weakest to strongest'
	},
	accelerated_starknife: {
		id: 'item.sf1e.accelerated_starknife',
		defaultMessage: 'accelerated starknife',
		description: 'Name of an item in Starfinder: a four-pointed blade, the holy weapon of the sun goddess Sarenrae. "accelerated" names its model, the third of 5 from weakest to strongest'
	},
	lightspeed_starknife: {
		id: 'item.sf1e.lightspeed_starknife',
		defaultMessage: 'lightspeed starknife',
		description: 'Name of an item in Starfinder: a four-pointed blade, the holy weapon of the sun goddess Sarenrae. "lightspeed" names its model, the fourth of 5 from weakest to strongest'
	},
	dimensional_slice_starknife: {
		id: 'item.sf1e.dimensional_slice_starknife',
		defaultMessage: 'dimensional slice starknife',
		description: 'Name of an item in Starfinder: a four-pointed blade, the holy weapon of the sun goddess Sarenrae. "dimensional slice" names its model, the fifth of 5 from weakest to strongest'
	},
	tactical_swoop_hammer: {
		id: 'item.sf1e.tactical_swoop_hammer',
		defaultMessage: 'tactical swoop hammer',
		description: 'Name of an item in Starfinder: a huge two-handed hammer with thrusters. "tactical" names its model, the first of 5 from weakest to strongest'
	},
	advanced_swoop_hammer: {
		id: 'item.sf1e.advanced_swoop_hammer',
		defaultMessage: 'advanced swoop hammer',
		description: 'Name of an item in Starfinder: a huge two-handed hammer with thrusters. "advanced" names its model, the second of 5 from weakest to strongest'
	},
	mach_1_swoop_hammer: {
		id: 'item.sf1e.mach_1_swoop_hammer',
		defaultMessage: 'mach I swoop hammer',
		description: 'Name of an item in Starfinder: a huge two-handed hammer with thrusters. "mach I" names its model, the third of 5 from weakest to strongest'
	},
	mach_2_swoop_hammer: {
		id: 'item.sf1e.mach_2_swoop_hammer',
		defaultMessage: 'mach II swoop hammer',
		description: 'Name of an item in Starfinder: a huge two-handed hammer with thrusters. "mach II" names its model, the fourth of 5 from weakest to strongest'
	},
	mach_3_swoop_hammer: {
		id: 'item.sf1e.mach_3_swoop_hammer',
		defaultMessage: 'mach III swoop hammer',
		description: 'Name of an item in Starfinder: a huge two-handed hammer with thrusters. "mach III" names its model, the fifth of 5 from weakest to strongest'
	},
	standard_taclash: {
		id: 'item.sf1e.standard_taclash',
		defaultMessage: 'standard taclash',
		description: 'Name of an item in Starfinder: a whip of tough, flexible cable. "standard" names its model, the first of 2 from weakest to strongest'
	},
	numbing_taclash: {
		id: 'item.sf1e.numbing_taclash',
		defaultMessage: 'numbing taclash',
		description: 'Name of an item in Starfinder: a whip of tough, flexible cable. "numbing" names its model, the second of 2 from weakest to strongest'
	},
	static_arc_pistol: {
		id: 'item.sf1e.static_arc_pistol',
		defaultMessage: 'static arc pistol',
		description: 'Name of an item in Starfinder: a handgun that fires bolts of electricity. "static" names its model, the first of 3 from weakest to strongest'
	},
	aurora_arc_pistol: {
		id: 'item.sf1e.aurora_arc_pistol',
		defaultMessage: 'aurora arc pistol',
		description: 'Name of an item in Starfinder: a handgun that fires bolts of electricity. "aurora" names its model, the second of 3 from weakest to strongest'
	},
	storm_arc_pistol: {
		id: 'item.sf1e.storm_arc_pistol',
		defaultMessage: 'storm arc pistol',
		description: 'Name of an item in Starfinder: a handgun that fires bolts of electricity. "storm" names its model, the third of 3 from weakest to strongest'
	},
	flame_pistol: {
		id: 'item.sf1e.flame_pistol',
		defaultMessage: 'flame pistol',
		description: 'Name of an item in Starfinder: a handgun that sprays fire'
	},
	survival_flare_gun: {
		id: 'item.sf1e.survival_flare_gun',
		defaultMessage: 'survival flare gun',
		description: 'Name of an item in Starfinder: a pistol for firing signal flares'
	},
	tactical_gyrojet_pistol: {
		id: 'item.sf1e.tactical_gyrojet_pistol',
		defaultMessage: 'tactical gyrojet pistol',
		description: 'Name of an item in Starfinder: a handgun that fires tiny rockets. "tactical" names its model, the first of 3 from weakest to strongest'
	},
	advanced_gyrojet_pistol: {
		id: 'item.sf1e.advanced_gyrojet_pistol',
		defaultMessage: 'advanced gyrojet pistol',
		description: 'Name of an item in Starfinder: a handgun that fires tiny rockets. "advanced" names its model, the second of 3 from weakest to strongest'
	},
	elite_gyrojet_pistol: {
		id: 'item.sf1e.elite_gyrojet_pistol',
		defaultMessage: 'elite gyrojet pistol',
		description: 'Name of an item in Starfinder: a handgun that fires tiny rockets. "elite" names its model, the third of 3 from weakest to strongest'
	},
	azimuth_laser_pistol: {
		id: 'item.sf1e.azimuth_laser_pistol',
		defaultMessage: 'azimuth laser pistol',
		description: 'Name of an item in Starfinder: a handgun that fires beams of light. "azimuth" names its model, the first of 6 from weakest to strongest'
	},
	corona_laser_pistol: {
		id: 'item.sf1e.corona_laser_pistol',
		defaultMessage: 'corona laser pistol',
		description: 'Name of an item in Starfinder: a handgun that fires beams of light. "corona" names its model, the second of 6 from weakest to strongest'
	},
	aphelion_laser_pistol: {
		id: 'item.sf1e.aphelion_laser_pistol',
		defaultMessage: 'aphelion laser pistol',
		description: 'Name of an item in Starfinder: a handgun that fires beams of light. "aphelion" names its model, the third of 6 from weakest to strongest'
	},
	perihelion_laser_pistol: {
		id: 'item.sf1e.perihelion_laser_pistol',
		defaultMessage: 'perihelion laser pistol',
		description: 'Name of an item in Starfinder: a handgun that fires beams of light. "perihelion" names its model, the fourth of 6 from weakest to strongest'
	},
	parallax_laser_pistol: {
		id: 'item.sf1e.parallax_laser_pistol',
		defaultMessage: 'parallax laser pistol',
		description: 'Name of an item in Starfinder: a handgun that fires beams of light. "parallax" names its model, the fifth of 6 from weakest to strongest'
	},
	zenith_laser_pistol: {
		id: 'item.sf1e.zenith_laser_pistol',
		defaultMessage: 'zenith laser pistol',
		description: 'Name of an item in Starfinder: a handgun that fires beams of light. "zenith" names its model, the sixth of 6 from weakest to strongest'
	},
	needler_pistol: {
		id: 'item.sf1e.needler_pistol',
		defaultMessage: 'needler pistol',
		description: 'Name of an item in Starfinder: a handgun that fires darts carrying drugs or poison'
	},
	red_star_plasma_pistol: {
		id: 'item.sf1e.red_star_plasma_pistol',
		defaultMessage: 'red star plasma pistol',
		description: 'Name of an item in Starfinder: a handgun that fires bolts of plasma. "red star" names its model, the first of 4 from weakest to strongest'
	},
	yellow_star_plasma_pistol: {
		id: 'item.sf1e.yellow_star_plasma_pistol',
		defaultMessage: 'yellow star plasma pistol',
		description: 'Name of an item in Starfinder: a handgun that fires bolts of plasma. "yellow star" names its model, the second of 4 from weakest to strongest'
	},
	white_star_plasma_pistol: {
		id: 'item.sf1e.white_star_plasma_pistol',
		defaultMessage: 'white star plasma pistol',
		description: 'Name of an item in Starfinder: a handgun that fires bolts of plasma. "white star" names its model, the third of 4 from weakest to strongest'
	},
	blue_star_plasma_pistol: {
		id: 'item.sf1e.blue_star_plasma_pistol',
		defaultMessage: 'blue star plasma pistol',
		description: 'Name of an item in Starfinder: a handgun that fires bolts of plasma. "blue star" names its model, the fourth of 4 from weakest to strongest'
	},
	pulsecaster_pistol: {
		id: 'item.sf1e.pulsecaster_pistol',
		defaultMessage: 'pulsecaster pistol',
		description: 'Name of an item in Starfinder: a handgun that stuns with electric pulses'
	},
	tactical_semi_auto_pistol: {
		id: 'item.sf1e.tactical_semi_auto_pistol',
		defaultMessage: 'tactical semi-auto pistol',
		description: 'Name of an item in Starfinder: a handgun that fires bullets, one for each pull of the trigger. "tactical" names its model, the first of 4 from weakest to strongest'
	},
	advanced_semi_auto_pistol: {
		id: 'item.sf1e.advanced_semi_auto_pistol',
		defaultMessage: 'advanced semi-auto pistol',
		description: 'Name of an item in Starfinder: a handgun that fires bullets, one for each pull of the trigger. "advanced" names its model, the second of 4 from weakest to strongest'
	},
	elite_semi_auto_pistol: {
		id: 'item.sf1e.elite_semi_auto_pistol',
		defaultMessage: 'elite semi-auto pistol',
		description: 'Name of an item in Starfinder: a handgun that fires bullets, one for each pull of the trigger. "elite" names its model, the third of 4 from weakest to strongest'
	},
	paragon_semi_auto_pistol: {
		id: 'item.sf1e.paragon_semi_auto_pistol',
		defaultMessage: 'paragon semi-auto pistol',
		description: 'Name of an item in Starfinder: a handgun that fires bullets, one for each pull of the trigger. "paragon" names its model, the fourth of 4 from weakest to strongest'
	},
	thunderstrike_sonic_pistol: {
		id: 'item.sf1e.thunderstrike_sonic_pistol',
		defaultMessage: 'thunderstrike sonic pistol',
		description: 'Name of an item in Starfinder: a handgun that fires blasts of sound. "thunderstrike" names its model, the first of 4 from weakest to strongest'
	},
	lfd_sonic_pistol: {
		id: 'item.sf1e.lfd_sonic_pistol',
		defaultMessage: 'LFD sonic pistol',
		description: 'Name of an item in Starfinder: a handgun that fires blasts of sound. "LFD" names its model, the second of 4 from weakest to strongest'
	},
	hfd_sonic_pistol: {
		id: 'item.sf1e.hfd_sonic_pistol',
		defaultMessage: 'HFD sonic pistol',
		description: 'Name of an item in Starfinder: a handgun that fires blasts of sound. "HFD" names its model, the third of 4 from weakest to strongest'
	},
	banshee_sonic_pistol: {
		id: 'item.sf1e.banshee_sonic_pistol',
		defaultMessage: 'banshee sonic pistol',
		description: 'Name of an item in Starfinder: a handgun that fires blasts of sound. "banshee" names its model, the fourth of 4 from weakest to strongest'
	},
	frostbite_class_zero_pistol: {
		id: 'item.sf1e.frostbite_class_zero_pistol',
		defaultMessage: 'frostbite-class zero pistol',
		description: 'Name of an item in Starfinder: a handgun that fires freezing blasts. "frostbite-class" names its model, the first of 4 from weakest to strongest'
	},
	hailstorm_class_zero_pistol: {
		id: 'item.sf1e.hailstorm_class_zero_pistol',
		defaultMessage: 'hailstorm-class zero pistol',
		description: 'Name of an item in Starfinder: a handgun that fires freezing blasts. "hailstorm-class" names its model, the second of 4 from weakest to strongest'
	},
	blizzard_class_zero_pistol: {
		id: 'item.sf1e.blizzard_class_zero_pistol',
		defaultMessage: 'blizzard-class zero pistol',
		description: 'Name of an item in Starfinder: a handgun that fires freezing blasts. "blizzard-class" names its model, the third of 4 from weakest to strongest'
	},
	avalanche_class_zero_pistol: {
		id: 'item.sf1e.avalanche_class_zero_pistol',
		defaultMessage: 'avalanche-class zero pistol',
		description: 'Name of an item in Starfinder: a handgun that fires freezing blasts. "avalanche-class" names its model, the fourth of 4 from weakest to strongest'
	},
	tactical_acid_dart_rifle: {
		id: 'item.sf1e.tactical_acid_dart_rifle',
		defaultMessage: 'tactical acid dart rifle',
		description: 'Name of an item in Starfinder: a rifle that fires darts full of acid. "tactical" names its model, the first of 3 from weakest to strongest'
	},
	dual_acid_dart_rifle: {
		id: 'item.sf1e.dual_acid_dart_rifle',
		defaultMessage: 'dual acid dart rifle',
		description: 'Name of an item in Starfinder: a rifle that fires darts full of acid. "dual" names its model, the second of 3 from weakest to strongest'
	},
	complex_acid_dart_rifle: {
		id: 'item.sf1e.complex_acid_dart_rifle',
		defaultMessage: 'complex acid dart rifle',
		description: 'Name of an item in Starfinder: a rifle that fires darts full of acid. "complex" names its model, the third of 3 from weakest to strongest'
	},
	tactical_arc_emitter: {
		id: 'item.sf1e.tactical_arc_emitter',
		defaultMessage: 'tactical arc emitter',
		description: 'Name of an item in Starfinder: a gun that sprays electricity in a cone. "tactical" names its model, the first of 2 from weakest to strongest'
	},
	advanced_arc_emitter: {
		id: 'item.sf1e.advanced_arc_emitter',
		defaultMessage: 'advanced arc emitter',
		description: 'Name of an item in Starfinder: a gun that sprays electricity in a cone. "advanced" names its model, the second of 2 from weakest to strongest'
	},
	static_arc_rifle: {
		id: 'item.sf1e.static_arc_rifle',
		defaultMessage: 'static arc rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bolts of electricity. "static" names its model, the first of 4 from weakest to strongest'
	},
	aurora_arc_rifle: {
		id: 'item.sf1e.aurora_arc_rifle',
		defaultMessage: 'aurora arc rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bolts of electricity. "aurora" names its model, the second of 4 from weakest to strongest'
	},
	storm_arc_rifle: {
		id: 'item.sf1e.storm_arc_rifle',
		defaultMessage: 'storm arc rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bolts of electricity. "storm" names its model, the third of 4 from weakest to strongest'
	},
	tempest_arc_rifle: {
		id: 'item.sf1e.tempest_arc_rifle',
		defaultMessage: 'tempest arc rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bolts of electricity. "tempest" names its model, the fourth of 4 from weakest to strongest'
	},
	tactical_autobeam_rifle: {
		id: 'item.sf1e.tactical_autobeam_rifle',
		defaultMessage: 'tactical autobeam rifle',
		description: 'Name of an item in Starfinder: a laser rifle that fires rapid bursts. "tactical" names its model, the first of 3 from weakest to strongest'
	},
	advanced_autobeam_rifle: {
		id: 'item.sf1e.advanced_autobeam_rifle',
		defaultMessage: 'advanced autobeam rifle',
		description: 'Name of an item in Starfinder: a laser rifle that fires rapid bursts. "advanced" names its model, the second of 3 from weakest to strongest'
	},
	elite_autobeam_rifle: {
		id: 'item.sf1e.elite_autobeam_rifle',
		defaultMessage: 'elite autobeam rifle',
		description: 'Name of an item in Starfinder: a laser rifle that fires rapid bursts. "elite" names its model, the third of 3 from weakest to strongest'
	},
	autotarget_rifle: {
		id: 'item.sf1e.autotarget_rifle',
		defaultMessage: 'autotarget rifle',
		description: 'Name of an item in Starfinder: a rifle that aims itself'
	},
	combat_rifle: {
		id: 'item.sf1e.combat_rifle',
		defaultMessage: 'combat rifle',
		description: 'Name of an item in Starfinder: a rugged military rifle'
	},
	tactical_crossbolter: {
		id: 'item.sf1e.tactical_crossbolter',
		defaultMessage: 'tactical crossbolter',
		description: 'Name of an item in Starfinder: a powerful crossbow that fires metal bolts. "tactical" names its model, the first of 2 from weakest to strongest'
	},
	dual_crossbolter: {
		id: 'item.sf1e.dual_crossbolter',
		defaultMessage: 'dual crossbolter',
		description: 'Name of an item in Starfinder: a powerful crossbow that fires metal bolts. "dual" names its model, the second of 2 from weakest to strongest'
	},
	flame_rifle: {
		id: 'item.sf1e.flame_rifle',
		defaultMessage: 'flame rifle',
		description: 'Name of an item in Starfinder: a rifle that sprays fire'
	},
	tactical_gyrojet_rifle: {
		id: 'item.sf1e.tactical_gyrojet_rifle',
		defaultMessage: 'tactical gyrojet rifle',
		description: 'Name of an item in Starfinder: a rifle that fires tiny rockets. "tactical" names its model, the first of 4 from weakest to strongest'
	},
	advanced_gyrojet_rifle: {
		id: 'item.sf1e.advanced_gyrojet_rifle',
		defaultMessage: 'advanced gyrojet rifle',
		description: 'Name of an item in Starfinder: a rifle that fires tiny rockets. "advanced" names its model, the second of 4 from weakest to strongest'
	},
	elite_gyrojet_rifle: {
		id: 'item.sf1e.elite_gyrojet_rifle',
		defaultMessage: 'elite gyrojet rifle',
		description: 'Name of an item in Starfinder: a rifle that fires tiny rockets. "elite" names its model, the third of 4 from weakest to strongest'
	},
	paragon_gyrojet_rifle: {
		id: 'item.sf1e.paragon_gyrojet_rifle',
		defaultMessage: 'paragon gyrojet rifle',
		description: 'Name of an item in Starfinder: a rifle that fires tiny rockets. "paragon" names its model, the fourth of 4 from weakest to strongest'
	},
	hunting_rifle: {
		id: 'item.sf1e.hunting_rifle',
		defaultMessage: 'hunting rifle',
		description: 'Name of an item in Starfinder: a rifle for hunting'
	},
	azimuth_laser_rifle: {
		id: 'item.sf1e.azimuth_laser_rifle',
		defaultMessage: 'azimuth laser rifle',
		description: 'Name of an item in Starfinder: a long gun held in two hands that fires beams of light. "azimuth" names its model, the first of 6 from weakest to strongest'
	},
	corona_laser_rifle: {
		id: 'item.sf1e.corona_laser_rifle',
		defaultMessage: 'corona laser rifle',
		description: 'Name of an item in Starfinder: a long gun held in two hands that fires beams of light. "corona" names its model, the second of 6 from weakest to strongest'
	},
	aphelion_laser_rifle: {
		id: 'item.sf1e.aphelion_laser_rifle',
		defaultMessage: 'aphelion laser rifle',
		description: 'Name of an item in Starfinder: a long gun held in two hands that fires beams of light. "aphelion" names its model, the third of 6 from weakest to strongest'
	},
	perihelion_laser_rifle: {
		id: 'item.sf1e.perihelion_laser_rifle',
		defaultMessage: 'perihelion laser rifle',
		description: 'Name of an item in Starfinder: a long gun held in two hands that fires beams of light. "perihelion" names its model, the fourth of 6 from weakest to strongest'
	},
	parallax_laser_rifle: {
		id: 'item.sf1e.parallax_laser_rifle',
		defaultMessage: 'parallax laser rifle',
		description: 'Name of an item in Starfinder: a long gun held in two hands that fires beams of light. "parallax" names its model, the fifth of 6 from weakest to strongest'
	},
	zenith_laser_rifle: {
		id: 'item.sf1e.zenith_laser_rifle',
		defaultMessage: 'zenith laser rifle',
		description: 'Name of an item in Starfinder: a long gun held in two hands that fires beams of light. "zenith" names its model, the sixth of 6 from weakest to strongest'
	},
	tactical_magnetar_rifle: {
		id: 'item.sf1e.tactical_magnetar_rifle',
		defaultMessage: 'tactical magnetar rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bullets with magnets. "tactical" names its model, the first of 4 from weakest to strongest'
	},
	advanced_magnetar_rifle: {
		id: 'item.sf1e.advanced_magnetar_rifle',
		defaultMessage: 'advanced magnetar rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bullets with magnets. "advanced" names its model, the second of 4 from weakest to strongest'
	},
	elite_magnetar_rifle: {
		id: 'item.sf1e.elite_magnetar_rifle',
		defaultMessage: 'elite magnetar rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bullets with magnets. "elite" names its model, the third of 4 from weakest to strongest'
	},
	paragon_magnetar_rifle: {
		id: 'item.sf1e.paragon_magnetar_rifle',
		defaultMessage: 'paragon magnetar rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bullets with magnets. "paragon" names its model, the fourth of 4 from weakest to strongest'
	},
	needler_rifle: {
		id: 'item.sf1e.needler_rifle',
		defaultMessage: 'needler rifle',
		description: 'Name of an item in Starfinder: a rifle that fires darts carrying drugs or poison'
	},
	white_star_plasma_caster: {
		id: 'item.sf1e.white_star_plasma_caster',
		defaultMessage: 'white star plasma caster',
		description: 'Name of an item in Starfinder: a gun that fires a line of plasma. "white star" names its model, the first of 2 from weakest to strongest'
	},
	blue_star_plasma_caster: {
		id: 'item.sf1e.blue_star_plasma_caster',
		defaultMessage: 'blue star plasma caster',
		description: 'Name of an item in Starfinder: a gun that fires a line of plasma. "blue star" names its model, the second of 2 from weakest to strongest'
	},
	red_star_plasma_rifle: {
		id: 'item.sf1e.red_star_plasma_rifle',
		defaultMessage: 'red star plasma rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bolts of plasma. "red star" names its model, the first of 4 from weakest to strongest'
	},
	yellow_star_plasma_rifle: {
		id: 'item.sf1e.yellow_star_plasma_rifle',
		defaultMessage: 'yellow star plasma rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bolts of plasma. "yellow star" names its model, the second of 4 from weakest to strongest'
	},
	white_star_plasma_rifle: {
		id: 'item.sf1e.white_star_plasma_rifle',
		defaultMessage: 'white star plasma rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bolts of plasma. "white star" names its model, the third of 4 from weakest to strongest'
	},
	blue_star_plasma_rifle: {
		id: 'item.sf1e.blue_star_plasma_rifle',
		defaultMessage: 'blue star plasma rifle',
		description: 'Name of an item in Starfinder: a rifle that fires bolts of plasma. "blue star" names its model, the fourth of 4 from weakest to strongest'
	},
	pulsecaster_rifle: {
		id: 'item.sf1e.pulsecaster_rifle',
		defaultMessage: 'pulsecaster rifle',
		description: 'Name of an item in Starfinder: a rifle that stuns with electric pulses'
	},
	utility_scattergun: {
		id: 'item.sf1e.utility_scattergun',
		defaultMessage: 'utility scattergun',
		description: 'Name of an item in Starfinder: a shotgun that fires a spray of pellets. "utility" names its model, the first of 5 from weakest to strongest'
	},
	snub_scattergun: {
		id: 'item.sf1e.snub_scattergun',
		defaultMessage: 'snub scattergun',
		description: 'Name of an item in Starfinder: a shotgun that fires a spray of pellets. "snub" names its model, the second of 5 from weakest to strongest'
	},
	impact_scattergun: {
		id: 'item.sf1e.impact_scattergun',
		defaultMessage: 'impact scattergun',
		description: 'Name of an item in Starfinder: a shotgun that fires a spray of pellets. "impact" names its model, the third of 5 from weakest to strongest'
	},
	vortex_scattergun: {
		id: 'item.sf1e.vortex_scattergun',
		defaultMessage: 'vortex scattergun',
		description: 'Name of an item in Starfinder: a shotgun that fires a spray of pellets. "vortex" names its model, the fourth of 5 from weakest to strongest'
	},
	grapeshot_scattergun: {
		id: 'item.sf1e.grapeshot_scattergun',
		defaultMessage: 'grapeshot scattergun',
		description: 'Name of an item in Starfinder: a shotgun that fires a spray of pellets. "grapeshot" names its model, the fifth of 5 from weakest to strongest'
	},
	tactical_seeker_rifle: {
		id: 'item.sf1e.tactical_seeker_rifle',
		defaultMessage: 'tactical seeker rifle',
		description: 'Name of an item in Starfinder: a long-range rifle with a smart scope. "tactical" names its model, the first of 4 from weakest to strongest'
	},
	advanced_seeker_rifle: {
		id: 'item.sf1e.advanced_seeker_rifle',
		defaultMessage: 'advanced seeker rifle',
		description: 'Name of an item in Starfinder: a long-range rifle with a smart scope. "advanced" names its model, the second of 4 from weakest to strongest'
	},
	elite_seeker_rifle: {
		id: 'item.sf1e.elite_seeker_rifle',
		defaultMessage: 'elite seeker rifle',
		description: 'Name of an item in Starfinder: a long-range rifle with a smart scope. "elite" names its model, the third of 4 from weakest to strongest'
	},
	paragon_seeker_rifle: {
		id: 'item.sf1e.paragon_seeker_rifle',
		defaultMessage: 'paragon seeker rifle',
		description: 'Name of an item in Starfinder: a long-range rifle with a smart scope. "paragon" names its model, the fourth of 4 from weakest to strongest'
	},
	thunderstrike_sonic_rifle: {
		id: 'item.sf1e.thunderstrike_sonic_rifle',
		defaultMessage: 'thunderstrike sonic rifle',
		description: 'Name of an item in Starfinder: a rifle that fires blasts of sound. "thunderstrike" names its model, the first of 4 from weakest to strongest'
	},
	lfd_sonic_rifle: {
		id: 'item.sf1e.lfd_sonic_rifle',
		defaultMessage: 'LFD sonic rifle',
		description: 'Name of an item in Starfinder: a rifle that fires blasts of sound. "LFD" names its model, the second of 4 from weakest to strongest'
	},
	hfd_sonic_rifle: {
		id: 'item.sf1e.hfd_sonic_rifle',
		defaultMessage: 'HFD sonic rifle',
		description: 'Name of an item in Starfinder: a rifle that fires blasts of sound. "HFD" names its model, the third of 4 from weakest to strongest'
	},
	banshee_sonic_rifle: {
		id: 'item.sf1e.banshee_sonic_rifle',
		defaultMessage: 'banshee sonic rifle',
		description: 'Name of an item in Starfinder: a rifle that fires blasts of sound. "banshee" names its model, the fourth of 4 from weakest to strongest'
	},
	thunderstrike_streetsweeper: {
		id: 'item.sf1e.thunderstrike_streetsweeper',
		defaultMessage: 'thunderstrike streetsweeper',
		description: 'Name of an item in Starfinder: a gun that blasts a wide area with sound. "thunderstrike" names its model, the first of 3 from weakest to strongest'
	},
	lfd_streetsweeper: {
		id: 'item.sf1e.lfd_streetsweeper',
		defaultMessage: 'LFD streetsweeper',
		description: 'Name of an item in Starfinder: a gun that blasts a wide area with sound. "LFD" names its model, the second of 3 from weakest to strongest'
	},
	hfd_streetsweeper: {
		id: 'item.sf1e.hfd_streetsweeper',
		defaultMessage: 'HFD streetsweeper',
		description: 'Name of an item in Starfinder: a gun that blasts a wide area with sound. "HFD" names its model, the third of 3 from weakest to strongest'
	},
	frostbite_class_zero_rifle: {
		id: 'item.sf1e.frostbite_class_zero_rifle',
		defaultMessage: 'frostbite-class zero rifle',
		description: 'Name of an item in Starfinder: a rifle that fires freezing blasts. "frostbite-class" names its model, the first of 4 from weakest to strongest'
	},
	hailstorm_class_zero_rifle: {
		id: 'item.sf1e.hailstorm_class_zero_rifle',
		defaultMessage: 'hailstorm-class zero rifle',
		description: 'Name of an item in Starfinder: a rifle that fires freezing blasts. "hailstorm-class" names its model, the second of 4 from weakest to strongest'
	},
	blizzard_class_zero_rifle: {
		id: 'item.sf1e.blizzard_class_zero_rifle',
		defaultMessage: 'blizzard-class zero rifle',
		description: 'Name of an item in Starfinder: a rifle that fires freezing blasts. "blizzard-class" names its model, the third of 4 from weakest to strongest'
	},
	avalanche_class_zero_rifle: {
		id: 'item.sf1e.avalanche_class_zero_rifle',
		defaultMessage: 'avalanche-class zero rifle',
		description: 'Name of an item in Starfinder: a rifle that fires freezing blasts. "avalanche-class" names its model, the fourth of 4 from weakest to strongest'
	},
	azimuth_artillery_laser: {
		id: 'item.sf1e.azimuth_artillery_laser',
		defaultMessage: 'azimuth artillery laser',
		description: 'Name of an item in Starfinder: a large laser cannon carried by hand. "azimuth" names its model, the first of 6 from weakest to strongest'
	},
	corona_artillery_laser: {
		id: 'item.sf1e.corona_artillery_laser',
		defaultMessage: 'corona artillery laser',
		description: 'Name of an item in Starfinder: a large laser cannon carried by hand. "corona" names its model, the second of 6 from weakest to strongest'
	},
	aphelion_artillery_laser: {
		id: 'item.sf1e.aphelion_artillery_laser',
		defaultMessage: 'aphelion artillery laser',
		description: 'Name of an item in Starfinder: a large laser cannon carried by hand. "aphelion" names its model, the third of 6 from weakest to strongest'
	},
	perihelion_artillery_laser: {
		id: 'item.sf1e.perihelion_artillery_laser',
		defaultMessage: 'perihelion artillery laser',
		description: 'Name of an item in Starfinder: a large laser cannon carried by hand. "perihelion" names its model, the fourth of 6 from weakest to strongest'
	},
	parallax_artillery_laser: {
		id: 'item.sf1e.parallax_artillery_laser',
		defaultMessage: 'parallax artillery laser',
		description: 'Name of an item in Starfinder: a large laser cannon carried by hand. "parallax" names its model, the fifth of 6 from weakest to strongest'
	},
	zenith_artillery_laser: {
		id: 'item.sf1e.zenith_artillery_laser',
		defaultMessage: 'zenith artillery laser',
		description: 'Name of an item in Starfinder: a large laser cannon carried by hand. "zenith" names its model, the sixth of 6 from weakest to strongest'
	},
	tactical_autobeam_artillery: {
		id: 'item.sf1e.tactical_autobeam_artillery',
		defaultMessage: 'tactical autobeam artillery',
		description: 'Name of an item in Starfinder: a heavy laser that fires rapid bursts. "tactical" names its model, the first of 3 from weakest to strongest'
	},
	advanced_autobeam_artillery: {
		id: 'item.sf1e.advanced_autobeam_artillery',
		defaultMessage: 'advanced autobeam artillery',
		description: 'Name of an item in Starfinder: a heavy laser that fires rapid bursts. "advanced" names its model, the second of 3 from weakest to strongest'
	},
	elite_autobeam_artillery: {
		id: 'item.sf1e.elite_autobeam_artillery',
		defaultMessage: 'elite autobeam artillery',
		description: 'Name of an item in Starfinder: a heavy laser that fires rapid bursts. "elite" names its model, the third of 3 from weakest to strongest'
	},
	advanced_crossbolter: {
		id: 'item.sf1e.advanced_crossbolter',
		defaultMessage: 'advanced crossbolter',
		description: 'Name of an item in Starfinder: a powerful crossbow that fires metal bolts. "advanced" names its model, the first of 3 from weakest to strongest'
	},
	elite_crossbolter: {
		id: 'item.sf1e.elite_crossbolter',
		defaultMessage: 'elite crossbolter',
		description: 'Name of an item in Starfinder: a powerful crossbow that fires metal bolts. "elite" names its model, the second of 3 from weakest to strongest'
	},
	paragon_crossbolter: {
		id: 'item.sf1e.paragon_crossbolter',
		defaultMessage: 'paragon crossbolter',
		description: 'Name of an item in Starfinder: a powerful crossbow that fires metal bolts. "paragon" names its model, the third of 3 from weakest to strongest'
	},
	ifrit_class_flamethrower: {
		id: 'item.sf1e.ifrit_class_flamethrower',
		defaultMessage: 'Ifrit-class flamethrower',
		description: 'Name of an item in Starfinder: a heavy weapon that sprays fire. "Ifrit-class" names its model, the first of 5 from weakest to strongest'
	},
	salamander_class_flamethrower: {
		id: 'item.sf1e.salamander_class_flamethrower',
		defaultMessage: 'salamander-class flamethrower',
		description: 'Name of an item in Starfinder: a heavy weapon that sprays fire. "salamander-class" names its model, the second of 5 from weakest to strongest'
	},
	hellhound_class_flamethrower: {
		id: 'item.sf1e.hellhound_class_flamethrower',
		defaultMessage: 'hellhound-class flamethrower',
		description: 'Name of an item in Starfinder: a heavy weapon that sprays fire. "hellhound-class" names its model, the third of 5 from weakest to strongest'
	},
	firedrake_class_flamethrower: {
		id: 'item.sf1e.firedrake_class_flamethrower',
		defaultMessage: 'firedrake-class flamethrower',
		description: 'Name of an item in Starfinder: a heavy weapon that sprays fire. "firedrake-class" names its model, the fourth of 5 from weakest to strongest'
	},
	phoenix_class_flamethrower: {
		id: 'item.sf1e.phoenix_class_flamethrower',
		defaultMessage: 'phoenix-class flamethrower',
		description: 'Name of an item in Starfinder: a heavy weapon that sprays fire. "phoenix-class" names its model, the fifth of 5 from weakest to strongest'
	},
	imds_missile_launcher: {
		id: 'item.sf1e.imds_missile_launcher',
		defaultMessage: 'IMDS missile launcher',
		description: 'Name of an item in Starfinder: a shoulder-mounted launcher that fires guided missiles'
	},
	squad_machine_gun: {
		id: 'item.sf1e.squad_machine_gun',
		defaultMessage: 'squad machine gun',
		description: 'Name of an item in Starfinder: a gun that fires bullets in long bursts. "squad" names its model, the first of 3 from weakest to strongest'
	},
	medium_machine_gun: {
		id: 'item.sf1e.medium_machine_gun',
		defaultMessage: 'medium machine gun',
		description: 'Name of an item in Starfinder: a gun that fires bullets in long bursts. "medium" names its model, the second of 3 from weakest to strongest'
	},
	heavy_machine_gun: {
		id: 'item.sf1e.heavy_machine_gun',
		defaultMessage: 'heavy machine gun',
		description: 'Name of an item in Starfinder: a gun that fires bullets in long bursts. "heavy" names its model, the third of 3 from weakest to strongest'
	},
	merc_nil_grenade_launcher: {
		id: 'item.sf1e.merc_nil_grenade_launcher',
		defaultMessage: 'merc NIL grenade launcher',
		description: 'Name of an item in Starfinder: a weapon that launches grenades far away. "merc" names its model, the first of 2 from weakest to strongest'
	},
	squad_nil_grenade_launcher: {
		id: 'item.sf1e.squad_nil_grenade_launcher',
		defaultMessage: 'squad NIL grenade launcher',
		description: 'Name of an item in Starfinder: a weapon that launches grenades far away. "squad" names its model, the second of 2 from weakest to strongest'
	},
	red_star_plasma_cannon: {
		id: 'item.sf1e.red_star_plasma_cannon',
		defaultMessage: 'red star plasma cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires plasma. "red star" names its model, the first of 4 from weakest to strongest'
	},
	yellow_star_plasma_cannon: {
		id: 'item.sf1e.yellow_star_plasma_cannon',
		defaultMessage: 'yellow star plasma cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires plasma. "yellow star" names its model, the second of 4 from weakest to strongest'
	},
	white_star_plasma_cannon: {
		id: 'item.sf1e.white_star_plasma_cannon',
		defaultMessage: 'white star plasma cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires plasma. "white star" names its model, the third of 4 from weakest to strongest'
	},
	blue_star_plasma_cannon: {
		id: 'item.sf1e.blue_star_plasma_cannon',
		defaultMessage: 'blue star plasma cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires plasma. "blue star" names its model, the fourth of 4 from weakest to strongest'
	},
	light_reaction_cannon: {
		id: 'item.sf1e.light_reaction_cannon',
		defaultMessage: 'light reaction cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires large shells. "light" names its model, the first of 6 from weakest to strongest'
	},
	tactical_reaction_cannon: {
		id: 'item.sf1e.tactical_reaction_cannon',
		defaultMessage: 'tactical reaction cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires large shells. "tactical" names its model, the second of 6 from weakest to strongest'
	},
	heavy_reaction_cannon: {
		id: 'item.sf1e.heavy_reaction_cannon',
		defaultMessage: 'heavy reaction cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires large shells. "heavy" names its model, the third of 6 from weakest to strongest'
	},
	advanced_reaction_cannon: {
		id: 'item.sf1e.advanced_reaction_cannon',
		defaultMessage: 'advanced reaction cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires large shells. "advanced" names its model, the fourth of 6 from weakest to strongest'
	},
	elite_reaction_cannon: {
		id: 'item.sf1e.elite_reaction_cannon',
		defaultMessage: 'elite reaction cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires large shells. "elite" names its model, the fifth of 6 from weakest to strongest'
	},
	paragon_reaction_cannon: {
		id: 'item.sf1e.paragon_reaction_cannon',
		defaultMessage: 'paragon reaction cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires large shells. "paragon" names its model, the sixth of 6 from weakest to strongest'
	},
	thunderstrike_screamer: {
		id: 'item.sf1e.thunderstrike_screamer',
		defaultMessage: 'thunderstrike screamer',
		description: 'Name of an item in Starfinder: a heavy weapon that fires deafening sound. "thunderstrike" names its model, the first of 3 from weakest to strongest'
	},
	lfd_screamer: {
		id: 'item.sf1e.lfd_screamer',
		defaultMessage: 'LFD screamer',
		description: 'Name of an item in Starfinder: a heavy weapon that fires deafening sound. "LFD" names its model, the second of 3 from weakest to strongest'
	},
	hfd_screamer: {
		id: 'item.sf1e.hfd_screamer',
		defaultMessage: 'HFD screamer',
		description: 'Name of an item in Starfinder: a heavy weapon that fires deafening sound. "HFD" names its model, the third of 3 from weakest to strongest'
	},
	static_shock_caster: {
		id: 'item.sf1e.static_shock_caster',
		defaultMessage: 'static shock caster',
		description: 'Name of an item in Starfinder: a heavy weapon that fires electricity. "static" names its model, the first of 4 from weakest to strongest'
	},
	aurora_shock_caster: {
		id: 'item.sf1e.aurora_shock_caster',
		defaultMessage: 'aurora shock caster',
		description: 'Name of an item in Starfinder: a heavy weapon that fires electricity. "aurora" names its model, the second of 4 from weakest to strongest'
	},
	storm_shock_caster: {
		id: 'item.sf1e.storm_shock_caster',
		defaultMessage: 'storm shock caster',
		description: 'Name of an item in Starfinder: a heavy weapon that fires electricity. "storm" names its model, the third of 4 from weakest to strongest'
	},
	tempest_shock_caster: {
		id: 'item.sf1e.tempest_shock_caster',
		defaultMessage: 'tempest shock caster',
		description: 'Name of an item in Starfinder: a heavy weapon that fires electricity. "tempest" names its model, the fourth of 4 from weakest to strongest'
	},
	light_stellar_cannon: {
		id: 'item.sf1e.light_stellar_cannon',
		defaultMessage: 'light stellar cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires blasts of starlight. "light" names its model, the first of 2 from weakest to strongest'
	},
	heavy_stellar_cannon: {
		id: 'item.sf1e.heavy_stellar_cannon',
		defaultMessage: 'heavy stellar cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires blasts of starlight. "heavy" names its model, the second of 2 from weakest to strongest'
	},
	tactical_x_gen_gun: {
		id: 'item.sf1e.tactical_x_gen_gun',
		defaultMessage: 'tactical X-gen gun',
		description: 'Name of an item in Starfinder: a heavy gun that fires bullets very fast. "tactical" names its model, the first of 4 from weakest to strongest'
	},
	advanced_x_gen_gun: {
		id: 'item.sf1e.advanced_x_gen_gun',
		defaultMessage: 'advanced X-gen gun',
		description: 'Name of an item in Starfinder: a heavy gun that fires bullets very fast. "advanced" names its model, the second of 4 from weakest to strongest'
	},
	elite_x_gen_gun: {
		id: 'item.sf1e.elite_x_gen_gun',
		defaultMessage: 'elite X-gen gun',
		description: 'Name of an item in Starfinder: a heavy gun that fires bullets very fast. "elite" names its model, the third of 4 from weakest to strongest'
	},
	paragon_x_gen_gun: {
		id: 'item.sf1e.paragon_x_gen_gun',
		defaultMessage: 'paragon X-gen gun',
		description: 'Name of an item in Starfinder: a heavy gun that fires bullets very fast. "paragon" names its model, the fourth of 4 from weakest to strongest'
	},
	tactical_zero_cannon: {
		id: 'item.sf1e.tactical_zero_cannon',
		defaultMessage: 'tactical zero cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires freezing blasts. "tactical" names its model, the first of 3 from weakest to strongest'
	},
	advanced_zero_cannon: {
		id: 'item.sf1e.advanced_zero_cannon',
		defaultMessage: 'advanced zero cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires freezing blasts. "advanced" names its model, the second of 3 from weakest to strongest'
	},
	elite_zero_cannon: {
		id: 'item.sf1e.elite_zero_cannon',
		defaultMessage: 'elite zero cannon',
		description: 'Name of an item in Starfinder: a heavy gun that fires freezing blasts. "elite" names its model, the third of 3 from weakest to strongest'
	},
	tactical_shirren_eye_rifle: {
		id: 'item.sf1e.tactical_shirren_eye_rifle',
		defaultMessage: 'tactical shirren-eye rifle',
		description: 'Name of an item in Starfinder: a sniper rifle made by the shirren. "tactical" names its model, the first of 5 from weakest to strongest'
	},
	advanced_shirren_eye_rifle: {
		id: 'item.sf1e.advanced_shirren_eye_rifle',
		defaultMessage: 'advanced shirren-eye rifle',
		description: 'Name of an item in Starfinder: a sniper rifle made by the shirren. "advanced" names its model, the second of 5 from weakest to strongest'
	},
	elite_shirren_eye_rifle: {
		id: 'item.sf1e.elite_shirren_eye_rifle',
		defaultMessage: 'elite shirren-eye rifle',
		description: 'Name of an item in Starfinder: a sniper rifle made by the shirren. "elite" names its model, the third of 5 from weakest to strongest'
	},
	paragon_shirren_eye_rifle: {
		id: 'item.sf1e.paragon_shirren_eye_rifle',
		defaultMessage: 'paragon shirren-eye rifle',
		description: 'Name of an item in Starfinder: a sniper rifle made by the shirren. "paragon" names its model, the fourth of 5 from weakest to strongest'
	},
	warpshot_shirren_eye_rifle: {
		id: 'item.sf1e.warpshot_shirren_eye_rifle',
		defaultMessage: 'warpshot shirren-eye rifle',
		description: 'Name of an item in Starfinder: a sniper rifle made by the shirren. "warpshot" names its model, the fifth of 5 from weakest to strongest'
	},
	cryo_grenade_1: {
		id: 'item.sf1e.cryo_grenade_1',
		defaultMessage: 'cryo grenade I',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into freezing cold. "I" names its model, the first of 4 from weakest to strongest'
	},
	cryo_grenade_2: {
		id: 'item.sf1e.cryo_grenade_2',
		defaultMessage: 'cryo grenade II',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into freezing cold. "II" names its model, the second of 4 from weakest to strongest'
	},
	cryo_grenade_3: {
		id: 'item.sf1e.cryo_grenade_3',
		defaultMessage: 'cryo grenade III',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into freezing cold. "III" names its model, the third of 4 from weakest to strongest'
	},
	cryo_grenade_4: {
		id: 'item.sf1e.cryo_grenade_4',
		defaultMessage: 'cryo grenade IV',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into freezing cold. "IV" names its model, the fourth of 4 from weakest to strongest'
	},
	flash_grenade_1: {
		id: 'item.sf1e.flash_grenade_1',
		defaultMessage: 'flash grenade I',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into blinding light. "I" names its model, the first of 4 from weakest to strongest'
	},
	flash_grenade_2: {
		id: 'item.sf1e.flash_grenade_2',
		defaultMessage: 'flash grenade II',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into blinding light. "II" names its model, the second of 4 from weakest to strongest'
	},
	flash_grenade_3: {
		id: 'item.sf1e.flash_grenade_3',
		defaultMessage: 'flash grenade III',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into blinding light. "III" names its model, the third of 4 from weakest to strongest'
	},
	flash_grenade_4: {
		id: 'item.sf1e.flash_grenade_4',
		defaultMessage: 'flash grenade IV',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into blinding light. "IV" names its model, the fourth of 4 from weakest to strongest'
	},
	frag_grenade_1: {
		id: 'item.sf1e.frag_grenade_1',
		defaultMessage: 'frag grenade I',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into shrapnel. "I" names its model, the first of 8 from weakest to strongest'
	},
	frag_grenade_2: {
		id: 'item.sf1e.frag_grenade_2',
		defaultMessage: 'frag grenade II',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into shrapnel. "II" names its model, the second of 8 from weakest to strongest'
	},
	frag_grenade_3: {
		id: 'item.sf1e.frag_grenade_3',
		defaultMessage: 'frag grenade III',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into shrapnel. "III" names its model, the third of 8 from weakest to strongest'
	},
	frag_grenade_4: {
		id: 'item.sf1e.frag_grenade_4',
		defaultMessage: 'frag grenade IV',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into shrapnel. "IV" names its model, the fourth of 8 from weakest to strongest'
	},
	frag_grenade_5: {
		id: 'item.sf1e.frag_grenade_5',
		defaultMessage: 'frag grenade V',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into shrapnel. "V" names its model, the fifth of 8 from weakest to strongest'
	},
	frag_grenade_6: {
		id: 'item.sf1e.frag_grenade_6',
		defaultMessage: 'frag grenade VI',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into shrapnel. "VI" names its model, the sixth of 8 from weakest to strongest'
	},
	frag_grenade_7: {
		id: 'item.sf1e.frag_grenade_7',
		defaultMessage: 'frag grenade VII',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into shrapnel. "VII" names its model, the seventh of 8 from weakest to strongest'
	},
	frag_grenade_8: {
		id: 'item.sf1e.frag_grenade_8',
		defaultMessage: 'frag grenade VIII',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into shrapnel. "VIII" names its model, the eighth of 8 from weakest to strongest'
	},
	incendiary_grenade_1: {
		id: 'item.sf1e.incendiary_grenade_1',
		defaultMessage: 'incendiary grenade I',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into flames. "I" names its model, the first of 6 from weakest to strongest'
	},
	incendiary_grenade_2: {
		id: 'item.sf1e.incendiary_grenade_2',
		defaultMessage: 'incendiary grenade II',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into flames. "II" names its model, the second of 6 from weakest to strongest'
	},
	incendiary_grenade_3: {
		id: 'item.sf1e.incendiary_grenade_3',
		defaultMessage: 'incendiary grenade III',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into flames. "III" names its model, the third of 6 from weakest to strongest'
	},
	incendiary_grenade_4: {
		id: 'item.sf1e.incendiary_grenade_4',
		defaultMessage: 'incendiary grenade IV',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into flames. "IV" names its model, the fourth of 6 from weakest to strongest'
	},
	incendiary_grenade_5: {
		id: 'item.sf1e.incendiary_grenade_5',
		defaultMessage: 'incendiary grenade V',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into flames. "V" names its model, the fifth of 6 from weakest to strongest'
	},
	incendiary_grenade_6: {
		id: 'item.sf1e.incendiary_grenade_6',
		defaultMessage: 'incendiary grenade VI',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into flames. "VI" names its model, the sixth of 6 from weakest to strongest'
	},
	screamer_grenade_1: {
		id: 'item.sf1e.screamer_grenade_1',
		defaultMessage: 'screamer grenade I',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into deafening sound. "I" names its model, the first of 4 from weakest to strongest'
	},
	screamer_grenade_2: {
		id: 'item.sf1e.screamer_grenade_2',
		defaultMessage: 'screamer grenade II',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into deafening sound. "II" names its model, the second of 4 from weakest to strongest'
	},
	screamer_grenade_3: {
		id: 'item.sf1e.screamer_grenade_3',
		defaultMessage: 'screamer grenade III',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into deafening sound. "III" names its model, the third of 4 from weakest to strongest'
	},
	screamer_grenade_4: {
		id: 'item.sf1e.screamer_grenade_4',
		defaultMessage: 'screamer grenade IV',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into deafening sound. "IV" names its model, the fourth of 4 from weakest to strongest'
	},
	shock_grenade_1: {
		id: 'item.sf1e.shock_grenade_1',
		defaultMessage: 'shock grenade I',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into electricity. "I" names its model, the first of 5 from weakest to strongest'
	},
	shock_grenade_2: {
		id: 'item.sf1e.shock_grenade_2',
		defaultMessage: 'shock grenade II',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into electricity. "II" names its model, the second of 5 from weakest to strongest'
	},
	shock_grenade_3: {
		id: 'item.sf1e.shock_grenade_3',
		defaultMessage: 'shock grenade III',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into electricity. "III" names its model, the third of 5 from weakest to strongest'
	},
	shock_grenade_4: {
		id: 'item.sf1e.shock_grenade_4',
		defaultMessage: 'shock grenade IV',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into electricity. "IV" names its model, the fourth of 5 from weakest to strongest'
	},
	shock_grenade_5: {
		id: 'item.sf1e.shock_grenade_5',
		defaultMessage: 'shock grenade V',
		description: 'Name of an item in Starfinder: a thrown bomb that bursts into electricity. "V" names its model, the fifth of 5 from weakest to strongest'
	},
	smoke_grenade: {
		id: 'item.sf1e.smoke_grenade',
		defaultMessage: 'smoke grenade',
		description: 'Name of an item in Starfinder: a thrown canister that fills the air with smoke'
	},
	stickybomb_grenade_1: {
		id: 'item.sf1e.stickybomb_grenade_1',
		defaultMessage: 'stickybomb grenade I',
		description: 'Name of an item in Starfinder: a thrown bomb that sprays sticky goo. "I" names its model, the first of 3 from weakest to strongest'
	},
	stickybomb_grenade_2: {
		id: 'item.sf1e.stickybomb_grenade_2',
		defaultMessage: 'stickybomb grenade II',
		description: 'Name of an item in Starfinder: a thrown bomb that sprays sticky goo. "II" names its model, the second of 3 from weakest to strongest'
	},
	stickybomb_grenade_3: {
		id: 'item.sf1e.stickybomb_grenade_3',
		defaultMessage: 'stickybomb grenade III',
		description: 'Name of an item in Starfinder: a thrown bomb that sprays sticky goo. "III" names its model, the third of 3 from weakest to strongest'
	},
	bow: {
		id: 'item.sf1e.bow',
		defaultMessage: 'bow',
		description: 'Name of an item in Starfinder: a bow for shooting arrows'
	},
	carbonedge_shuriken: {
		id: 'item.sf1e.carbonedge_shuriken',
		defaultMessage: 'carbonedge shuriken',
		description: 'Name of an item in Starfinder: a sharp throwing star'
	},
	nyfiber_net: {
		id: 'item.sf1e.nyfiber_net',
		defaultMessage: 'nyfiber net',
		description: 'Name of an item in Starfinder: a thrown net of tough fiber'
	},
	arrows: {
		id: 'item.sf1e.arrows',
		defaultMessage: 'arrows',
		description: 'Name of an item in Starfinder: arrows for a bow'
	},
	darts: {
		id: 'item.sf1e.darts',
		defaultMessage: 'darts',
		description: 'Name of an item in Starfinder: darts for needler and acid dart weapons'
	},
	flares: {
		id: 'item.sf1e.flares',
		defaultMessage: 'flares',
		description: 'Name of an item in Starfinder: flares for a survival flare gun'
	},
	battery: {
		id: 'item.sf1e.battery',
		defaultMessage: 'battery',
		description: 'Name of an item in Starfinder: a battery, the ammunition of energy weapons'
	},
	high_capacity_battery: {
		id: 'item.sf1e.high_capacity_battery',
		defaultMessage: 'high-capacity battery',
		description: 'Name of an item in Starfinder: a battery that holds more charges than a standard one. "high-capacity" names its model, the first of 3 from weakest to strongest'
	},
	super_capacity_battery: {
		id: 'item.sf1e.super_capacity_battery',
		defaultMessage: 'super-capacity battery',
		description: 'Name of an item in Starfinder: a battery that holds more charges than a standard one. "super-capacity" names its model, the second of 3 from weakest to strongest'
	},
	ultra_capacity_battery: {
		id: 'item.sf1e.ultra_capacity_battery',
		defaultMessage: 'ultra-capacity battery',
		description: 'Name of an item in Starfinder: a battery that holds more charges than a standard one. "ultra-capacity" names its model, the third of 3 from weakest to strongest'
	},
	small_arm_rounds: {
		id: 'item.sf1e.small_arm_rounds',
		defaultMessage: 'small arm rounds',
		description: 'Name of an item in Starfinder: bullets for pistols'
	},
	longarm_and_sniper_rounds: {
		id: 'item.sf1e.longarm_and_sniper_rounds',
		defaultMessage: 'longarm and sniper rounds',
		description: 'Name of an item in Starfinder: bullets for rifles and sniper rifles'
	},
	heavy_rounds: {
		id: 'item.sf1e.heavy_rounds',
		defaultMessage: 'heavy rounds',
		description: 'Name of an item in Starfinder: large bullets for heavy weapons'
	},
	explosive_heavy_rounds: {
		id: 'item.sf1e.explosive_heavy_rounds',
		defaultMessage: 'explosive heavy rounds',
		description: 'Name of an item in Starfinder: large bullets for heavy weapons that explode'
	},
	scattergun_shells: {
		id: 'item.sf1e.scattergun_shells',
		defaultMessage: 'scattergun shells',
		description: 'Name of an item in Starfinder: shells for a scattergun'
	},
	explosive_scattergun_shells: {
		id: 'item.sf1e.explosive_scattergun_shells',
		defaultMessage: 'explosive scattergun shells',
		description: 'Name of an item in Starfinder: shells for a scattergun that explode'
	},
	mini_rockets: {
		id: 'item.sf1e.mini_rockets',
		defaultMessage: 'mini-rockets',
		description: 'Name of an item in Starfinder: small rockets for gyrojet weapons'
	},
	tactical_missile: {
		id: 'item.sf1e.tactical_missile',
		defaultMessage: 'tactical missile',
		description: 'Name of an item in Starfinder: a guided missile for a missile launcher. "tactical" names its model, the first of 2 from weakest to strongest'
	},
	advanced_missile: {
		id: 'item.sf1e.advanced_missile',
		defaultMessage: 'advanced missile',
		description: 'Name of an item in Starfinder: a guided missile for a missile launcher. "advanced" names its model, the second of 2 from weakest to strongest'
	},
	grenade_arrows_2: {
		id: 'item.sf1e.grenade_arrows_2',
		defaultMessage: 'grenade arrows II',
		description: 'Name of an item in Starfinder: arrows that carry a grenade. "II" names its model, the first of 3 from weakest to strongest'
	},
	grenade_arrows_3: {
		id: 'item.sf1e.grenade_arrows_3',
		defaultMessage: 'grenade arrows III',
		description: 'Name of an item in Starfinder: arrows that carry a grenade. "III" names its model, the second of 3 from weakest to strongest'
	},
	grenade_arrows_4: {
		id: 'item.sf1e.grenade_arrows_4',
		defaultMessage: 'grenade arrows IV',
		description: 'Name of an item in Starfinder: arrows that carry a grenade. "IV" names its model, the third of 3 from weakest to strongest'
	},
	second_skin: {
		id: 'item.sf1e.second_skin',
		defaultMessage: 'second skin',
		description: 'Name of an item in Starfinder: light armor, a thin protective bodysuit'
	},
	estex_suit_1: {
		id: 'item.sf1e.estex_suit_1',
		defaultMessage: 'estex suit I',
		description: 'Name of an item in Starfinder: light armor of padded plates. "I" names its model, the first of 4 from weakest to strongest'
	},
	estex_suit_2: {
		id: 'item.sf1e.estex_suit_2',
		defaultMessage: 'estex suit II',
		description: 'Name of an item in Starfinder: light armor of padded plates. "II" names its model, the second of 4 from weakest to strongest'
	},
	estex_suit_3: {
		id: 'item.sf1e.estex_suit_3',
		defaultMessage: 'estex suit III',
		description: 'Name of an item in Starfinder: light armor of padded plates. "III" names its model, the third of 4 from weakest to strongest'
	},
	estex_suit_4: {
		id: 'item.sf1e.estex_suit_4',
		defaultMessage: 'estex suit IV',
		description: 'Name of an item in Starfinder: light armor of padded plates. "IV" names its model, the fourth of 4 from weakest to strongest'
	},
	flight_suit_stationwear: {
		id: 'item.sf1e.flight_suit_stationwear',
		defaultMessage: 'flight suit stationwear',
		description: 'Name of an item in Starfinder: everyday clothes with protective layers woven in. "flight suit" names its model, the first of 4 from weakest to strongest'
	},
	casual_stationwear: {
		id: 'item.sf1e.casual_stationwear',
		defaultMessage: 'casual stationwear',
		description: 'Name of an item in Starfinder: everyday clothes with protective layers woven in. "casual" names its model, the second of 4 from weakest to strongest'
	},
	business_stationwear: {
		id: 'item.sf1e.business_stationwear',
		defaultMessage: 'business stationwear',
		description: 'Name of an item in Starfinder: everyday clothes with protective layers woven in. "business" names its model, the third of 4 from weakest to strongest'
	},
	elite_stationwear: {
		id: 'item.sf1e.elite_stationwear',
		defaultMessage: 'elite stationwear',
		description: 'Name of an item in Starfinder: everyday clothes with protective layers woven in. "elite" names its model, the fourth of 4 from weakest to strongest'
	},
	kasatha_microcord_1: {
		id: 'item.sf1e.kasatha_microcord_1',
		defaultMessage: 'kasatha microcord I',
		description: 'Name of an item in Starfinder: light armor of woven cord made by the kasathas. "I" names its model, the first of 4 from weakest to strongest'
	},
	kasatha_microcord_2: {
		id: 'item.sf1e.kasatha_microcord_2',
		defaultMessage: 'kasatha microcord II',
		description: 'Name of an item in Starfinder: light armor of woven cord made by the kasathas. "II" names its model, the second of 4 from weakest to strongest'
	},
	kasatha_microcord_3: {
		id: 'item.sf1e.kasatha_microcord_3',
		defaultMessage: 'kasatha microcord III',
		description: 'Name of an item in Starfinder: light armor of woven cord made by the kasathas. "III" names its model, the third of 4 from weakest to strongest'
	},
	kasatha_microcord_4: {
		id: 'item.sf1e.kasatha_microcord_4',
		defaultMessage: 'kasatha microcord IV',
		description: 'Name of an item in Starfinder: light armor of woven cord made by the kasathas. "IV" names its model, the fourth of 4 from weakest to strongest'
	},
	freebooter_armor_1: {
		id: 'item.sf1e.freebooter_armor_1',
		defaultMessage: 'freebooter armor I',
		description: 'Name of an item in Starfinder: light armor favored by space pirates. "I" names its model, the first of 5 from weakest to strongest'
	},
	freebooter_armor_2: {
		id: 'item.sf1e.freebooter_armor_2',
		defaultMessage: 'freebooter armor II',
		description: 'Name of an item in Starfinder: light armor favored by space pirates. "II" names its model, the second of 5 from weakest to strongest'
	},
	freebooter_armor_3: {
		id: 'item.sf1e.freebooter_armor_3',
		defaultMessage: 'freebooter armor III',
		description: 'Name of an item in Starfinder: light armor favored by space pirates. "III" names its model, the third of 5 from weakest to strongest'
	},
	freebooter_armor_4: {
		id: 'item.sf1e.freebooter_armor_4',
		defaultMessage: 'freebooter armor IV',
		description: 'Name of an item in Starfinder: light armor favored by space pirates. "IV" names its model, the fourth of 5 from weakest to strongest'
	},
	freebooter_armor_5: {
		id: 'item.sf1e.freebooter_armor_5',
		defaultMessage: 'freebooter armor V',
		description: 'Name of an item in Starfinder: light armor favored by space pirates. "V" names its model, the fifth of 5 from weakest to strongest'
	},
	graphite_carbon_skin: {
		id: 'item.sf1e.graphite_carbon_skin',
		defaultMessage: 'graphite carbon skin',
		description: 'Name of an item in Starfinder: light armor of carbon plates. "graphite" names its model, the first of 4 from weakest to strongest'
	},
	white_carbon_carbon_skin: {
		id: 'item.sf1e.white_carbon_carbon_skin',
		defaultMessage: 'white carbon carbon skin',
		description: 'Name of an item in Starfinder: light armor of carbon plates. "white carbon" names its model, the second of 4 from weakest to strongest'
	},
	diamond_carbon_skin: {
		id: 'item.sf1e.diamond_carbon_skin',
		defaultMessage: 'diamond carbon skin',
		description: 'Name of an item in Starfinder: light armor of carbon plates. "diamond" names its model, the third of 4 from weakest to strongest'
	},
	nanotube_carbon_skin: {
		id: 'item.sf1e.nanotube_carbon_skin',
		defaultMessage: 'nanotube carbon skin',
		description: 'Name of an item in Starfinder: light armor of carbon plates. "nanotube" names its model, the fourth of 4 from weakest to strongest'
	},
	basic_lashunta_tempweave: {
		id: 'item.sf1e.basic_lashunta_tempweave',
		defaultMessage: 'basic lashunta tempweave',
		description: 'Name of an item in Starfinder: light armor made by the lashuntas that keeps its wearer comfortable. "basic" names its model, the first of 2 from weakest to strongest'
	},
	advanced_lashunta_tempweave: {
		id: 'item.sf1e.advanced_lashunta_tempweave',
		defaultMessage: 'advanced lashunta tempweave',
		description: 'Name of an item in Starfinder: light armor made by the lashuntas that keeps its wearer comfortable. "advanced" names its model, the second of 2 from weakest to strongest'
	},
	defrex_hide: {
		id: 'item.sf1e.defrex_hide',
		defaultMessage: 'defrex hide',
		description: 'Name of an item in Starfinder: light armor made from the hide of a defrex'
	},
	d_suit_1: {
		id: 'item.sf1e.d_suit_1',
		defaultMessage: 'D-suit I',
		description: 'Name of an item in Starfinder: light armor made for defense. "I" names its model, the first of 6 from weakest to strongest'
	},
	d_suit_2: {
		id: 'item.sf1e.d_suit_2',
		defaultMessage: 'D-suit II',
		description: 'Name of an item in Starfinder: light armor made for defense. "II" names its model, the second of 6 from weakest to strongest'
	},
	d_suit_3: {
		id: 'item.sf1e.d_suit_3',
		defaultMessage: 'D-suit III',
		description: 'Name of an item in Starfinder: light armor made for defense. "III" names its model, the third of 6 from weakest to strongest'
	},
	d_suit_4: {
		id: 'item.sf1e.d_suit_4',
		defaultMessage: 'D-suit IV',
		description: 'Name of an item in Starfinder: light armor made for defense. "IV" names its model, the fourth of 6 from weakest to strongest'
	},
	d_suit_5: {
		id: 'item.sf1e.d_suit_5',
		defaultMessage: 'D-suit V',
		description: 'Name of an item in Starfinder: light armor made for defense. "V" names its model, the fifth of 6 from weakest to strongest'
	},
	d_suit_6: {
		id: 'item.sf1e.d_suit_6',
		defaultMessage: 'D-suit VI',
		description: 'Name of an item in Starfinder: light armor made for defense. "VI" names its model, the sixth of 6 from weakest to strongest'
	},
	ysoki_refractor_suit: {
		id: 'item.sf1e.ysoki_refractor_suit',
		defaultMessage: 'ysoki refractor suit',
		description: 'Name of an item in Starfinder: light armor made by the ysoki that bends light'
	},
	silver_abadarcorp_travel_suit: {
		id: 'item.sf1e.silver_abadarcorp_travel_suit',
		defaultMessage: 'silver AbadarCorp travel suit',
		description: 'Name of an item in Starfinder: a stylish suit that is also light armor. "silver" names its model, the first of 3 from weakest to strongest'
	},
	gold_abadarcorp_travel_suit: {
		id: 'item.sf1e.gold_abadarcorp_travel_suit',
		defaultMessage: 'gold AbadarCorp travel suit',
		description: 'Name of an item in Starfinder: a stylish suit that is also light armor. "gold" names its model, the second of 3 from weakest to strongest'
	},
	platinum_abadarcorp_travel_suit: {
		id: 'item.sf1e.platinum_abadarcorp_travel_suit',
		defaultMessage: 'platinum AbadarCorp travel suit',
		description: 'Name of an item in Starfinder: a stylish suit that is also light armor. "platinum" names its model, the third of 3 from weakest to strongest'
	},
	squad_hardlight_series: {
		id: 'item.sf1e.squad_hardlight_series',
		defaultMessage: 'squad hardlight series',
		description: 'Name of an item in Starfinder: light armor with plates of solid light. "squad" names its model, the first of 3 from weakest to strongest'
	},
	elite_hardlight_series: {
		id: 'item.sf1e.elite_hardlight_series',
		defaultMessage: 'elite hardlight series',
		description: 'Name of an item in Starfinder: light armor with plates of solid light. "elite" names its model, the second of 3 from weakest to strongest'
	},
	specialist_hardlight_series: {
		id: 'item.sf1e.specialist_hardlight_series',
		defaultMessage: 'specialist hardlight series',
		description: 'Name of an item in Starfinder: light armor with plates of solid light. "specialist" names its model, the third of 3 from weakest to strongest'
	},
	boardroom_attire: {
		id: 'item.sf1e.boardroom_attire',
		defaultMessage: 'boardroom attire',
		description: 'Name of an item in Starfinder: a business suit that is also light armor'
	},
	ready_to_wear_echelon_fashion: {
		id: 'item.sf1e.ready_to_wear_echelon_fashion',
		defaultMessage: 'ready-to-wear echelon fashion',
		description: 'Name of an item in Starfinder: fine fashion that is also light armor. "ready-to-wear" names its model, the first of 2 from weakest to strongest'
	},
	bespoke_echelon_fashion: {
		id: 'item.sf1e.bespoke_echelon_fashion',
		defaultMessage: 'bespoke echelon fashion',
		description: 'Name of an item in Starfinder: fine fashion that is also light armor. "bespoke" names its model, the second of 2 from weakest to strongest'
	},
	swarmsuit: {
		id: 'item.sf1e.swarmsuit',
		defaultMessage: 'swarmsuit',
		description: 'Name of an item in Starfinder: light armor that shields its wearer from swarms'
	},
	shotalashu_armor: {
		id: 'item.sf1e.shotalashu_armor',
		defaultMessage: 'shotalashu armor',
		description: 'Name of an item in Starfinder: light armor made for riding a shotalashu'
	},
	troop_ceremonial_plate: {
		id: 'item.sf1e.troop_ceremonial_plate',
		defaultMessage: 'troop ceremonial plate',
		description: 'Name of an item in Starfinder: polished heavy armor worn for ceremonies. "troop" names its model, the first of 3 from weakest to strongest'
	},
	officer_ceremonial_plate: {
		id: 'item.sf1e.officer_ceremonial_plate',
		defaultMessage: 'officer ceremonial plate',
		description: 'Name of an item in Starfinder: polished heavy armor worn for ceremonies. "officer" names its model, the second of 3 from weakest to strongest'
	},
	commander_ceremonial_plate: {
		id: 'item.sf1e.commander_ceremonial_plate',
		defaultMessage: 'commander ceremonial plate',
		description: 'Name of an item in Starfinder: polished heavy armor worn for ceremonies. "commander" names its model, the third of 3 from weakest to strongest'
	},
	golemforged_plating_1: {
		id: 'item.sf1e.golemforged_plating_1',
		defaultMessage: 'golemforged plating I',
		description: 'Name of an item in Starfinder: heavy armor made in the forges of golems. "I" names its model, the first of 5 from weakest to strongest'
	},
	golemforged_plating_2: {
		id: 'item.sf1e.golemforged_plating_2',
		defaultMessage: 'golemforged plating II',
		description: 'Name of an item in Starfinder: heavy armor made in the forges of golems. "II" names its model, the second of 5 from weakest to strongest'
	},
	golemforged_plating_3: {
		id: 'item.sf1e.golemforged_plating_3',
		defaultMessage: 'golemforged plating III',
		description: 'Name of an item in Starfinder: heavy armor made in the forges of golems. "III" names its model, the third of 5 from weakest to strongest'
	},
	golemforged_plating_4: {
		id: 'item.sf1e.golemforged_plating_4',
		defaultMessage: 'golemforged plating IV',
		description: 'Name of an item in Starfinder: heavy armor made in the forges of golems. "IV" names its model, the fourth of 5 from weakest to strongest'
	},
	golemforged_plating_5: {
		id: 'item.sf1e.golemforged_plating_5',
		defaultMessage: 'golemforged plating V',
		description: 'Name of an item in Starfinder: heavy armor made in the forges of golems. "V" names its model, the fifth of 5 from weakest to strongest'
	},
	lashunta_ringwear_1: {
		id: 'item.sf1e.lashunta_ringwear_1',
		defaultMessage: 'lashunta ringwear I',
		description: 'Name of an item in Starfinder: heavy armor of interlocking rings made by the lashuntas. "I" names its model, the first of 5 from weakest to strongest'
	},
	lashunta_ringwear_2: {
		id: 'item.sf1e.lashunta_ringwear_2',
		defaultMessage: 'lashunta ringwear II',
		description: 'Name of an item in Starfinder: heavy armor of interlocking rings made by the lashuntas. "II" names its model, the second of 5 from weakest to strongest'
	},
	lashunta_ringwear_3: {
		id: 'item.sf1e.lashunta_ringwear_3',
		defaultMessage: 'lashunta ringwear III',
		description: 'Name of an item in Starfinder: heavy armor of interlocking rings made by the lashuntas. "III" names its model, the third of 5 from weakest to strongest'
	},
	lashunta_ringwear_4: {
		id: 'item.sf1e.lashunta_ringwear_4',
		defaultMessage: 'lashunta ringwear IV',
		description: 'Name of an item in Starfinder: heavy armor of interlocking rings made by the lashuntas. "IV" names its model, the fourth of 5 from weakest to strongest'
	},
	lashunta_ringwear_5: {
		id: 'item.sf1e.lashunta_ringwear_5',
		defaultMessage: 'lashunta ringwear V',
		description: 'Name of an item in Starfinder: heavy armor of interlocking rings made by the lashuntas. "V" names its model, the fifth of 5 from weakest to strongest'
	},
	hidden_soldier_armor: {
		id: 'item.sf1e.hidden_soldier_armor',
		defaultMessage: 'hidden soldier armor',
		description: 'Name of an item in Starfinder: heavy armor that changes color to blend in'
	},
	basic_iridishell: {
		id: 'item.sf1e.basic_iridishell',
		defaultMessage: 'basic iridishell',
		description: 'Name of an item in Starfinder: heavy armor of shimmering shell plates. "basic" names its model, the first of 3 from weakest to strongest'
	},
	advanced_iridishell: {
		id: 'item.sf1e.advanced_iridishell',
		defaultMessage: 'advanced iridishell',
		description: 'Name of an item in Starfinder: heavy armor of shimmering shell plates. "advanced" names its model, the second of 3 from weakest to strongest'
	},
	superior_iridishell: {
		id: 'item.sf1e.superior_iridishell',
		defaultMessage: 'superior iridishell',
		description: 'Name of an item in Starfinder: heavy armor of shimmering shell plates. "superior" names its model, the third of 3 from weakest to strongest'
	},
	thinplate: {
		id: 'item.sf1e.thinplate',
		defaultMessage: 'thinplate',
		description: 'Name of an item in Starfinder: thin but strong heavy armor'
	},
	squad_defiance_series: {
		id: 'item.sf1e.squad_defiance_series',
		defaultMessage: 'squad defiance series',
		description: 'Name of an item in Starfinder: military heavy armor. "squad" names its model, the first of 3 from weakest to strongest'
	},
	elite_defiance_series: {
		id: 'item.sf1e.elite_defiance_series',
		defaultMessage: 'elite defiance series',
		description: 'Name of an item in Starfinder: military heavy armor. "elite" names its model, the second of 3 from weakest to strongest'
	},
	specialist_defiance_series: {
		id: 'item.sf1e.specialist_defiance_series',
		defaultMessage: 'specialist defiance series',
		description: 'Name of an item in Starfinder: military heavy armor. "specialist" names its model, the third of 3 from weakest to strongest'
	},
	vesk_overplate_1: {
		id: 'item.sf1e.vesk_overplate_1',
		defaultMessage: 'vesk overplate I',
		description: 'Name of an item in Starfinder: heavy armor made by the vesk. "I" names its model, the first of 5 from weakest to strongest'
	},
	vesk_overplate_2: {
		id: 'item.sf1e.vesk_overplate_2',
		defaultMessage: 'vesk overplate II',
		description: 'Name of an item in Starfinder: heavy armor made by the vesk. "II" names its model, the second of 5 from weakest to strongest'
	},
	vesk_overplate_3: {
		id: 'item.sf1e.vesk_overplate_3',
		defaultMessage: 'vesk overplate III',
		description: 'Name of an item in Starfinder: heavy armor made by the vesk. "III" names its model, the third of 5 from weakest to strongest'
	},
	vesk_overplate_4: {
		id: 'item.sf1e.vesk_overplate_4',
		defaultMessage: 'vesk overplate IV',
		description: 'Name of an item in Starfinder: heavy armor made by the vesk. "IV" names its model, the fourth of 5 from weakest to strongest'
	},
	vesk_overplate_5: {
		id: 'item.sf1e.vesk_overplate_5',
		defaultMessage: 'vesk overplate V',
		description: 'Name of an item in Starfinder: heavy armor made by the vesk. "V" names its model, the fifth of 5 from weakest to strongest'
	},
	pinion_skyfire_armor: {
		id: 'item.sf1e.pinion_skyfire_armor',
		defaultMessage: 'pinion skyfire armor',
		description: 'Name of an item in Starfinder: heavy armor of the Skyfire Legion. "pinion" names its model, the first of 2 from weakest to strongest'
	},
	exident_skyfire_armor: {
		id: 'item.sf1e.exident_skyfire_armor',
		defaultMessage: 'exident skyfire armor',
		description: 'Name of an item in Starfinder: heavy armor of the Skyfire Legion. "exident" names its model, the second of 2 from weakest to strongest'
	},
	vesk_monolith_1: {
		id: 'item.sf1e.vesk_monolith_1',
		defaultMessage: 'vesk monolith I',
		description: 'Name of an item in Starfinder: massive heavy armor made by the vesk. "I" names its model, the first of 3 from weakest to strongest'
	},
	vesk_monolith_2: {
		id: 'item.sf1e.vesk_monolith_2',
		defaultMessage: 'vesk monolith II',
		description: 'Name of an item in Starfinder: massive heavy armor made by the vesk. "II" names its model, the second of 3 from weakest to strongest'
	},
	vesk_monolith_3: {
		id: 'item.sf1e.vesk_monolith_3',
		defaultMessage: 'vesk monolith III',
		description: 'Name of an item in Starfinder: massive heavy armor made by the vesk. "III" names its model, the third of 3 from weakest to strongest'
	},
	squad_aegis_series: {
		id: 'item.sf1e.squad_aegis_series',
		defaultMessage: 'squad aegis series',
		description: 'Name of an item in Starfinder: military heavy armor for defense. "squad" names its model, the first of 3 from weakest to strongest'
	},
	elite_aegis_series: {
		id: 'item.sf1e.elite_aegis_series',
		defaultMessage: 'elite aegis series',
		description: 'Name of an item in Starfinder: military heavy armor for defense. "elite" names its model, the second of 3 from weakest to strongest'
	},
	specialist_aegis_series: {
		id: 'item.sf1e.specialist_aegis_series',
		defaultMessage: 'specialist aegis series',
		description: 'Name of an item in Starfinder: military heavy armor for defense. "specialist" names its model, the third of 3 from weakest to strongest'
	},
	enginerunner: {
		id: 'item.sf1e.enginerunner',
		defaultMessage: 'enginerunner',
		description: 'Name of an item in Starfinder: heavy armor made for working near engines'
	},
	steelbones: {
		id: 'item.sf1e.steelbones',
		defaultMessage: 'steelbones',
		description: 'Name of an item in Starfinder: heavy armor with a metal frame'
	},
	vitrum_plate: {
		id: 'item.sf1e.vitrum_plate',
		defaultMessage: 'vitrum plate',
		description: 'Name of an item in Starfinder: heavy armor of strong glass'
	},
	voidshield_armor: {
		id: 'item.sf1e.voidshield_armor',
		defaultMessage: 'voidshield armor',
		description: 'Name of an item in Starfinder: heavy armor that shields against the void of space'
	}
});

export type Sf1eDefaultItemKey = keyof typeof SF1E_DEFAULT_ITEM_NAMES;

/**
 * The descriptions of the default items, by the weapon or armor they describe: the models of one weapon
 * share its description. Shown in the item editor, when choosing items, on a character's sheet and on the
 * Audit tab
 */
const DESCRIPTIONS = defineMessages({
	survival_knife: {
		id: 'itemDescription.sf1e.survival_knife',
		defaultMessage: 'A sturdy blade for everyday work and for fighting. It is light, easy to carry and treated against rust and corrosion.',
		description: 'Description of the survival knife, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	tactical_knife: {
		id: 'itemDescription.sf1e.tactical_knife',
		defaultMessage: 'A balanced combat knife of hardened alloy, made for soldiers who want a blade that is quick to draw and hard to break.',
		description: 'Description of the tactical knife, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	baton: {
		id: 'itemDescription.sf1e.baton',
		defaultMessage: 'A short, weighted club of the kind guards and police carry, for knocking foes down without killing them.',
		description: 'Description of every model of baton, such as the tactical baton, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	battleglove: {
		id: 'itemDescription.sf1e.battleglove',
		defaultMessage: 'An armored glove that makes a punch hit like a hammer. Better models drive the blow with servos, energy or gravity.',
		description: 'Description of every model of battleglove, such as the cestus battleglove, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	club: {
		id: 'itemDescription.sf1e.club',
		defaultMessage: 'A plain length of wood, pipe or bone swung to bludgeon, found or made almost anywhere.',
		description: 'Description of the club, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	dagger: {
		id: 'itemDescription.sf1e.dagger',
		defaultMessage: 'A short blade honed to a far finer edge than any steel can hold, which slips through armor.',
		description: 'Description of every model of dagger, such as the ultrathin dagger, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	dueling_sword: {
		id: 'itemDescription.sf1e.dueling_sword',
		defaultMessage: 'A light, slender sword for quick thrusts and parries, favored by duelists and officers.',
		description: 'Description of every model of dueling sword, such as the tactical dueling sword, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	incapacitator: {
		id: 'itemDescription.sf1e.incapacitator',
		defaultMessage: 'A baton whose tip releases a charge that numbs nerves, for subduing someone without lasting harm.',
		description: 'Description of the incapacitator, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	peacemaker: {
		id: 'itemDescription.sf1e.peacemaker',
		defaultMessage: 'A heavy riot baton that stuns with each blow, used by peacekeepers to end fights quickly.',
		description: 'Description of the peacemaker, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	spear: {
		id: 'itemDescription.sf1e.spear',
		defaultMessage: 'A long shaft with a sharp head, held in two hands to keep foes at a distance.',
		description: 'Description of every model of spear, such as the tactical spear, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	basic_staff: {
		id: 'itemDescription.sf1e.basic_staff',
		defaultMessage: 'A long fighting staff of sturdy alloy, carbon or solid light, swung in two hands to strike and block.',
		description: 'Description of every model of staff, such as the battle staff, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	cryopike: {
		id: 'itemDescription.sf1e.cryopike',
		defaultMessage: 'A pike whose head is chilled far below freezing, so each thrust leaves frost and numbing cold behind.',
		description: 'Description of every model of cryopike, such as the tactical cryopike, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	curve_blade: {
		id: 'itemDescription.sf1e.curve_blade',
		defaultMessage: 'A long, curving two-handed sword that cuts in wide, flowing arcs.',
		description: 'Description of every model of curve blade, such as the carbon steel curve blade, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	devastation_blade: {
		id: 'itemDescription.sf1e.devastation_blade',
		defaultMessage: 'A massive, jagged sword built by an ancient cult, whose strikes tear at the life of whatever they wound.',
		description: 'Description of every model of devastation blade, such as the wrack devastation blade, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	doshko: {
		id: 'itemDescription.sf1e.doshko',
		defaultMessage: 'The vesk\'s traditional war polearm: a long haft ending in a heavy, cleaver-like blade.',
		description: 'Description of every model of doshko, such as the tactical doshko, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	fangblade: {
		id: 'itemDescription.sf1e.fangblade',
		defaultMessage: 'A sword whose edge is a row of serrated teeth, made to tear flesh and leave bleeding wounds.',
		description: 'Description of the fangblade, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	flame_doshko: {
		id: 'itemDescription.sf1e.flame_doshko',
		defaultMessage: 'A doshko whose blade is wreathed in fire, setting its targets alight.',
		description: 'Description of every model of flame doshko, such as the ember flame doshko, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	grindblade: {
		id: 'itemDescription.sf1e.grindblade',
		defaultMessage: 'A sword whose edge is a whirring saw chain that chews through armor.',
		description: 'Description of the grindblade, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	hammer: {
		id: 'itemDescription.sf1e.hammer',
		defaultMessage: 'A war hammer with a dense head that crushes armor. Better models add thrusters or gravity to each blow.',
		description: 'Description of every model of hammer, such as the assault hammer, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	injection_glove: {
		id: 'itemDescription.sf1e.injection_glove',
		defaultMessage: 'A glove with a needle in its palm that injects whatever drug, medicine or poison is loaded into it.',
		description: 'Description of the injection glove, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	longsword: {
		id: 'itemDescription.sf1e.longsword',
		defaultMessage: 'A straight, double-edged sword, the classic weapon of knights and soldiers, forged with ever finer edges in its better models.',
		description: 'Description of every model of longsword, such as the tactical longsword, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	monowhip: {
		id: 'itemDescription.sf1e.monowhip',
		defaultMessage: 'A whip of a single wire so thin it is nearly invisible, which slices through whatever it lashes.',
		description: 'Description of the monowhip, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	pike: {
		id: 'itemDescription.sf1e.pike',
		defaultMessage: 'A very long spear with a reinforced head, held in two hands to strike foes before they come close.',
		description: 'Description of every model of pike, such as the tactical pike, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	plasma_doshko: {
		id: 'itemDescription.sf1e.plasma_doshko',
		defaultMessage: 'A doshko whose blade is a field of superheated plasma that burns and shocks.',
		description: 'Description of every model of plasma doshko, such as the red star plasma doshko, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	plasma_sword: {
		id: 'itemDescription.sf1e.plasma_sword',
		defaultMessage: 'A hilt that projects a blade of glowing plasma, which burns and shocks what it touches.',
		description: 'Description of every model of plasma sword, such as the tactical plasma sword, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	pulse_gauntlet: {
		id: 'itemDescription.sf1e.pulse_gauntlet',
		defaultMessage: 'A heavy gauntlet that releases a burst of sound with each punch, knocking foes off their feet.',
		description: 'Description of every model of pulse gauntlet, such as the thunderstrike pulse gauntlet, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	quantum_entangler: {
		id: 'itemDescription.sf1e.quantum_entangler',
		defaultMessage: 'A two-handed weapon that disrupts matter at its smallest scale, staggering whatever it hits.',
		description: 'Description of every model of quantum entangler, such as the military quantum entangler, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	shock_truncheon: {
		id: 'itemDescription.sf1e.shock_truncheon',
		defaultMessage: 'A metal club that discharges a jolt of electricity with each blow.',
		description: 'Description of every model of shock truncheon, such as the static shock truncheon, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	skyfire_sword: {
		id: 'itemDescription.sf1e.skyfire_sword',
		defaultMessage: 'A sword made for the Skyfire Legion, whose blade glows with heat and burns as it cuts.',
		description: 'Description of every model of skyfire sword, such as the tactical skyfire sword, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	advanced_staff: {
		id: 'itemDescription.sf1e.advanced_staff',
		defaultMessage: 'A fighting staff fitted with emitters that turn aside blows aimed at its wielder.',
		description: 'Description of every model of staff, such as the sentinel staff, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	starknife: {
		id: 'itemDescription.sf1e.starknife',
		defaultMessage: 'A ring with four blades jutting out like the points of a star, wielded up close or thrown. It is sacred to the sun goddess Sarenrae.',
		description: 'Description of every model of starknife, such as the tactical starknife, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	swoop_hammer: {
		id: 'itemDescription.sf1e.swoop_hammer',
		defaultMessage: 'A huge two-handed hammer whose head has thrusters that drive it in sweeping blows.',
		description: 'Description of every model of swoop hammer, such as the tactical swoop hammer, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	taclash: {
		id: 'itemDescription.sf1e.taclash',
		defaultMessage: 'A whip of tough cable that lashes foes from a step away and can trip them.',
		description: 'Description of every model of taclash, such as the standard taclash, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	arc_pistol: {
		id: 'itemDescription.sf1e.arc_pistol',
		defaultMessage: 'A pistol that fires an arc of electricity, which can leap to a second target nearby.',
		description: 'Description of every model of arc pistol, such as the static arc pistol, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	flame_pistol: {
		id: 'itemDescription.sf1e.flame_pistol',
		defaultMessage: 'A pistol that sprays a short burst of burning fuel.',
		description: 'Description of the flame pistol, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	survival_flare_gun: {
		id: 'itemDescription.sf1e.survival_flare_gun',
		defaultMessage: 'A pistol for launching bright signal flares, which also burn when fired at a foe.',
		description: 'Description of the survival flare gun, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	gyrojet_pistol: {
		id: 'itemDescription.sf1e.gyrojet_pistol',
		defaultMessage: 'A pistol that fires small self-propelled rockets, which hit hard against armored foes.',
		description: 'Description of every model of gyrojet pistol, such as the tactical gyrojet pistol, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	laser_pistol: {
		id: 'itemDescription.sf1e.laser_pistol',
		defaultMessage: 'A common sidearm that fires beams of focused light, burning what they hit. It runs on batteries.',
		description: 'Description of every model of laser pistol, such as the azimuth laser pistol, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	needler_pistol: {
		id: 'itemDescription.sf1e.needler_pistol',
		defaultMessage: 'A quiet pistol that fires darts, each of which can carry a dose of a drug or poison.',
		description: 'Description of the needler pistol, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	plasma_pistol: {
		id: 'itemDescription.sf1e.plasma_pistol',
		defaultMessage: 'A pistol that fires bolts of superheated plasma, which burn and shock.',
		description: 'Description of every model of plasma pistol, such as the red star plasma pistol, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	pulsecaster_pistol: {
		id: 'itemDescription.sf1e.pulsecaster_pistol',
		defaultMessage: 'A pistol that fires pulses of electricity meant to stun rather than kill.',
		description: 'Description of the pulsecaster pistol, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	semi_auto_pistol: {
		id: 'itemDescription.sf1e.semi_auto_pistol',
		defaultMessage: 'A dependable handgun that fires one bullet for each pull of the trigger.',
		description: 'Description of every model of semi-auto pistol, such as the tactical semi-auto pistol, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	sonic_pistol: {
		id: 'itemDescription.sf1e.sonic_pistol',
		defaultMessage: 'A pistol that fires a focused blast of sound that can deafen its target.',
		description: 'Description of every model of sonic pistol, such as the thunderstrike sonic pistol, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	zero_pistol: {
		id: 'itemDescription.sf1e.zero_pistol',
		defaultMessage: 'A pistol that fires a blast of supercooled gas, chilling its target and slowing it down.',
		description: 'Description of every model of zero pistol, such as the frostbite-class zero pistol, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	acid_dart_rifle: {
		id: 'itemDescription.sf1e.acid_dart_rifle',
		defaultMessage: 'A rifle that fires darts which burst and spray acid when they hit.',
		description: 'Description of every model of acid dart rifle, such as the tactical acid dart rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	arc_emitter: {
		id: 'itemDescription.sf1e.arc_emitter',
		defaultMessage: 'A long gun that sprays a crackling cone of electricity over everything in front of it.',
		description: 'Description of every model of arc emitter, such as the tactical arc emitter, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	arc_rifle: {
		id: 'itemDescription.sf1e.arc_rifle',
		defaultMessage: 'A rifle that fires an arc of electricity, which can leap to a second target nearby.',
		description: 'Description of every model of arc rifle, such as the static arc rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	autobeam_rifle: {
		id: 'itemDescription.sf1e.autobeam_rifle',
		defaultMessage: 'A laser rifle that fires beams in rapid bursts, raking a whole area.',
		description: 'Description of every model of autobeam rifle, such as the tactical autobeam rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	autotarget_rifle: {
		id: 'itemDescription.sf1e.autotarget_rifle',
		defaultMessage: 'A rifle with a smart sight that finds its target for the shooter, so even the untrained can hit with it.',
		description: 'Description of the autotarget rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	combat_rifle: {
		id: 'itemDescription.sf1e.combat_rifle',
		defaultMessage: 'A rugged military rifle that fires heavy rounds, built to keep working in the worst conditions.',
		description: 'Description of the combat rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	crossbolter: {
		id: 'itemDescription.sf1e.crossbolter',
		defaultMessage: 'A modern crossbow that hurls heavy metal bolts with great force. The heaviest models are carried as heavy weapons.',
		description: 'Description of every model of crossbolter, such as the tactical crossbolter, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	flame_rifle: {
		id: 'itemDescription.sf1e.flame_rifle',
		defaultMessage: 'A rifle that sprays a line of burning fuel, setting its targets alight.',
		description: 'Description of the flame rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	gyrojet_rifle: {
		id: 'itemDescription.sf1e.gyrojet_rifle',
		defaultMessage: 'A rifle that fires small self-propelled rockets, which hit hard against armored foes.',
		description: 'Description of every model of gyrojet rifle, such as the tactical gyrojet rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	hunting_rifle: {
		id: 'itemDescription.sf1e.hunting_rifle',
		defaultMessage: 'A simple, accurate rifle that fires one bullet at a time, made for hunting game.',
		description: 'Description of the hunting rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	laser_rifle: {
		id: 'itemDescription.sf1e.laser_rifle',
		defaultMessage: 'A rifle that fires beams of focused light farther and harder than a laser pistol. It runs on batteries.',
		description: 'Description of every model of laser rifle, such as the azimuth laser rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	magnetar_rifle: {
		id: 'itemDescription.sf1e.magnetar_rifle',
		defaultMessage: 'A rifle that hurls bullets with magnetic coils, firing them in long bursts.',
		description: 'Description of every model of magnetar rifle, such as the tactical magnetar rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	needler_rifle: {
		id: 'itemDescription.sf1e.needler_rifle',
		defaultMessage: 'A quiet rifle that fires darts, each of which can carry a dose of a drug or poison.',
		description: 'Description of the needler rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	plasma_caster: {
		id: 'itemDescription.sf1e.plasma_caster',
		defaultMessage: 'A long gun that fires a beam of plasma, burning everything in a line.',
		description: 'Description of every model of plasma caster, such as the white star plasma caster, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	plasma_rifle: {
		id: 'itemDescription.sf1e.plasma_rifle',
		defaultMessage: 'A rifle that fires bolts of superheated plasma, which burn and shock.',
		description: 'Description of every model of plasma rifle, such as the red star plasma rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	pulsecaster_rifle: {
		id: 'itemDescription.sf1e.pulsecaster_rifle',
		defaultMessage: 'A rifle that fires pulses of electricity meant to stun rather than kill.',
		description: 'Description of the pulsecaster rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	scattergun: {
		id: 'itemDescription.sf1e.scattergun',
		defaultMessage: 'A shotgun that fires a spray of pellets in a cone, hitting everything in front of it.',
		description: 'Description of every model of scattergun, such as the utility scattergun, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	seeker_rifle: {
		id: 'itemDescription.sf1e.seeker_rifle',
		defaultMessage: 'A long-range rifle with a scope that helps the shooter pick out distant targets.',
		description: 'Description of every model of seeker rifle, such as the tactical seeker rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	sonic_rifle: {
		id: 'itemDescription.sf1e.sonic_rifle',
		defaultMessage: 'A rifle that fires a focused blast of sound that can deafen its target.',
		description: 'Description of every model of sonic rifle, such as the thunderstrike sonic rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	streetsweeper: {
		id: 'itemDescription.sf1e.streetsweeper',
		defaultMessage: 'A riot gun that fires a wide wave of sound to knock crowds down and drive them back.',
		description: 'Description of every model of streetsweeper, such as the thunderstrike streetsweeper, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	zero_rifle: {
		id: 'itemDescription.sf1e.zero_rifle',
		defaultMessage: 'A rifle that fires a blast of supercooled gas, chilling its target and slowing it down.',
		description: 'Description of every model of zero rifle, such as the frostbite-class zero rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	artillery_laser: {
		id: 'itemDescription.sf1e.artillery_laser',
		defaultMessage: 'A massive laser carried in two hands, which fires beams of light that burn through cover.',
		description: 'Description of every model of artillery laser, such as the azimuth artillery laser, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	autobeam_artillery: {
		id: 'itemDescription.sf1e.autobeam_artillery',
		defaultMessage: 'A heavy laser that fires rapid bursts of beams, sweeping a whole area.',
		description: 'Description of every model of autobeam artillery, such as the tactical autobeam artillery, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	flamethrower: {
		id: 'itemDescription.sf1e.flamethrower',
		defaultMessage: 'A heavy weapon fed by a tank of fuel, which sprays a wide stream of fire.',
		description: 'Description of every model of flamethrower, such as the Ifrit-class flamethrower, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	imds_missile_launcher: {
		id: 'itemDescription.sf1e.imds_missile_launcher',
		defaultMessage: 'A launcher carried on the shoulder that fires guided missiles, which explode where they land.',
		description: 'Description of the IMDS missile launcher, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	machine_gun: {
		id: 'itemDescription.sf1e.machine_gun',
		defaultMessage: 'A heavy gun that fires a stream of bullets, raking a whole area.',
		description: 'Description of every model of machine gun, such as the squad machine gun, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	nil_grenade_launcher: {
		id: 'itemDescription.sf1e.nil_grenade_launcher',
		defaultMessage: 'A weapon that lobs grenades much farther than they can be thrown.',
		description: 'Description of every model of NIL grenade launcher, such as the merc NIL grenade launcher, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	plasma_cannon: {
		id: 'itemDescription.sf1e.plasma_cannon',
		defaultMessage: 'A heavy gun that fires a line of superheated plasma, which burns and shocks.',
		description: 'Description of every model of plasma cannon, such as the red star plasma cannon, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	reaction_cannon: {
		id: 'itemDescription.sf1e.reaction_cannon',
		defaultMessage: 'A heavy gun that fires large shells with a kick that can knock its user back.',
		description: 'Description of every model of reaction cannon, such as the light reaction cannon, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	screamer: {
		id: 'itemDescription.sf1e.screamer',
		defaultMessage: 'A heavy weapon that unleashes a deafening blast of sound over everything in front of it.',
		description: 'Description of every model of screamer, such as the thunderstrike screamer, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	shock_caster: {
		id: 'itemDescription.sf1e.shock_caster',
		defaultMessage: 'A heavy weapon that fires a line of electricity, shocking everything in its path.',
		description: 'Description of every model of shock caster, such as the static shock caster, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	stellar_cannon: {
		id: 'itemDescription.sf1e.stellar_cannon',
		defaultMessage: 'A heavy gun that fires bursts of concentrated stellar energy, which burn and can blind.',
		description: 'Description of every model of stellar cannon, such as the light stellar cannon, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	x_gen_gun: {
		id: 'itemDescription.sf1e.x_gen_gun',
		defaultMessage: 'A heavy gun with spinning barrels that fires bullets at a furious rate.',
		description: 'Description of every model of X-gen gun, such as the tactical X-gen gun, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	zero_cannon: {
		id: 'itemDescription.sf1e.zero_cannon',
		defaultMessage: 'A heavy gun that fires a blast of supercooled gas, freezing what it hits.',
		description: 'Description of every model of zero cannon, such as the tactical zero cannon, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	shirren_eye_rifle: {
		id: 'itemDescription.sf1e.shirren_eye_rifle',
		defaultMessage: 'A long sniper rifle designed by the shirren, deadly from great distances.',
		description: 'Description of every model of shirren-eye rifle, such as the tactical shirren-eye rifle, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	cryo_grenade: {
		id: 'itemDescription.sf1e.cryo_grenade',
		defaultMessage: 'A grenade that bursts into a cloud of freezing cold, chilling everyone nearby.',
		description: 'Description of every model of cryo grenade, such as the cryo grenade I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	flash_grenade: {
		id: 'itemDescription.sf1e.flash_grenade',
		defaultMessage: 'A grenade that bursts into a blinding flash of light.',
		description: 'Description of every model of flash grenade, such as the flash grenade I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	frag_grenade: {
		id: 'itemDescription.sf1e.frag_grenade',
		defaultMessage: 'A grenade that explodes into a burst of sharp shrapnel.',
		description: 'Description of every model of frag grenade, such as the frag grenade I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	incendiary_grenade: {
		id: 'itemDescription.sf1e.incendiary_grenade',
		defaultMessage: 'A grenade that bursts into flames, setting everyone nearby alight.',
		description: 'Description of every model of incendiary grenade, such as the incendiary grenade I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	screamer_grenade: {
		id: 'itemDescription.sf1e.screamer_grenade',
		defaultMessage: 'A grenade that bursts with a deafening shriek of sound.',
		description: 'Description of every model of screamer grenade, such as the screamer grenade I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	shock_grenade: {
		id: 'itemDescription.sf1e.shock_grenade',
		defaultMessage: 'A grenade that releases a burst of electricity, shocking everyone nearby.',
		description: 'Description of every model of shock grenade, such as the shock grenade I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	smoke_grenade: {
		id: 'itemDescription.sf1e.smoke_grenade',
		defaultMessage: 'A grenade that fills the area with thick smoke, hiding anyone inside it.',
		description: 'Description of the smoke grenade, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	stickybomb_grenade: {
		id: 'itemDescription.sf1e.stickybomb_grenade',
		defaultMessage: 'A grenade that bursts into a spray of sticky goo, gluing anyone nearby in place.',
		description: 'Description of every model of stickybomb grenade, such as the stickybomb grenade I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	bow: {
		id: 'itemDescription.sf1e.bow',
		defaultMessage: 'A bow of modern materials that shoots arrows, a weapon of hunters and of worlds without guns.',
		description: 'Description of the bow, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	carbonedge_shuriken: {
		id: 'itemDescription.sf1e.carbonedge_shuriken',
		defaultMessage: 'A small, sharp throwing star with carbon edges.',
		description: 'Description of the carbonedge shuriken, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	nyfiber_net: {
		id: 'itemDescription.sf1e.nyfiber_net',
		defaultMessage: 'A net of tough fiber that is thrown to entangle a foe.',
		description: 'Description of the nyfiber net, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	arrows: {
		id: 'itemDescription.sf1e.arrows',
		defaultMessage: 'Arrows for a bow.',
		description: 'Description of the arrows, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	darts: {
		id: 'itemDescription.sf1e.darts',
		defaultMessage: 'Darts for needler pistols, needler rifles and acid dart rifles.',
		description: 'Description of the darts, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	flares: {
		id: 'itemDescription.sf1e.flares',
		defaultMessage: 'Flares for a survival flare gun.',
		description: 'Description of the flares, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	battery: {
		id: 'itemDescription.sf1e.battery',
		defaultMessage: 'A rechargeable battery that powers energy weapons and many devices.',
		description: 'Description of the battery, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	high_capacity_battery: {
		id: 'itemDescription.sf1e.high_capacity_battery',
		defaultMessage: 'A battery that holds more charges than a standard one, for powerful energy weapons and devices.',
		description: 'Description of every model of battery, such as the high-capacity battery, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	small_arm_rounds: {
		id: 'itemDescription.sf1e.small_arm_rounds',
		defaultMessage: 'Bullets for pistols and other small arms.',
		description: 'Description of the small arm rounds, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	longarm_and_sniper_rounds: {
		id: 'itemDescription.sf1e.longarm_and_sniper_rounds',
		defaultMessage: 'Bullets for rifles and sniper rifles.',
		description: 'Description of the longarm and sniper rounds, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	heavy_rounds: {
		id: 'itemDescription.sf1e.heavy_rounds',
		defaultMessage: 'Large bullets for machine guns and other heavy weapons.',
		description: 'Description of the heavy rounds, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	explosive_heavy_rounds: {
		id: 'itemDescription.sf1e.explosive_heavy_rounds',
		defaultMessage: 'Large bullets for heavy weapons that explode where they hit.',
		description: 'Description of the explosive heavy rounds, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	scattergun_shells: {
		id: 'itemDescription.sf1e.scattergun_shells',
		defaultMessage: 'Shells full of pellets for a scattergun.',
		description: 'Description of the scattergun shells, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	explosive_scattergun_shells: {
		id: 'itemDescription.sf1e.explosive_scattergun_shells',
		defaultMessage: 'Scattergun shells that explode where they hit.',
		description: 'Description of the explosive scattergun shells, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	mini_rockets: {
		id: 'itemDescription.sf1e.mini_rockets',
		defaultMessage: 'Small rockets for gyrojet pistols and rifles.',
		description: 'Description of the mini-rockets, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	missile: {
		id: 'itemDescription.sf1e.missile',
		defaultMessage: 'A guided missile for a missile launcher.',
		description: 'Description of every model of missile, such as the tactical missile, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	grenade_arrows: {
		id: 'itemDescription.sf1e.grenade_arrows',
		defaultMessage: 'Arrows tipped with a grenade, which goes off where the arrow lands.',
		description: 'Description of every model of grenade arrows, such as the grenade arrows II, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	second_skin: {
		id: 'itemDescription.sf1e.second_skin',
		defaultMessage: 'A thin, tight bodysuit of protective fiber, light enough to wear under clothes.',
		description: 'Description of the second skin, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	estex_suit: {
		id: 'itemDescription.sf1e.estex_suit',
		defaultMessage: 'Light armor of padded, interlocking plates, common among explorers and mercenaries.',
		description: 'Description of every model of estex suit, such as the estex suit I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	stationwear: {
		id: 'itemDescription.sf1e.stationwear',
		defaultMessage: 'Everyday clothes of a space station, with protective layers woven in so they work as light armor.',
		description: 'Description of every model of stationwear, such as the flight suit stationwear, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	kasatha_microcord: {
		id: 'itemDescription.sf1e.kasatha_microcord',
		defaultMessage: 'Light armor woven from fine, strong cord in the kasathas\' tradition, made to keep the wearer cool.',
		description: 'Description of every model of kasatha microcord, such as the kasatha microcord I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	freebooter_armor: {
		id: 'itemDescription.sf1e.freebooter_armor',
		defaultMessage: 'Light armor of leather and metal plates, favored by space pirates and smugglers.',
		description: 'Description of every model of freebooter armor, such as the freebooter armor I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	carbon_skin: {
		id: 'itemDescription.sf1e.carbon_skin',
		defaultMessage: 'Light armor of thin carbon plates that are tough yet flexible.',
		description: 'Description of every model of carbon skin, such as the graphite carbon skin, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	lashunta_tempweave: {
		id: 'itemDescription.sf1e.lashunta_tempweave',
		defaultMessage: 'Light armor woven in the lashuntas\' tradition, which keeps its wearer comfortable in heat and cold.',
		description: 'Description of every model of lashunta tempweave, such as the basic lashunta tempweave, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	defrex_hide: {
		id: 'itemDescription.sf1e.defrex_hide',
		defaultMessage: 'Light armor made from the tough hide of the defrex, a large beast.',
		description: 'Description of the defrex hide, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	d_suit: {
		id: 'itemDescription.sf1e.d_suit',
		defaultMessage: 'Light armor of layered protective plates, made for defense.',
		description: 'Description of every model of D-suit, such as the D-suit I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	ysoki_refractor_suit: {
		id: 'itemDescription.sf1e.ysoki_refractor_suit',
		defaultMessage: 'Light armor made by the ysoki, which bends light to make its wearer harder to see.',
		description: 'Description of the ysoki refractor suit, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	abadarcorp_travel_suit: {
		id: 'itemDescription.sf1e.abadarcorp_travel_suit',
		defaultMessage: 'A stylish suit made by AbadarCorp for travelers, which works as light armor.',
		description: 'Description of every model of AbadarCorp travel suit, such as the silver AbadarCorp travel suit, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	hardlight_series: {
		id: 'itemDescription.sf1e.hardlight_series',
		defaultMessage: 'Light armor that projects plates of solid light over its wearer.',
		description: 'Description of every model of hardlight series, such as the squad hardlight series, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	boardroom_attire: {
		id: 'itemDescription.sf1e.boardroom_attire',
		defaultMessage: 'An elegant business suit with protective layers hidden in its weave.',
		description: 'Description of the boardroom attire, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	echelon_fashion: {
		id: 'itemDescription.sf1e.echelon_fashion',
		defaultMessage: 'Fashionable clothing for the elite, with protective layers hidden in its weave.',
		description: 'Description of every model of echelon fashion, such as the ready-to-wear echelon fashion, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	swarmsuit: {
		id: 'itemDescription.sf1e.swarmsuit',
		defaultMessage: 'Light armor sealed against stinging insects and other swarms.',
		description: 'Description of the swarmsuit, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	shotalashu_armor: {
		id: 'itemDescription.sf1e.shotalashu_armor',
		defaultMessage: 'Light armor made for riders of shotalashus, the lashuntas\' mounts.',
		description: 'Description of the shotalashu armor, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	ceremonial_plate: {
		id: 'itemDescription.sf1e.ceremonial_plate',
		defaultMessage: 'Polished heavy armor worn by soldiers and officers for parades and ceremonies, and in battle.',
		description: 'Description of every model of ceremonial plate, such as the troop ceremonial plate, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	golemforged_plating: {
		id: 'itemDescription.sf1e.golemforged_plating',
		defaultMessage: 'Heavy armor of thick plates forged by golems.',
		description: 'Description of every model of golemforged plating, such as the golemforged plating I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	lashunta_ringwear: {
		id: 'itemDescription.sf1e.lashunta_ringwear',
		defaultMessage: 'Heavy armor of interlocking metal rings in the lashuntas\' tradition.',
		description: 'Description of every model of lashunta ringwear, such as the lashunta ringwear I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	hidden_soldier_armor: {
		id: 'itemDescription.sf1e.hidden_soldier_armor',
		defaultMessage: 'Heavy armor that shifts its color to match its surroundings, hiding its wearer.',
		description: 'Description of the hidden soldier armor, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	iridishell: {
		id: 'itemDescription.sf1e.iridishell',
		defaultMessage: 'Heavy armor of shimmering, iridescent plates like an insect\'s shell.',
		description: 'Description of every model of iridishell, such as the basic iridishell, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	thinplate: {
		id: 'itemDescription.sf1e.thinplate',
		defaultMessage: 'Heavy armor of thin, strong plates, lighter than most heavy armor.',
		description: 'Description of the thinplate, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	defiance_series: {
		id: 'itemDescription.sf1e.defiance_series',
		defaultMessage: 'Military heavy armor made for frontline troops.',
		description: 'Description of every model of defiance series, such as the squad defiance series, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	vesk_overplate: {
		id: 'itemDescription.sf1e.vesk_overplate',
		defaultMessage: 'Heavy armor of thick overlapping plates in the vesk\'s style.',
		description: 'Description of every model of vesk overplate, such as the vesk overplate I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	skyfire_armor: {
		id: 'itemDescription.sf1e.skyfire_armor',
		defaultMessage: 'Heavy armor made for the Skyfire Legion, with plates shaped like wings.',
		description: 'Description of every model of skyfire armor, such as the pinion skyfire armor, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	vesk_monolith: {
		id: 'itemDescription.sf1e.vesk_monolith',
		defaultMessage: 'Massive heavy armor of the vesk, nearly impenetrable.',
		description: 'Description of every model of vesk monolith, such as the vesk monolith I, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	aegis_series: {
		id: 'itemDescription.sf1e.aegis_series',
		defaultMessage: 'Military heavy armor built to protect its wearer above all.',
		description: 'Description of every model of aegis series, such as the squad aegis series, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	enginerunner: {
		id: 'itemDescription.sf1e.enginerunner',
		defaultMessage: 'Heavy armor made for working around engines and machinery.',
		description: 'Description of the enginerunner, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	steelbones: {
		id: 'itemDescription.sf1e.steelbones',
		defaultMessage: 'Heavy armor built on a metal frame that braces its wearer\'s bones.',
		description: 'Description of the steelbones, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	vitrum_plate: {
		id: 'itemDescription.sf1e.vitrum_plate',
		defaultMessage: 'Heavy armor of plates of strong, clear glass.',
		description: 'Description of the vitrum plate, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	},
	voidshield_armor: {
		id: 'itemDescription.sf1e.voidshield_armor',
		defaultMessage: 'Heavy armor that shields its wearer even in the void of space.',
		description: 'Description of the voidshield armor, an item in Starfinder, shown in the item editor, when choosing items, on a character\'s sheet and on the Audit tab'
	}
});

/**
 * A default item's category and types, where it equips (itemEquipsChoices()) and its description
 */
interface Sf1eDefaultItem
{
	category: Sf1eItemCategory;
	types: readonly Sf1eItemType[];
	equips: string;
	description: MessageDescriptor;
}

/**
 * A kind of default item, which every model of a weapon or armor shares
 *
 * @param category The category
 * @param type Its one type
 * @param equips Where it equips
 * @param description Its description
 * @return The kind
 */
function kind(category: Sf1eItemCategory, type: Sf1eItemType, equips: string, description: MessageDescriptor): Sf1eDefaultItem
{
	return({
		category,
		types: [type],
		equips,
		description
	});
}

/**
 * Each kind of default item, by the weapon or armor it is
 */
const KINDS = {
	survival_knife: kind('weapon', 'basic_melee', 'oneHand', DESCRIPTIONS.survival_knife),
	tactical_knife: kind('weapon', 'basic_melee', 'oneHand', DESCRIPTIONS.tactical_knife),
	baton: kind('weapon', 'basic_melee', 'oneHand', DESCRIPTIONS.baton),
	battleglove: kind('weapon', 'basic_melee', 'oneHand', DESCRIPTIONS.battleglove),
	club: kind('weapon', 'basic_melee', 'oneHand', DESCRIPTIONS.club),
	dagger: kind('weapon', 'basic_melee', 'oneHand', DESCRIPTIONS.dagger),
	dueling_sword: kind('weapon', 'basic_melee', 'oneHand', DESCRIPTIONS.dueling_sword),
	incapacitator: kind('weapon', 'basic_melee', 'oneHand', DESCRIPTIONS.incapacitator),
	peacemaker: kind('weapon', 'basic_melee', 'oneHand', DESCRIPTIONS.peacemaker),
	spear: kind('weapon', 'basic_melee', 'twoHands', DESCRIPTIONS.spear),
	basic_staff: kind('weapon', 'basic_melee', 'twoHands', DESCRIPTIONS.basic_staff),
	cryopike: kind('weapon', 'advanced_melee', 'twoHands', DESCRIPTIONS.cryopike),
	curve_blade: kind('weapon', 'advanced_melee', 'twoHands', DESCRIPTIONS.curve_blade),
	devastation_blade: kind('weapon', 'advanced_melee', 'twoHands', DESCRIPTIONS.devastation_blade),
	doshko: kind('weapon', 'advanced_melee', 'twoHands', DESCRIPTIONS.doshko),
	fangblade: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.fangblade),
	flame_doshko: kind('weapon', 'advanced_melee', 'twoHands', DESCRIPTIONS.flame_doshko),
	grindblade: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.grindblade),
	hammer: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.hammer),
	injection_glove: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.injection_glove),
	longsword: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.longsword),
	monowhip: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.monowhip),
	pike: kind('weapon', 'advanced_melee', 'twoHands', DESCRIPTIONS.pike),
	plasma_doshko: kind('weapon', 'advanced_melee', 'twoHands', DESCRIPTIONS.plasma_doshko),
	plasma_sword: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.plasma_sword),
	pulse_gauntlet: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.pulse_gauntlet),
	quantum_entangler: kind('weapon', 'advanced_melee', 'twoHands', DESCRIPTIONS.quantum_entangler),
	shock_truncheon: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.shock_truncheon),
	skyfire_sword: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.skyfire_sword),
	advanced_staff: kind('weapon', 'advanced_melee', 'twoHands', DESCRIPTIONS.advanced_staff),
	starknife: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.starknife),
	swoop_hammer: kind('weapon', 'advanced_melee', 'twoHands', DESCRIPTIONS.swoop_hammer),
	taclash: kind('weapon', 'advanced_melee', 'oneHand', DESCRIPTIONS.taclash),
	arc_pistol: kind('weapon', 'small_arms', 'oneHand', DESCRIPTIONS.arc_pistol),
	flame_pistol: kind('weapon', 'small_arms', 'oneHand', DESCRIPTIONS.flame_pistol),
	survival_flare_gun: kind('weapon', 'small_arms', 'oneHand', DESCRIPTIONS.survival_flare_gun),
	gyrojet_pistol: kind('weapon', 'small_arms', 'oneHand', DESCRIPTIONS.gyrojet_pistol),
	laser_pistol: kind('weapon', 'small_arms', 'oneHand', DESCRIPTIONS.laser_pistol),
	needler_pistol: kind('weapon', 'small_arms', 'oneHand', DESCRIPTIONS.needler_pistol),
	plasma_pistol: kind('weapon', 'small_arms', 'oneHand', DESCRIPTIONS.plasma_pistol),
	pulsecaster_pistol: kind('weapon', 'small_arms', 'oneHand', DESCRIPTIONS.pulsecaster_pistol),
	semi_auto_pistol: kind('weapon', 'small_arms', 'oneHand', DESCRIPTIONS.semi_auto_pistol),
	sonic_pistol: kind('weapon', 'small_arms', 'oneHand', DESCRIPTIONS.sonic_pistol),
	zero_pistol: kind('weapon', 'small_arms', 'oneHand', DESCRIPTIONS.zero_pistol),
	acid_dart_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.acid_dart_rifle),
	arc_emitter: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.arc_emitter),
	arc_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.arc_rifle),
	autobeam_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.autobeam_rifle),
	autotarget_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.autotarget_rifle),
	combat_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.combat_rifle),
	crossbolter: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.crossbolter),
	flame_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.flame_rifle),
	gyrojet_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.gyrojet_rifle),
	hunting_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.hunting_rifle),
	laser_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.laser_rifle),
	magnetar_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.magnetar_rifle),
	needler_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.needler_rifle),
	plasma_caster: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.plasma_caster),
	plasma_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.plasma_rifle),
	pulsecaster_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.pulsecaster_rifle),
	scattergun: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.scattergun),
	seeker_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.seeker_rifle),
	sonic_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.sonic_rifle),
	streetsweeper: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.streetsweeper),
	zero_rifle: kind('weapon', 'longarms', 'twoHands', DESCRIPTIONS.zero_rifle),
	artillery_laser: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.artillery_laser),
	autobeam_artillery: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.autobeam_artillery),
	heavy_crossbolter: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.crossbolter),
	flamethrower: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.flamethrower),
	imds_missile_launcher: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.imds_missile_launcher),
	machine_gun: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.machine_gun),
	nil_grenade_launcher: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.nil_grenade_launcher),
	plasma_cannon: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.plasma_cannon),
	reaction_cannon: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.reaction_cannon),
	screamer: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.screamer),
	shock_caster: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.shock_caster),
	stellar_cannon: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.stellar_cannon),
	x_gen_gun: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.x_gen_gun),
	zero_cannon: kind('weapon', 'heavy_weapons', 'twoHands', DESCRIPTIONS.zero_cannon),
	shirren_eye_rifle: kind('weapon', 'sniper_weapons', 'twoHands', DESCRIPTIONS.shirren_eye_rifle),
	cryo_grenade: kind('weapon', 'grenades', 'oneHand', DESCRIPTIONS.cryo_grenade),
	flash_grenade: kind('weapon', 'grenades', 'oneHand', DESCRIPTIONS.flash_grenade),
	frag_grenade: kind('weapon', 'grenades', 'oneHand', DESCRIPTIONS.frag_grenade),
	incendiary_grenade: kind('weapon', 'grenades', 'oneHand', DESCRIPTIONS.incendiary_grenade),
	screamer_grenade: kind('weapon', 'grenades', 'oneHand', DESCRIPTIONS.screamer_grenade),
	shock_grenade: kind('weapon', 'grenades', 'oneHand', DESCRIPTIONS.shock_grenade),
	smoke_grenade: kind('weapon', 'grenades', 'oneHand', DESCRIPTIONS.smoke_grenade),
	stickybomb_grenade: kind('weapon', 'grenades', 'oneHand', DESCRIPTIONS.stickybomb_grenade),
	bow: kind('weapon', 'special_weapons', 'twoHands', DESCRIPTIONS.bow),
	carbonedge_shuriken: kind('weapon', 'special_weapons', 'oneHand', DESCRIPTIONS.carbonedge_shuriken),
	nyfiber_net: kind('weapon', 'special_weapons', 'oneHand', DESCRIPTIONS.nyfiber_net),
	arrows: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.arrows),
	darts: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.darts),
	flares: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.flares),
	battery: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.battery),
	high_capacity_battery: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.high_capacity_battery),
	small_arm_rounds: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.small_arm_rounds),
	longarm_and_sniper_rounds: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.longarm_and_sniper_rounds),
	heavy_rounds: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.heavy_rounds),
	explosive_heavy_rounds: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.explosive_heavy_rounds),
	scattergun_shells: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.scattergun_shells),
	explosive_scattergun_shells: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.explosive_scattergun_shells),
	mini_rockets: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.mini_rockets),
	missile: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.missile),
	grenade_arrows: kind('weapon', 'ammunition', 'none', DESCRIPTIONS.grenade_arrows),
	second_skin: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.second_skin),
	estex_suit: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.estex_suit),
	stationwear: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.stationwear),
	kasatha_microcord: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.kasatha_microcord),
	freebooter_armor: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.freebooter_armor),
	carbon_skin: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.carbon_skin),
	lashunta_tempweave: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.lashunta_tempweave),
	defrex_hide: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.defrex_hide),
	d_suit: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.d_suit),
	ysoki_refractor_suit: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.ysoki_refractor_suit),
	abadarcorp_travel_suit: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.abadarcorp_travel_suit),
	hardlight_series: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.hardlight_series),
	boardroom_attire: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.boardroom_attire),
	echelon_fashion: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.echelon_fashion),
	swarmsuit: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.swarmsuit),
	shotalashu_armor: kind('armor', 'light_armor', 'armor', DESCRIPTIONS.shotalashu_armor),
	ceremonial_plate: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.ceremonial_plate),
	golemforged_plating: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.golemforged_plating),
	lashunta_ringwear: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.lashunta_ringwear),
	hidden_soldier_armor: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.hidden_soldier_armor),
	iridishell: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.iridishell),
	thinplate: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.thinplate),
	defiance_series: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.defiance_series),
	vesk_overplate: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.vesk_overplate),
	skyfire_armor: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.skyfire_armor),
	vesk_monolith: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.vesk_monolith),
	aegis_series: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.aegis_series),
	enginerunner: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.enginerunner),
	steelbones: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.steelbones),
	vitrum_plate: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.vitrum_plate),
	voidshield_armor: kind('armor', 'heavy_armor', 'armor', DESCRIPTIONS.voidshield_armor)
};

/**
 * Each default item's kind, by the item's key
 */
export const SF1E_DEFAULT_ITEMS: Record<Sf1eDefaultItemKey, Sf1eDefaultItem> = {
	survival_knife: KINDS.survival_knife,
	tactical_knife: KINDS.tactical_knife,
	tactical_baton: KINDS.baton,
	advanced_baton: KINDS.baton,
	cestus_battleglove: KINDS.battleglove,
	power_battleglove: KINDS.battleglove,
	nova_battleglove: KINDS.battleglove,
	gravity_battleglove: KINDS.battleglove,
	club: KINDS.club,
	ultrathin_dagger: KINDS.dagger,
	zero_edge_dagger: KINDS.dagger,
	molecular_rift_dagger: KINDS.dagger,
	tactical_dueling_sword: KINDS.dueling_sword,
	buzzblade_dueling_sword: KINDS.dueling_sword,
	ultrathin_dueling_sword: KINDS.dueling_sword,
	ripper_dueling_sword: KINDS.dueling_sword,
	molecular_rift_dueling_sword: KINDS.dueling_sword,
	incapacitator: KINDS.incapacitator,
	peacemaker: KINDS.peacemaker,
	tactical_spear: KINDS.spear,
	sentinel_spear: KINDS.spear,
	buzzblade_spear: KINDS.spear,
	zero_edge_spear: KINDS.spear,
	gravity_spear: KINDS.spear,
	battle_staff: KINDS.basic_staff,
	carbon_staff: KINDS.basic_staff,
	hardlight_staff: KINDS.basic_staff,
	tactical_cryopike: KINDS.cryopike,
	advanced_cryopike: KINDS.cryopike,
	carbon_steel_curve_blade: KINDS.curve_blade,
	ultrathin_curve_blade: KINDS.curve_blade,
	buzzblade_curve_blade: KINDS.curve_blade,
	dimensional_slice_curve_blade: KINDS.curve_blade,
	wrack_devastation_blade: KINDS.devastation_blade,
	ruin_devastation_blade: KINDS.devastation_blade,
	apocalypse_devastation_blade: KINDS.devastation_blade,
	tactical_doshko: KINDS.doshko,
	advanced_doshko: KINDS.doshko,
	ultrathin_doshko: KINDS.doshko,
	zero_edge_doshko: KINDS.doshko,
	molecular_rift_doshko: KINDS.doshko,
	dimensional_blade_doshko: KINDS.doshko,
	fangblade: KINDS.fangblade,
	ember_flame_doshko: KINDS.flame_doshko,
	blaze_flame_doshko: KINDS.flame_doshko,
	inferno_flame_doshko: KINDS.flame_doshko,
	solar_flare_flame_doshko: KINDS.flame_doshko,
	grindblade: KINDS.grindblade,
	assault_hammer: KINDS.hammer,
	comet_hammer: KINDS.hammer,
	meteoric_hammer: KINDS.hammer,
	gravity_well_hammer: KINDS.hammer,
	injection_glove: KINDS.injection_glove,
	tactical_longsword: KINDS.longsword,
	sintered_longsword: KINDS.longsword,
	microserrated_longsword: KINDS.longsword,
	ultrathin_longsword: KINDS.longsword,
	zero_edge_longsword: KINDS.longsword,
	molecular_rift_longsword: KINDS.longsword,
	ultraserrated_longsword: KINDS.longsword,
	dimensional_slice_longsword: KINDS.longsword,
	monowhip: KINDS.monowhip,
	tactical_pike: KINDS.pike,
	advanced_pike: KINDS.pike,
	elite_pike: KINDS.pike,
	red_star_plasma_doshko: KINDS.plasma_doshko,
	yellow_star_plasma_doshko: KINDS.plasma_doshko,
	white_star_plasma_doshko: KINDS.plasma_doshko,
	blue_star_plasma_doshko: KINDS.plasma_doshko,
	tactical_plasma_sword: KINDS.plasma_sword,
	red_star_plasma_sword: KINDS.plasma_sword,
	yellow_star_plasma_sword: KINDS.plasma_sword,
	white_star_plasma_sword: KINDS.plasma_sword,
	blue_star_plasma_sword: KINDS.plasma_sword,
	thunderstrike_pulse_gauntlet: KINDS.pulse_gauntlet,
	lfd_pulse_gauntlet: KINDS.pulse_gauntlet,
	hfd_pulse_gauntlet: KINDS.pulse_gauntlet,
	banshee_pulse_gauntlet: KINDS.pulse_gauntlet,
	military_quantum_entangler: KINDS.quantum_entangler,
	dominion_quantum_entangler: KINDS.quantum_entangler,
	static_shock_truncheon: KINDS.shock_truncheon,
	aurora_shock_truncheon: KINDS.shock_truncheon,
	storm_shock_truncheon: KINDS.shock_truncheon,
	tempest_shock_truncheon: KINDS.shock_truncheon,
	tactical_skyfire_sword: KINDS.skyfire_sword,
	inferno_skyfire_sword: KINDS.skyfire_sword,
	sentinel_staff: KINDS.advanced_staff,
	repeller_staff: KINDS.advanced_staff,
	tactical_starknife: KINDS.starknife,
	sintered_starknife: KINDS.starknife,
	accelerated_starknife: KINDS.starknife,
	lightspeed_starknife: KINDS.starknife,
	dimensional_slice_starknife: KINDS.starknife,
	tactical_swoop_hammer: KINDS.swoop_hammer,
	advanced_swoop_hammer: KINDS.swoop_hammer,
	mach_1_swoop_hammer: KINDS.swoop_hammer,
	mach_2_swoop_hammer: KINDS.swoop_hammer,
	mach_3_swoop_hammer: KINDS.swoop_hammer,
	standard_taclash: KINDS.taclash,
	numbing_taclash: KINDS.taclash,
	static_arc_pistol: KINDS.arc_pistol,
	aurora_arc_pistol: KINDS.arc_pistol,
	storm_arc_pistol: KINDS.arc_pistol,
	flame_pistol: KINDS.flame_pistol,
	survival_flare_gun: KINDS.survival_flare_gun,
	tactical_gyrojet_pistol: KINDS.gyrojet_pistol,
	advanced_gyrojet_pistol: KINDS.gyrojet_pistol,
	elite_gyrojet_pistol: KINDS.gyrojet_pistol,
	azimuth_laser_pistol: KINDS.laser_pistol,
	corona_laser_pistol: KINDS.laser_pistol,
	aphelion_laser_pistol: KINDS.laser_pistol,
	perihelion_laser_pistol: KINDS.laser_pistol,
	parallax_laser_pistol: KINDS.laser_pistol,
	zenith_laser_pistol: KINDS.laser_pistol,
	needler_pistol: KINDS.needler_pistol,
	red_star_plasma_pistol: KINDS.plasma_pistol,
	yellow_star_plasma_pistol: KINDS.plasma_pistol,
	white_star_plasma_pistol: KINDS.plasma_pistol,
	blue_star_plasma_pistol: KINDS.plasma_pistol,
	pulsecaster_pistol: KINDS.pulsecaster_pistol,
	tactical_semi_auto_pistol: KINDS.semi_auto_pistol,
	advanced_semi_auto_pistol: KINDS.semi_auto_pistol,
	elite_semi_auto_pistol: KINDS.semi_auto_pistol,
	paragon_semi_auto_pistol: KINDS.semi_auto_pistol,
	thunderstrike_sonic_pistol: KINDS.sonic_pistol,
	lfd_sonic_pistol: KINDS.sonic_pistol,
	hfd_sonic_pistol: KINDS.sonic_pistol,
	banshee_sonic_pistol: KINDS.sonic_pistol,
	frostbite_class_zero_pistol: KINDS.zero_pistol,
	hailstorm_class_zero_pistol: KINDS.zero_pistol,
	blizzard_class_zero_pistol: KINDS.zero_pistol,
	avalanche_class_zero_pistol: KINDS.zero_pistol,
	tactical_acid_dart_rifle: KINDS.acid_dart_rifle,
	dual_acid_dart_rifle: KINDS.acid_dart_rifle,
	complex_acid_dart_rifle: KINDS.acid_dart_rifle,
	tactical_arc_emitter: KINDS.arc_emitter,
	advanced_arc_emitter: KINDS.arc_emitter,
	static_arc_rifle: KINDS.arc_rifle,
	aurora_arc_rifle: KINDS.arc_rifle,
	storm_arc_rifle: KINDS.arc_rifle,
	tempest_arc_rifle: KINDS.arc_rifle,
	tactical_autobeam_rifle: KINDS.autobeam_rifle,
	advanced_autobeam_rifle: KINDS.autobeam_rifle,
	elite_autobeam_rifle: KINDS.autobeam_rifle,
	autotarget_rifle: KINDS.autotarget_rifle,
	combat_rifle: KINDS.combat_rifle,
	tactical_crossbolter: KINDS.crossbolter,
	dual_crossbolter: KINDS.crossbolter,
	flame_rifle: KINDS.flame_rifle,
	tactical_gyrojet_rifle: KINDS.gyrojet_rifle,
	advanced_gyrojet_rifle: KINDS.gyrojet_rifle,
	elite_gyrojet_rifle: KINDS.gyrojet_rifle,
	paragon_gyrojet_rifle: KINDS.gyrojet_rifle,
	hunting_rifle: KINDS.hunting_rifle,
	azimuth_laser_rifle: KINDS.laser_rifle,
	corona_laser_rifle: KINDS.laser_rifle,
	aphelion_laser_rifle: KINDS.laser_rifle,
	perihelion_laser_rifle: KINDS.laser_rifle,
	parallax_laser_rifle: KINDS.laser_rifle,
	zenith_laser_rifle: KINDS.laser_rifle,
	tactical_magnetar_rifle: KINDS.magnetar_rifle,
	advanced_magnetar_rifle: KINDS.magnetar_rifle,
	elite_magnetar_rifle: KINDS.magnetar_rifle,
	paragon_magnetar_rifle: KINDS.magnetar_rifle,
	needler_rifle: KINDS.needler_rifle,
	white_star_plasma_caster: KINDS.plasma_caster,
	blue_star_plasma_caster: KINDS.plasma_caster,
	red_star_plasma_rifle: KINDS.plasma_rifle,
	yellow_star_plasma_rifle: KINDS.plasma_rifle,
	white_star_plasma_rifle: KINDS.plasma_rifle,
	blue_star_plasma_rifle: KINDS.plasma_rifle,
	pulsecaster_rifle: KINDS.pulsecaster_rifle,
	utility_scattergun: KINDS.scattergun,
	snub_scattergun: KINDS.scattergun,
	impact_scattergun: KINDS.scattergun,
	vortex_scattergun: KINDS.scattergun,
	grapeshot_scattergun: KINDS.scattergun,
	tactical_seeker_rifle: KINDS.seeker_rifle,
	advanced_seeker_rifle: KINDS.seeker_rifle,
	elite_seeker_rifle: KINDS.seeker_rifle,
	paragon_seeker_rifle: KINDS.seeker_rifle,
	thunderstrike_sonic_rifle: KINDS.sonic_rifle,
	lfd_sonic_rifle: KINDS.sonic_rifle,
	hfd_sonic_rifle: KINDS.sonic_rifle,
	banshee_sonic_rifle: KINDS.sonic_rifle,
	thunderstrike_streetsweeper: KINDS.streetsweeper,
	lfd_streetsweeper: KINDS.streetsweeper,
	hfd_streetsweeper: KINDS.streetsweeper,
	frostbite_class_zero_rifle: KINDS.zero_rifle,
	hailstorm_class_zero_rifle: KINDS.zero_rifle,
	blizzard_class_zero_rifle: KINDS.zero_rifle,
	avalanche_class_zero_rifle: KINDS.zero_rifle,
	azimuth_artillery_laser: KINDS.artillery_laser,
	corona_artillery_laser: KINDS.artillery_laser,
	aphelion_artillery_laser: KINDS.artillery_laser,
	perihelion_artillery_laser: KINDS.artillery_laser,
	parallax_artillery_laser: KINDS.artillery_laser,
	zenith_artillery_laser: KINDS.artillery_laser,
	tactical_autobeam_artillery: KINDS.autobeam_artillery,
	advanced_autobeam_artillery: KINDS.autobeam_artillery,
	elite_autobeam_artillery: KINDS.autobeam_artillery,
	advanced_crossbolter: KINDS.heavy_crossbolter,
	elite_crossbolter: KINDS.heavy_crossbolter,
	paragon_crossbolter: KINDS.heavy_crossbolter,
	ifrit_class_flamethrower: KINDS.flamethrower,
	salamander_class_flamethrower: KINDS.flamethrower,
	hellhound_class_flamethrower: KINDS.flamethrower,
	firedrake_class_flamethrower: KINDS.flamethrower,
	phoenix_class_flamethrower: KINDS.flamethrower,
	imds_missile_launcher: KINDS.imds_missile_launcher,
	squad_machine_gun: KINDS.machine_gun,
	medium_machine_gun: KINDS.machine_gun,
	heavy_machine_gun: KINDS.machine_gun,
	merc_nil_grenade_launcher: KINDS.nil_grenade_launcher,
	squad_nil_grenade_launcher: KINDS.nil_grenade_launcher,
	red_star_plasma_cannon: KINDS.plasma_cannon,
	yellow_star_plasma_cannon: KINDS.plasma_cannon,
	white_star_plasma_cannon: KINDS.plasma_cannon,
	blue_star_plasma_cannon: KINDS.plasma_cannon,
	light_reaction_cannon: KINDS.reaction_cannon,
	tactical_reaction_cannon: KINDS.reaction_cannon,
	heavy_reaction_cannon: KINDS.reaction_cannon,
	advanced_reaction_cannon: KINDS.reaction_cannon,
	elite_reaction_cannon: KINDS.reaction_cannon,
	paragon_reaction_cannon: KINDS.reaction_cannon,
	thunderstrike_screamer: KINDS.screamer,
	lfd_screamer: KINDS.screamer,
	hfd_screamer: KINDS.screamer,
	static_shock_caster: KINDS.shock_caster,
	aurora_shock_caster: KINDS.shock_caster,
	storm_shock_caster: KINDS.shock_caster,
	tempest_shock_caster: KINDS.shock_caster,
	light_stellar_cannon: KINDS.stellar_cannon,
	heavy_stellar_cannon: KINDS.stellar_cannon,
	tactical_x_gen_gun: KINDS.x_gen_gun,
	advanced_x_gen_gun: KINDS.x_gen_gun,
	elite_x_gen_gun: KINDS.x_gen_gun,
	paragon_x_gen_gun: KINDS.x_gen_gun,
	tactical_zero_cannon: KINDS.zero_cannon,
	advanced_zero_cannon: KINDS.zero_cannon,
	elite_zero_cannon: KINDS.zero_cannon,
	tactical_shirren_eye_rifle: KINDS.shirren_eye_rifle,
	advanced_shirren_eye_rifle: KINDS.shirren_eye_rifle,
	elite_shirren_eye_rifle: KINDS.shirren_eye_rifle,
	paragon_shirren_eye_rifle: KINDS.shirren_eye_rifle,
	warpshot_shirren_eye_rifle: KINDS.shirren_eye_rifle,
	cryo_grenade_1: KINDS.cryo_grenade,
	cryo_grenade_2: KINDS.cryo_grenade,
	cryo_grenade_3: KINDS.cryo_grenade,
	cryo_grenade_4: KINDS.cryo_grenade,
	flash_grenade_1: KINDS.flash_grenade,
	flash_grenade_2: KINDS.flash_grenade,
	flash_grenade_3: KINDS.flash_grenade,
	flash_grenade_4: KINDS.flash_grenade,
	frag_grenade_1: KINDS.frag_grenade,
	frag_grenade_2: KINDS.frag_grenade,
	frag_grenade_3: KINDS.frag_grenade,
	frag_grenade_4: KINDS.frag_grenade,
	frag_grenade_5: KINDS.frag_grenade,
	frag_grenade_6: KINDS.frag_grenade,
	frag_grenade_7: KINDS.frag_grenade,
	frag_grenade_8: KINDS.frag_grenade,
	incendiary_grenade_1: KINDS.incendiary_grenade,
	incendiary_grenade_2: KINDS.incendiary_grenade,
	incendiary_grenade_3: KINDS.incendiary_grenade,
	incendiary_grenade_4: KINDS.incendiary_grenade,
	incendiary_grenade_5: KINDS.incendiary_grenade,
	incendiary_grenade_6: KINDS.incendiary_grenade,
	screamer_grenade_1: KINDS.screamer_grenade,
	screamer_grenade_2: KINDS.screamer_grenade,
	screamer_grenade_3: KINDS.screamer_grenade,
	screamer_grenade_4: KINDS.screamer_grenade,
	shock_grenade_1: KINDS.shock_grenade,
	shock_grenade_2: KINDS.shock_grenade,
	shock_grenade_3: KINDS.shock_grenade,
	shock_grenade_4: KINDS.shock_grenade,
	shock_grenade_5: KINDS.shock_grenade,
	smoke_grenade: KINDS.smoke_grenade,
	stickybomb_grenade_1: KINDS.stickybomb_grenade,
	stickybomb_grenade_2: KINDS.stickybomb_grenade,
	stickybomb_grenade_3: KINDS.stickybomb_grenade,
	bow: KINDS.bow,
	carbonedge_shuriken: KINDS.carbonedge_shuriken,
	nyfiber_net: KINDS.nyfiber_net,
	arrows: KINDS.arrows,
	darts: KINDS.darts,
	flares: KINDS.flares,
	battery: KINDS.battery,
	high_capacity_battery: KINDS.high_capacity_battery,
	super_capacity_battery: KINDS.high_capacity_battery,
	ultra_capacity_battery: KINDS.high_capacity_battery,
	small_arm_rounds: KINDS.small_arm_rounds,
	longarm_and_sniper_rounds: KINDS.longarm_and_sniper_rounds,
	heavy_rounds: KINDS.heavy_rounds,
	explosive_heavy_rounds: KINDS.explosive_heavy_rounds,
	scattergun_shells: KINDS.scattergun_shells,
	explosive_scattergun_shells: KINDS.explosive_scattergun_shells,
	mini_rockets: KINDS.mini_rockets,
	tactical_missile: KINDS.missile,
	advanced_missile: KINDS.missile,
	grenade_arrows_2: KINDS.grenade_arrows,
	grenade_arrows_3: KINDS.grenade_arrows,
	grenade_arrows_4: KINDS.grenade_arrows,
	second_skin: KINDS.second_skin,
	estex_suit_1: KINDS.estex_suit,
	estex_suit_2: KINDS.estex_suit,
	estex_suit_3: KINDS.estex_suit,
	estex_suit_4: KINDS.estex_suit,
	flight_suit_stationwear: KINDS.stationwear,
	casual_stationwear: KINDS.stationwear,
	business_stationwear: KINDS.stationwear,
	elite_stationwear: KINDS.stationwear,
	kasatha_microcord_1: KINDS.kasatha_microcord,
	kasatha_microcord_2: KINDS.kasatha_microcord,
	kasatha_microcord_3: KINDS.kasatha_microcord,
	kasatha_microcord_4: KINDS.kasatha_microcord,
	freebooter_armor_1: KINDS.freebooter_armor,
	freebooter_armor_2: KINDS.freebooter_armor,
	freebooter_armor_3: KINDS.freebooter_armor,
	freebooter_armor_4: KINDS.freebooter_armor,
	freebooter_armor_5: KINDS.freebooter_armor,
	graphite_carbon_skin: KINDS.carbon_skin,
	white_carbon_carbon_skin: KINDS.carbon_skin,
	diamond_carbon_skin: KINDS.carbon_skin,
	nanotube_carbon_skin: KINDS.carbon_skin,
	basic_lashunta_tempweave: KINDS.lashunta_tempweave,
	advanced_lashunta_tempweave: KINDS.lashunta_tempweave,
	defrex_hide: KINDS.defrex_hide,
	d_suit_1: KINDS.d_suit,
	d_suit_2: KINDS.d_suit,
	d_suit_3: KINDS.d_suit,
	d_suit_4: KINDS.d_suit,
	d_suit_5: KINDS.d_suit,
	d_suit_6: KINDS.d_suit,
	ysoki_refractor_suit: KINDS.ysoki_refractor_suit,
	silver_abadarcorp_travel_suit: KINDS.abadarcorp_travel_suit,
	gold_abadarcorp_travel_suit: KINDS.abadarcorp_travel_suit,
	platinum_abadarcorp_travel_suit: KINDS.abadarcorp_travel_suit,
	squad_hardlight_series: KINDS.hardlight_series,
	elite_hardlight_series: KINDS.hardlight_series,
	specialist_hardlight_series: KINDS.hardlight_series,
	boardroom_attire: KINDS.boardroom_attire,
	ready_to_wear_echelon_fashion: KINDS.echelon_fashion,
	bespoke_echelon_fashion: KINDS.echelon_fashion,
	swarmsuit: KINDS.swarmsuit,
	shotalashu_armor: KINDS.shotalashu_armor,
	troop_ceremonial_plate: KINDS.ceremonial_plate,
	officer_ceremonial_plate: KINDS.ceremonial_plate,
	commander_ceremonial_plate: KINDS.ceremonial_plate,
	golemforged_plating_1: KINDS.golemforged_plating,
	golemforged_plating_2: KINDS.golemforged_plating,
	golemforged_plating_3: KINDS.golemforged_plating,
	golemforged_plating_4: KINDS.golemforged_plating,
	golemforged_plating_5: KINDS.golemforged_plating,
	lashunta_ringwear_1: KINDS.lashunta_ringwear,
	lashunta_ringwear_2: KINDS.lashunta_ringwear,
	lashunta_ringwear_3: KINDS.lashunta_ringwear,
	lashunta_ringwear_4: KINDS.lashunta_ringwear,
	lashunta_ringwear_5: KINDS.lashunta_ringwear,
	hidden_soldier_armor: KINDS.hidden_soldier_armor,
	basic_iridishell: KINDS.iridishell,
	advanced_iridishell: KINDS.iridishell,
	superior_iridishell: KINDS.iridishell,
	thinplate: KINDS.thinplate,
	squad_defiance_series: KINDS.defiance_series,
	elite_defiance_series: KINDS.defiance_series,
	specialist_defiance_series: KINDS.defiance_series,
	vesk_overplate_1: KINDS.vesk_overplate,
	vesk_overplate_2: KINDS.vesk_overplate,
	vesk_overplate_3: KINDS.vesk_overplate,
	vesk_overplate_4: KINDS.vesk_overplate,
	vesk_overplate_5: KINDS.vesk_overplate,
	pinion_skyfire_armor: KINDS.skyfire_armor,
	exident_skyfire_armor: KINDS.skyfire_armor,
	vesk_monolith_1: KINDS.vesk_monolith,
	vesk_monolith_2: KINDS.vesk_monolith,
	vesk_monolith_3: KINDS.vesk_monolith,
	squad_aegis_series: KINDS.aegis_series,
	elite_aegis_series: KINDS.aegis_series,
	specialist_aegis_series: KINDS.aegis_series,
	enginerunner: KINDS.enginerunner,
	steelbones: KINDS.steelbones,
	vitrum_plate: KINDS.vitrum_plate,
	voidshield_armor: KINDS.voidshield_armor
};

/**
 * Each default item's description, by the item's key, shown in the item editor, when choosing items, on a
 * character's sheet and on the Audit tab
 */
export const SF1E_DEFAULT_ITEM_DESCRIPTIONS: Record<string, MessageDescriptor> = Object.fromEntries(Object.entries(SF1E_DEFAULT_ITEMS)
	.map(([key, item]) => [key, item.description]));

/**
 * Each default item's category and types, which the migrations in server/drizzle give it
 */
export const SF1E_DEFAULT_ITEM_KINDS: Record<string, { category: Sf1eItemCategory; types: readonly Sf1eItemType[] }> = Object.fromEntries(Object.entries(SF1E_DEFAULT_ITEMS)
	.map(([key, item]) => [key, {
		category: item.category,
		types: item.types
	}]));
