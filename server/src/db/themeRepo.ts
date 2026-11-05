/**
 * Themes: the only module that reads or writes the themes and sf1e_themes tables
 *
 * Only Starfinder 1E has themes (rulesetHasThemes()), so every theme's rules are in sf1e_themes
 */
import { and, asc, count, eq, isNull, or, type SQL } from 'drizzle-orm';
import type { EditorTheme, Ruleset, ThemeSettings } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { sf1eThemes, themes } from './schema.js';
import { inVersion, type UniverseVersion } from './universeVersions.js';

/**
 * The settings of a theme a universe added, which always has a name of its own
 */
export type CustomThemeSettings = ThemeSettings & { name: string };

/**
 * Whether a theme ID names one of a ruleset's default themes or one a universe added
 */
export type ThemeKind = 'default' | 'custom';

/**
 * Matches the rows of themes a version of a universe can see: its ruleset's default themes, and the
 * version's own themes and edited copies
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @return The condition
 */
function usableThemes(version: UniverseVersion, ruleset: Ruleset): SQL | undefined
{
	return(and(
		eq(themes.ruleset, ruleset),
		or(
			isNull(themes.universeId),
			inVersion(themes, version)
		)
	));
}

/**
 * Every theme a universe can use, as the editor lists them: with whether each theme is custom or
 * edited, and a default theme's key in place of a name it kept
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param executor The database, or a transaction
 * @return The themes, by ID; none for a ruleset without themes
 */
export async function loadEditorThemes(version: UniverseVersion, ruleset: Ruleset, executor: Executor = db): Promise<EditorTheme[]>
{
	const rows = await executor
		.select({
			id: themes.id,
			universeId: themes.universeId,
			overridesThemeId: themes.overridesThemeId,
			key: themes.key,
			name: themes.name,
			enabled: themes.enabled,
			ability: sf1eThemes.ability
		})
		.from(themes)
		.innerJoin(sf1eThemes, eq(sf1eThemes.themeId, themes.id))
		.where(usableThemes(version, ruleset))
		.orderBy(asc(themes.id));
	const copies = new Map(rows
		.filter((row) => (row.overridesThemeId !== null))
		.map((row) => [row.overridesThemeId, row]));

	return(rows
		.filter((row) => (row.overridesThemeId === null))
		.map((row) =>
		{
			const copy = ((row.universeId === null) ? copies.get(row.id) : undefined);
			const settings = (copy ?? row);
			const custom = (row.universeId !== null);

			return({
				id: row.id,
				key: (custom ? null : row.key),
				name: (custom ? row.name : (copy?.name ?? null)),
				enabled: settings.enabled,
				rules: {
					ability: settings.ability
				},
				custom,
				edited: (copy !== undefined)
			});
		}));
}

/**
 * Whether a theme ID is one of a ruleset's default themes or one of a version's own themes
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param themeId The theme's ID
 * @param executor The database, or a transaction
 * @return The kind of theme, or undefined when the version can't use a theme with that ID (an edited
 * copy's own ID included)
 */
export async function findThemeKind(version: UniverseVersion, ruleset: Ruleset, themeId: number, executor: Executor = db): Promise<ThemeKind | undefined>
{
	const [row] = await executor
		.select({
			universeId: themes.universeId
		})
		.from(themes)
		.where(and(
			eq(themes.id, themeId),
			isNull(themes.overridesThemeId),
			usableThemes(version, ruleset)
		))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return(((row.universeId === null) ? 'default' : 'custom'));
}

/**
 * How many themes a version of a universe has added, not counting its edited copies of default themes
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The number of themes
 */
export async function countCustomThemes(version: UniverseVersion, executor: Executor = db): Promise<number>
{
	const [row] = await executor
		.select({
			total: count()
		})
		.from(themes)
		.where(and(
			inVersion(themes, version),
			isNull(themes.overridesThemeId)
		));

	return(row.total);
}

/**
 * Adds a theme to a version of a universe. Call it inside a transaction, so the theme is never left
 * without its rules
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param settings The theme's settings
 * @param executor A transaction
 * @return The new theme's ID
 */
export async function createCustomTheme(version: UniverseVersion, ruleset: Ruleset, settings: CustomThemeSettings, executor: Executor): Promise<number>
{
	const [created] = await executor
		.insert(themes)
		.values({
			ruleset,
			universeId: version.universeId,
			draft: version.draft,
			name: settings.name,
			enabled: settings.enabled
		})
		.returning({ id: themes.id });

	await saveThemeRules(created.id, settings, executor);

	return(created.id);
}

/**
 * Changes one of a version's own themes. Call it inside a transaction
 *
 * @param version The universe's live version or draft
 * @param themeId The theme's ID, from findThemeKind() as custom
 * @param settings The theme's new settings
 * @param executor A transaction
 */
export async function updateCustomTheme(version: UniverseVersion, themeId: number, settings: CustomThemeSettings, executor: Executor): Promise<void>
{
	await executor
		.update(themes)
		.set({
			name: settings.name,
			enabled: settings.enabled
		})
		.where(and(
			eq(themes.id, themeId),
			inVersion(themes, version)
		));
	await saveThemeRules(themeId, settings, executor);
}

/**
 * Stores a version's edited copy of a default theme, replacing any copy it had. Call it inside a transaction
 *
 * @param version The universe's live version or draft
 * @param ruleset The universe's ruleset
 * @param defaultThemeId The default theme's ID, from findThemeKind() as default
 * @param settings The copy's settings; a null name keeps the default theme's
 * @param executor A transaction
 */
export async function saveEditedDefaultTheme(version: UniverseVersion, ruleset: Ruleset, defaultThemeId: number, settings: ThemeSettings, executor: Executor): Promise<void>
{
	const columns = {
		name: settings.name,
		enabled: settings.enabled
	};
	const [copy] = await executor
		.insert(themes)
		.values({
			ruleset,
			universeId: version.universeId,
			draft: version.draft,
			overridesThemeId: defaultThemeId,
			...columns
		})
		.onConflictDoUpdate({
			target: [themes.universeId, themes.draft, themes.overridesThemeId],
			set: columns
		})
		.returning({ id: themes.id });

	await saveThemeRules(copy.id, settings, executor);
}

/**
 * Discards a version's edited copy of a default theme, so the version sees the default again
 *
 * @param version The universe's live version or draft
 * @param defaultThemeId The default theme's ID
 * @param executor The database, or a transaction
 */
export async function restoreDefaultTheme(version: UniverseVersion, defaultThemeId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(themes)
		.where(and(
			inVersion(themes, version),
			eq(themes.overridesThemeId, defaultThemeId)
		));
}

/**
 * Deletes one of a version's own themes
 *
 * @param version The universe's live version or draft
 * @param themeId The theme's ID, from findThemeKind() as custom
 * @param executor The database, or a transaction
 */
export async function deleteCustomTheme(version: UniverseVersion, themeId: number, executor: Executor = db): Promise<void>
{
	await executor
		.delete(themes)
		.where(and(
			eq(themes.id, themeId),
			inVersion(themes, version)
		));
}

/**
 * Stores the rules of a row of theme settings, replacing what it had
 *
 * @param themeId The ID of the row holding the theme's settings
 * @param settings The settings
 * @param executor A transaction
 */
async function saveThemeRules(themeId: number, settings: ThemeSettings, executor: Executor): Promise<void>
{
	const columns = {
		ability: settings.rules.ability
	};

	await executor
		.insert(sf1eThemes)
		.values({
			themeId,
			...columns
		})
		.onConflictDoUpdate({
			target: sf1eThemes.themeId,
			set: columns
		});
}
