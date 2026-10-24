/**
 * How a group's difficulty level changes its mobs (see STRUCTURE-OVERVIEW.md, Difficulty). A level's
 * mob scale is a percentage: 50 makes mobs 50% harder, -50 makes them 50% easier
 *
 * Nothing calls these yet: they are for when mobs have hit points and attacks
 */
import { MIN_SCALED_HIT_CHANCE } from '@multiverse-kiln/shared';

/**
 * Who makes an attack: a mob, or one of the group's characters
 */
export type Attacker = 'mob' | 'character';

/**
 * How many times stronger mobs are at a mob scale
 *
 * @param mobScale The difficulty level's mob scale, as a percentage
 * @return The multiplier: 1.5 at 50, 0.5 at -50, and 0 or less from -100 down
 */
function mobMultiplier(mobScale: number): number
{
	return((100 + mobScale) / 100);
}

/**
 * A mob's hit points at a difficulty level
 *
 * @param hitPoints The mob's hit points as its universe made it
 * @param mobScale The difficulty level's mob scale, as a percentage
 * @return The hit points, rounded and never below 1
 */
export function scaleMobHitPoints(hitPoints: number, mobScale: number): number
{
	return(Math.max(1, Math.round(hitPoints * mobMultiplier(mobScale))));
}

/**
 * An attack's chance to hit at a difficulty level. Harder levels make mobs hit more often and be hit
 * less often, and easier levels the reverse. A chance of at least MIN_SCALED_HIT_CHANCE never drops
 * below it, and no chance goes above 100
 *
 * @param chance The chance to hit as the rules give it, as a percentage
 * @param mobScale The difficulty level's mob scale, as a percentage
 * @param attacker Who is attacking: a mob, or a character attacking a mob
 * @return The chance to hit, as a percentage from 0 to 100
 */
export function scaleHitChance(chance: number, mobScale: number, attacker: Attacker): number
{
	const multiplier = mobMultiplier(mobScale);
	let scaled: number;

	if (chance <= 0)
	{
		scaled = 0;
	}
	else if (attacker === 'mob')
	{
		scaled = (chance * multiplier);
	}
	// Mobs at -100% or easier have nothing to resist with, so every attack that could hit does
	else if (multiplier <= 0)
	{
		scaled = 100;
	}
	else
	{
		scaled = (chance / multiplier);
	}

	scaled = Math.min(100, Math.max(0, scaled));

	if (chance >= MIN_SCALED_HIT_CHANCE)
	{
		return(Math.max(MIN_SCALED_HIT_CHANCE, scaled));
	}

	return(scaled);
}
