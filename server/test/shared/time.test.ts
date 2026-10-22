import assert from 'assert';
import { DAWN_SECONDS, DAY_SECONDS, daylight, DUSK_SECONDS, faerieDistance, lobbyAreaTime, MIDNIGHT_SECONDS, NOON_SECONDS, partOfDay, periodOfDay, resolveAreaTime, secondOfDay, type MapBounds } from '@multiverse-kiln/shared';

const HOUR = 60 * 60;

/**
 * A map 101 cells across and 51 down, centered on 0, 0
 */
const bounds: MapBounds = {
	minColumn: -50,
	minRow: -25,
	maxColumn: 50,
	maxRow: 25
};

const center = { column: 0, row: 0 };

describe('time (shared)', () =>
{
	describe('resolveAreaTime', () =>
	{
		const universe = { passageOfTime: 'always_noon' as const, faerieMorning: null };

		it('uses the area\'s own setting', () =>
		{
			assert.deepStrictEqual(resolveAreaTime([{ passageOfTime: 'always_dusk', faerieMorning: null }], universe), { passage: 'always_dusk' });
		});

		it('follows inherit up to the first parent with a setting', () =>
		{
			const chain = [
				{ passageOfTime: 'inherit' as const, faerieMorning: null },
				{ passageOfTime: 'faerie' as const, faerieMorning: 'west' as const },
				{ passageOfTime: 'always_dawn' as const, faerieMorning: null }
			];

			assert.deepStrictEqual(resolveAreaTime(chain, universe), { passage: 'faerie', morning: 'west' });
		});

		it('uses the universe\'s when every area inherits', () =>
		{
			assert.deepStrictEqual(resolveAreaTime([{ passageOfTime: 'inherit', faerieMorning: null }], universe), { passage: 'always_noon' });
		});
	});

	describe('lobbyAreaTime', () =>
	{
		it('keeps the day length for real time', () =>
		{
			assert.deepStrictEqual(lobbyAreaTime({ passageOfTime: 'real_time', faerieMorning: null, dayHours: 6 }), { passage: 'real_time', dayHours: 6 });
		});

		it('passes other settings through', () =>
		{
			assert.deepStrictEqual(lobbyAreaTime({ passageOfTime: 'faerie', faerieMorning: 'horizon', dayHours: 24 }), { passage: 'faerie', morning: 'horizon' });
		});
	});

	describe('secondOfDay', () =>
	{
		it('gives each fixed time', () =>
		{
			assert.strictEqual(secondOfDay({ passage: 'always_dawn' }, 123, 0, center, bounds), DAWN_SECONDS);
			assert.strictEqual(secondOfDay({ passage: 'always_noon' }, 123, 0, center, bounds), NOON_SECONDS);
			assert.strictEqual(secondOfDay({ passage: 'always_dusk' }, 123, 0, center, bounds), DUSK_SECONDS);
			assert.strictEqual(secondOfDay({ passage: 'always_midnight' }, 123, 0, center, bounds), MIDNIGHT_SECONDS);
		});

		it('follows the clock when time flows normally, wrapping each day', () =>
		{
			assert.strictEqual(secondOfDay({ passage: 'flows_normally' }, (3 * DAY_SECONDS) + (10 * HOUR), 0, center, bounds), 10 * HOUR);
		});

		it('runs real time from the Unix epoch with the lobby\'s day length', () =>
		{
			const time = { passage: 'real_time' as const, dayHours: 2 };

			assert.strictEqual(secondOfDay(time, 0, 0, center, bounds), 0);

			// Half an hour into a two-hour day is a quarter of the way through it: 6 in the morning
			assert.strictEqual(secondOfDay(time, 0, (5 * 2 * HOUR * 1000) + (30 * 60 * 1000), center, bounds), 6 * HOUR);
		});

		it('runs a 24-hour real day at the time of day in UTC', () =>
		{
			const time = { passage: 'real_time' as const, dayHours: 24 };

			assert.strictEqual(secondOfDay(time, 0, Date.UTC(2026, 9, 22, 15, 0, 0), center, bounds), 15 * HOUR);
		});

		it('makes faerie time sunrise where morning is and midnight furthest from it', () =>
		{
			const time = { passage: 'faerie' as const, morning: 'west' as const };

			assert.strictEqual(secondOfDay(time, 0, 0, { column: -50, row: 0 }, bounds), DAWN_SECONDS);
			assert.strictEqual(secondOfDay(time, 0, 0, { column: 50, row: 0 }, bounds), 0);
			assert.strictEqual(secondOfDay(time, 0, 0, center, bounds), DAWN_SECONDS + (9 * HOUR));
		});

		it('ignores the clock in faerie time', () =>
		{
			const time = { passage: 'faerie' as const, morning: 'north' as const };

			assert.strictEqual(secondOfDay(time, 5 * HOUR, 0, center, bounds), secondOfDay(time, 17 * HOUR, 0, center, bounds));
		});
	});

	describe('faerieDistance', () =>
	{
		it('measures from each edge', () =>
		{
			assert.strictEqual(faerieDistance('north', { column: 0, row: -25 }, bounds), 0);
			assert.strictEqual(faerieDistance('south', { column: 0, row: -25 }, bounds), 1);
			assert.strictEqual(faerieDistance('east', { column: 50, row: 7 }, bounds), 0);
			assert.strictEqual(faerieDistance('west', { column: 50, row: 7 }, bounds), 1);
		});

		it('measures from each corner', () =>
		{
			assert.strictEqual(faerieDistance('northwest', { column: -50, row: -25 }, bounds), 0);
			assert.strictEqual(faerieDistance('northwest', { column: 50, row: 25 }, bounds), 1);
			assert.strictEqual(faerieDistance('northeast', { column: 50, row: -25 }, bounds), 0);
			assert.strictEqual(faerieDistance('southeast', { column: 50, row: 25 }, bounds), 0);
			assert.strictEqual(faerieDistance('southwest', { column: -50, row: 25 }, bounds), 0);
			assert.strictEqual(faerieDistance('southwest', center, bounds), 0.5);
		});

		it('puts morning in the center, or at every edge for horizon', () =>
		{
			assert.strictEqual(faerieDistance('center', center, bounds), 0);
			assert.strictEqual(faerieDistance('center', { column: 50, row: 0 }, bounds), 1);
			assert.strictEqual(faerieDistance('center', { column: 0, row: -25 }, bounds), 1);
			assert.strictEqual(faerieDistance('horizon', center, bounds), 1);
			assert.strictEqual(faerieDistance('horizon', { column: 0, row: 25 }, bounds), 0);
		});

		it('treats a map one cell across as its middle', () =>
		{
			assert.strictEqual(faerieDistance('west', { column: 0, row: 0 }, { minColumn: 0, minRow: 0, maxColumn: 0, maxRow: 0 }), 0.5);
		});
	});

	describe('daylight', () =>
	{
		it('is dark at night and full in the day', () =>
		{
			assert.strictEqual(daylight(0), 0);
			assert.strictEqual(daylight(4 * HOUR), 0);
			assert.strictEqual(daylight(NOON_SECONDS), 1);
			assert.strictEqual(daylight(22 * HOUR), 0);
		});

		it('is half light at dawn and dusk, rising and falling around them', () =>
		{
			assert.strictEqual(daylight(DAWN_SECONDS), 0.5);
			assert.strictEqual(daylight(DUSK_SECONDS), 0.5);
			assert.ok(daylight(DAWN_SECONDS + (HOUR / 2)) > 0.5);
			assert.ok(daylight(DUSK_SECONDS + (HOUR / 2)) < 0.5);
			assert.strictEqual(daylight(7 * HOUR), 1);
			assert.strictEqual(daylight(19 * HOUR), 0);
		});
	});

	describe('partOfDay', () =>
	{
		it('names each part of the day', () =>
		{
			assert.strictEqual(partOfDay(MIDNIGHT_SECONDS), 'night');
			assert.strictEqual(partOfDay(DAWN_SECONDS), 'dawn');
			assert.strictEqual(partOfDay(NOON_SECONDS), 'day');
			assert.strictEqual(partOfDay(DUSK_SECONDS), 'dusk');
			assert.strictEqual(partOfDay(23 * HOUR), 'night');
			assert.strictEqual(partOfDay(DAY_SECONDS + NOON_SECONDS), 'day');
		});
	});

	describe('periodOfDay', () =>
	{
		it('names each period of the day', () =>
		{
			const expected: [number, string][] = [
				[2 * HOUR, 'night'],
				[4.5 * HOUR, 'pre_dawn'],
				[DAWN_SECONDS, 'dawn'],
				[8 * HOUR, 'early_morning'],
				[10 * HOUR, 'morning'],
				[11 * HOUR, 'late_morning'],
				[15 * HOUR, 'afternoon'],
				[13 * HOUR, 'early_afternoon'],
				[16.5 * HOUR, 'late_afternoon'],
				[DUSK_SECONDS, 'evening'],
				[20 * HOUR, 'late_evening'],
				[22 * HOUR, 'night']
			];

			for (const [seconds, period] of expected)
			{
				assert.strictEqual(periodOfDay(seconds), period, `${seconds / HOUR}:00`);
			}
		});

		it('makes noon and midnight the quarter hour either side of them', () =>
		{
			const quarter = 15 * 60;

			assert.strictEqual(periodOfDay(NOON_SECONDS - quarter - 1), 'late_morning');
			assert.strictEqual(periodOfDay(NOON_SECONDS - quarter), 'noon');
			assert.strictEqual(periodOfDay(NOON_SECONDS + quarter - 1), 'noon');
			assert.strictEqual(periodOfDay(NOON_SECONDS + quarter), 'early_afternoon');
			assert.strictEqual(periodOfDay(DAY_SECONDS - quarter - 1), 'night');
			assert.strictEqual(periodOfDay(DAY_SECONDS - quarter), 'midnight');
			assert.strictEqual(periodOfDay(MIDNIGHT_SECONDS), 'midnight');
			assert.strictEqual(periodOfDay(quarter - 1), 'midnight');
			assert.strictEqual(periodOfDay(quarter), 'night');
			assert.strictEqual(periodOfDay(DAY_SECONDS + NOON_SECONDS), 'noon');
		});
	});
});
