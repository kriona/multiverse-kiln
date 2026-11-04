import assert from 'assert';
import { barredOptionsOf, characterBar, NOTHING_BARRED } from '@multiverse-kiln/shared';

describe('characterBar', () =>
{
	const barred = barredOptionsOf([
		{ id: 1, enabled: true, keepPlaying: false },
		{ id: 2, enabled: false, keepPlaying: true },
		{ id: 3, enabled: false, keepPlaying: false }
	], [
		{ id: 10, enabled: false, keepPlaying: false }
	]);

	it('bars only the races and classes disabled without letting their characters keep playing', () =>
	{
		assert.deepStrictEqual([...barred.raceIds], [3]);
		assert.deepStrictEqual([...barred.classIds], [10]);
	});

	it('says which bars a character, the race before the class', () =>
	{
		assert.strictEqual(characterBar({ raceId: 3, classId: 10 }, barred), 'race');
		assert.strictEqual(characterBar({ raceId: 2, classId: 10 }, barred), 'class');
		assert.strictEqual(characterBar({ raceId: 1, classId: 11 }, barred), null);
	});

	it('bars nobody when nothing is barred', () =>
	{
		assert.strictEqual(characterBar({ raceId: 3, classId: 10 }, NOTHING_BARRED), null);
	});
});
