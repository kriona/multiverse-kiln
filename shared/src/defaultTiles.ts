/**
 * The tiles each ruleset comes with, which the migrations in server/drizzle add to the database
 */
import { defineMessages, type MessageDescriptor } from './localization.js';
import type { Ruleset } from './universes.js';

/**
 * Each default tile's name, by ruleset and the tile's key. The database stores each name's English text
 */
export const DEFAULT_TILE_NAMES: Record<Ruleset, Record<string, MessageDescriptor>> = {
	pf1e: defineMessages({
		grass: {
			id: 'tile.pf1e.grass',
			defaultMessage: 'Grass',
			description: 'Name of a map tile: open grassland'
		},
		forest: {
			id: 'tile.pf1e.forest',
			defaultMessage: 'Forest',
			description: 'Name of a map tile: woodland, which is slow to cross and hard to see through'
		},
		desert: {
			id: 'tile.pf1e.desert',
			defaultMessage: 'Desert',
			description: 'Name of a map tile: sandy desert, which is slow to cross'
		},
		mountains: {
			id: 'tile.pf1e.mountains',
			defaultMessage: 'Mountains',
			description: 'Name of a map tile: mountains, which can\'t be crossed or seen past'
		},
		water: {
			id: 'tile.pf1e.water',
			defaultMessage: 'Water',
			description: 'Name of a map tile: deep water, which can\'t be walked into'
		},
		wood_floor: {
			id: 'tile.pf1e.wood_floor',
			defaultMessage: 'Wood Floor',
			description: 'Name of a map tile: the wooden floor of a building'
		}
	}),
	sf1e: defineMessages({
		grass: {
			id: 'tile.sf1e.grass',
			defaultMessage: 'Grass',
			description: 'Name of a map tile in a science fantasy world: open grassland'
		},
		sand: {
			id: 'tile.sf1e.sand',
			defaultMessage: 'Sand',
			description: 'Name of a map tile in a science fantasy world: loose sand, which is slow to cross'
		},
		rock: {
			id: 'tile.sf1e.rock',
			defaultMessage: 'Rock',
			description: 'Name of a map tile in a science fantasy world: bare rock cliffs, which can\'t be crossed or seen past'
		},
		water: {
			id: 'tile.sf1e.water',
			defaultMessage: 'Water',
			description: 'Name of a map tile in a science fantasy world: deep water, which can\'t be walked into'
		},
		metal_floor: {
			id: 'tile.sf1e.metal_floor',
			defaultMessage: 'Metal Floor',
			description: 'Name of a map tile in a science fantasy world: the metal deck of a starship or station'
		},
		bulkhead: {
			id: 'tile.sf1e.bulkhead',
			defaultMessage: 'Bulkhead',
			description: 'Name of a map tile in a science fantasy world: a metal wall inside a starship or station, which can\'t be crossed or seen past'
		}
	})
};
