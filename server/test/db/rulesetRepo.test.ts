import assert from 'assert';

import { DEFAULT_PF1E_SETTINGS, type Pf1eSettings } from '@multiverse-kiln/shared';

import { findPf1eSettings, savePf1eSettings } from '../../src/db/rulesetRepo.js';
import { deleteUniverse } from '../../src/db/universeRepo.js';
import { addUniverse } from './fixtures.js';

const pointBuy: Pf1eSettings = {
	statMethod: 'point_buy_high_fantasy',
	customPointBuyBudget: 40,
	needsSleep: true,
	coinsHaveWeight: false,
	tracksAmmo: true
};

describe('rulesetRepo', () =>
{
	it('gives the defaults to a universe that has never saved settings', async () =>
	{
		assert.deepStrictEqual(await findPf1eSettings(await addUniverse()), DEFAULT_PF1E_SETTINGS);
	});

	it('saves settings, and replaces them when saved again', async () =>
	{
		const universeId = await addUniverse();

		await savePf1eSettings(universeId, pointBuy);
		assert.deepStrictEqual(await findPf1eSettings(universeId), pointBuy);

		await savePf1eSettings(universeId, DEFAULT_PF1E_SETTINGS);
		assert.deepStrictEqual(await findPf1eSettings(universeId), DEFAULT_PF1E_SETTINGS);
	});

	it('keeps each universe\'s settings apart, and deletes them with the universe', async () =>
	{
		const universeId = await addUniverse('First');
		const otherId = await addUniverse('Second');

		await savePf1eSettings(universeId, pointBuy);
		assert.deepStrictEqual(await findPf1eSettings(otherId), DEFAULT_PF1E_SETTINGS);

		await deleteUniverse(universeId);
		assert.deepStrictEqual(await findPf1eSettings(universeId), DEFAULT_PF1E_SETTINGS);
	});

	it('refuses a custom budget the database doesn\'t allow', async () =>
	{
		await assert.rejects(savePf1eSettings(await addUniverse(), {
			...pointBuy,
			customPointBuyBudget: 500
		}));
	});
});
