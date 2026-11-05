/**
 * How each universe plays under its ruleset: the only module that reads or writes the pf1e_settings and
 * sf1e_settings tables
 */
import { DEFAULT_PF1E_SETTINGS, DEFAULT_SF1E_SETTINGS, type Pf1eSettings, type Ruleset, type RulesetSettings, type Sf1eSettings } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { pf1eSettings, sf1eSettings } from './schema.js';
import { inVersion, type UniverseVersion } from './universeVersions.js';

/**
 * A universe's settings under its ruleset
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return Its settings, or the ruleset's defaults when it has never saved any
 */
export async function loadRulesetSettings(version: UniverseVersion, ruleset: Ruleset, executor: Executor = db): Promise<RulesetSettings>
{
	switch (ruleset)
	{
		case 'pf1e':
			return({
				ruleset,
				settings: await findPf1eSettings(version, executor)
			});

		case 'sf1e':
			return({
				ruleset,
				settings: await findSf1eSettings(version, executor)
			});
	}
}

/**
 * Stores a universe's settings under its ruleset, replacing any it had
 *
 * @param version The universe's live version or draft
 * @param ruleset The settings, which must be for the universe's ruleset
 * @param executor The database, or a transaction
 */
export async function storeRulesetSettings(version: UniverseVersion, ruleset: RulesetSettings, executor: Executor = db): Promise<void>
{
	switch (ruleset.ruleset)
	{
		case 'pf1e':
			await savePf1eSettings(version, ruleset.settings, executor);
			break;

		case 'sf1e':
			await saveSf1eSettings(version, ruleset.settings, executor);
			break;
	}
}

/**
 * A Pathfinder 1E universe's settings
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return Its settings, or DEFAULT_PF1E_SETTINGS when it has never saved any
 */
export async function findPf1eSettings(version: UniverseVersion, executor: Executor = db): Promise<Pf1eSettings>
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
		.where(inVersion(pf1eSettings, version))
		.limit(1);

	return((row ?? { ...DEFAULT_PF1E_SETTINGS }));
}

/**
 * Stores a Pathfinder 1E universe's settings, replacing any it had
 *
 * @param version The universe's live version or draft
 * @param settings The settings
 * @param executor The database, or a transaction
 */
export async function savePf1eSettings(version: UniverseVersion, settings: Pf1eSettings, executor: Executor = db): Promise<void>
{
	await executor
		.insert(pf1eSettings)
		.values({
			universeId: version.universeId,
			draft: version.draft,
			...settings
		})
		.onConflictDoUpdate({
			target: [pf1eSettings.universeId, pf1eSettings.draft],
			set: settings
		});
}

/**
 * A Starfinder 1E universe's settings
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return Its settings, or DEFAULT_SF1E_SETTINGS when it has never saved any
 */
export async function findSf1eSettings(version: UniverseVersion, executor: Executor = db): Promise<Sf1eSettings>
{
	const [row] = await executor
		.select({
			abilityPoints: sf1eSettings.abilityPoints,
			needsSleep: sf1eSettings.needsSleep,
			tracksAmmo: sf1eSettings.tracksAmmo
		})
		.from(sf1eSettings)
		.where(inVersion(sf1eSettings, version))
		.limit(1);

	return((row ?? { ...DEFAULT_SF1E_SETTINGS }));
}

/**
 * Stores a Starfinder 1E universe's settings, replacing any it had
 *
 * @param version The universe's live version or draft
 * @param settings The settings
 * @param executor The database, or a transaction
 */
export async function saveSf1eSettings(version: UniverseVersion, settings: Sf1eSettings, executor: Executor = db): Promise<void>
{
	await executor
		.insert(sf1eSettings)
		.values({
			universeId: version.universeId,
			draft: version.draft,
			...settings
		})
		.onConflictDoUpdate({
			target: [sf1eSettings.universeId, sf1eSettings.draft],
			set: settings
		});
}
