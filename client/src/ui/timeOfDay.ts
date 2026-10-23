import { periodOfDay, type DisplayTime } from '@multiverse-kiln/shared';

import { formatTimeOfDay, t } from '../localization';

/**
 * A time of day in the game the way the universe shows it: the time on the clock, to the second, or a
 * word for the time of day, such as late morning
 *
 * @param secondOfDay Seconds since midnight (see secondOfDay in /shared)
 * @param displayTime How the universe shows the time of day
 * @return The time in the player's language, or undefined when the universe doesn't show it
 */
export function describeTimeOfDay(secondOfDay: number, displayTime: DisplayTime): string | undefined
{
	switch (displayTime)
	{
		case 'precise':
			return(formatTimeOfDay(secondOfDay));

		case 'rough':
			return(t({
				id: 'time.periodOfDay',
				defaultMessage: '{period, select, midnight {midnight} pre_dawn {pre-dawn} dawn {dawn} early_morning {early morning} morning {morning} late_morning {late morning} noon {noon} early_afternoon {early afternoon} afternoon {afternoon} late_afternoon {late afternoon} evening {evening} late_evening {late evening} other {night}}',
				description: 'A word for the time of day in the game, shown in place of the time on the clock, e.g. "late morning". It follows "Day 1, " in the group\'s toolbar and "It is " when the player asks where they are'
			}, {
				period: periodOfDay(secondOfDay)
			}));

		case 'none':
			return(undefined);
	}
}
