/**
 * Each ruleset's default races and classes, which the migrations in server/drizzle add to the database
 */
import type { MessageDescriptor } from './localization.js';
import { PF1E_CLASS_NAMES } from './rulesets/pf1e/classes.js';
import { PF1E_RACE_NAMES } from './rulesets/pf1e/races.js';
import type { Ruleset } from './universes.js';

/**
 * Each default race's name, by ruleset and the race's key. The database stores each name's English text
 */
export const DEFAULT_RACE_NAMES: Record<Ruleset, Record<string, MessageDescriptor>> = {
	pf1e: PF1E_RACE_NAMES
};

/**
 * Each default class's name, by ruleset and the class's key. The database stores each name's English text
 */
export const DEFAULT_CLASS_NAMES: Record<Ruleset, Record<string, MessageDescriptor>> = {
	pf1e: PF1E_CLASS_NAMES
};
