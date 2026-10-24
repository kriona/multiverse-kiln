import { DIFFICULTY_LEVEL_NAMES, type DifficultyLevel } from '@multiverse-kiln/shared';

import { t } from '../localization';

/**
 * A difficulty level's name as the player reads it: the universe's name for it, or a default level's name
 * in the player's language
 *
 * @param level The level
 * @return The name, or the key for a default level with no name
 */
export function difficultyName(level: Pick<DifficultyLevel, 'key' | 'name'>): string
{
	if (level.name !== null)
	{
		return(level.name);
	}

	const message = ((level.key === null) ? undefined : DIFFICULTY_LEVEL_NAMES[level.key]);

	return(((message === undefined) ? (level.key ?? '') : t(message)));
}

/**
 * How a difficulty level changes mobs, in a few words
 *
 * @param mobScale The level's mob scale, as a percentage
 * @return The summary, e.g. "Mobs 50% harder"
 */
export function describeMobScale(mobScale: number): string
{
	return(t({
		id: 'difficulty.mobScale',
		defaultMessage: '{direction, select, easier {Mobs {percent, number, ::percent} easier} harder {Mobs {percent, number, ::percent} harder} other {Mobs at default strength}}',
		description: 'Summary of how a difficulty level changes mobs (monsters and enemies): their hit points and how often they hit and are hit. {percent} is how much, e.g. 50%; the last choice is for a level that leaves them as they are'
	}, {
		direction: ((mobScale < 0) ? 'easier' : ((mobScale > 0) ? 'harder' : 'unchanged')),
		percent: (Math.abs(mobScale) / 100)
	}));
}
