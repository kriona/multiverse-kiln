/**
 * How each universe plays under its ruleset: the only module that reads or writes the pf1e_settings table
 */
import { eq } from 'drizzle-orm';
import { DEFAULT_PF1E_SETTINGS, type Pf1eSettings } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { pf1eSettings } from './schema.js';

/**
 * A Pathfinder 1E universe's settings
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return Its settings, or DEFAULT_PF1E_SETTINGS when it has never saved any
 */
export async function findPf1eSettings(universeId: string, executor: Executor = db): Promise<Pf1eSettings>
{
	const [row] = await executor
		.select({
			statMethod: pf1eSettings.statMethod,
			customPointBuyBudget: pf1eSettings.customPointBuyBudget,
			needsSleep: pf1eSettings.needsSleep,
			coinsHaveWeight: pf1eSettings.coinsHaveWeight,
			tracksAmmo: pf1eSettings.tracksAmmo
		})
		.from(pf1eSettings)
		.where(eq(pf1eSettings.universeId, universeId))
		.limit(1);

	return((row ?? { ...DEFAULT_PF1E_SETTINGS }));
}

/**
 * Stores a Pathfinder 1E universe's settings, replacing any it had
 *
 * @param universeId The universe's ID
 * @param settings The settings
 * @param executor The database, or a transaction
 */
export async function savePf1eSettings(universeId: string, settings: Pf1eSettings, executor: Executor = db): Promise<void>
{
	await executor
		.insert(pf1eSettings)
		.values({
			universeId,
			...settings
		})
		.onConflictDoUpdate({
			target: pf1eSettings.universeId,
			set: settings
		});
}
