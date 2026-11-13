/**
 * Universes: the only module that reads or writes the universes table
 */
import { and, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { nameKey, UNIVERSE_ID_PATTERN, universeSlug, type AdminUniverseCreator, type EditableUniverseDetails, type Ruleset, type UniverseDetails, type UniverseSettingsUpdate, type UniverseStage, type UniverseSummary } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { fromCoinAbbreviationColumns, fromCoinColumns, fromCoinNameColumns, toCoinAbbreviationColumns, toCoinColumns, toCoinNameColumns } from './coinColumns.js';
import { addDefaultDifficultyLevels } from './difficultyRepo.js';
import { players, universeDrafts, universeEditors, universes } from './schema.js';
import { loadStartingItems, replaceStartingItems } from './startingItemRepo.js';
import { anyColumnContains } from './textSearch.js';
import type { UniverseVersion } from './universeVersions.js';

/**
 * The unique index that keeps two universes from having the same slug, and so the same name
 */
const SLUG_INDEX = 'universes_slug_unique';

/**
 * Postgres's code for a row that breaks a unique index
 */
const UNIQUE_VIOLATION = '23505';

/**
 * The transaction-level advisory lock that makes universes take names one at a time, so two lookalike
 * names can't both be checked as free and then both be taken. Any number no other lock uses
 */
const NAMING_LOCK = 7_318_211;

/**
 * Thrown when a universe would take a name another universe has, or one that could be mistaken for it:
 * the same slug, or the same key (nameKey), which looks past capitals, accents, look-alike letters,
 * stand-ins such as "1" for "i", repeated letters and the spaces and punctuation between words
 */
export class UniverseNameTakenError extends Error
{
	/**
	 * @param name The name asked for
	 */
	constructor(name: string)
	{
		super(`Another universe already has the name "${name}", or one too much like it`);
		this.name = 'UniverseNameTakenError';
	}
}

/**
 * Whether a query failed because the universe's slug is another universe's. Drizzle wraps the driver's
 * error, which holds the code and the index
 *
 * @param error What the query threw
 * @return True when it broke the slug's unique index
 */
function isSlugTaken(error: unknown): boolean
{
	const cause = ((error instanceof Error) ? (error.cause ?? error) : error);

	return((typeof cause === 'object') && (cause !== null) && ('code' in cause) && (cause.code === UNIQUE_VIOLATION) && ('constraint' in cause) && (cause.constraint === SLUG_INDEX));
}

/**
 * Whether another universe has a name, or one too much like it, as setting the name would find
 * (settingName()), such as before importing a name from another universe's export
 *
 * @param name The name
 * @param universeId The universe that would have it
 * @param executor The database, or a transaction
 * @return True when another universe has it
 */
export async function isUniverseNameTaken(name: string, universeId: string, executor: Executor = db): Promise<boolean>
{
	const key = nameKey(name);
	const slug = universeSlug(name);
	const others = await executor
		.select({
			id: universes.id,
			name: universes.name,
			slug: universes.slug
		})
		.from(universes);

	return(others.some((other) => ((other.id !== universeId) && ((nameKey(other.name) === key) || (other.slug === slug)))));
}

/**
 * Runs a query that sets a universe's name, if no other universe has a name with the same key
 *
 * The keys are compared here rather than kept in the database, so a change to how names are reduced
 * (shared/src/names.ts) applies to every name at once. Names change rarely, so reading them all is
 * cheap. The slug's unique index still catches two universes with the same address
 *
 * @param name The name being set
 * @param universeId The universe being renamed, or undefined for a new one
 * @param executor The database, or a transaction
 * @param query The query, run on a transaction holding the naming lock
 * @return What the query returns
 * @throws UniverseNameTakenError when another universe's name has the same key or slug
 */
async function settingName<T>(name: string, universeId: string | undefined, executor: Executor, query: (transaction: Executor) => Promise<T>): Promise<T>
{
	try
	{
		return(await executor.transaction(async (transaction) =>
		{
			await transaction.execute(sql`SELECT pg_advisory_xact_lock(${NAMING_LOCK})`);

			const key = nameKey(name);
			const others = await transaction
				.select({
					id: universes.id,
					name: universes.name
				})
				.from(universes);

			if (others.some((other) => ((other.id !== universeId) && (nameKey(other.name) === key))))
			{
				throw new UniverseNameTakenError(name);
			}

			return(query(transaction));
		}));
	}
	catch (error)
	{
		if (isSlugTaken(error))
		{
			throw new UniverseNameTakenError(name);
		}

		throw error;
	}
}

/**
 * A universe as the rest of the server sees it
 */
export interface UniverseRecord
{
	id: string;
	name: string;
	shortDescription: string;
	stage: UniverseStage;
	ruleset: Ruleset;

	/**
	 * Undefined until the universe's areas exist, and while it has no lobby area
	 */
	lobbyAreaId: string | undefined;

	/**
	 * The cell of the lobby's area players start nearest
	 */
	lobbyColumn: number;

	lobbyRow: number;

	/**
	 * Undefined until the universe's areas exist
	 */
	startingAreaId: string | undefined;

	/**
	 * The cell of the starting area characters start nearest
	 */
	startingColumn: number;

	startingRow: number;

	/**
	 * Whether a server admin has disabled it, so no one may play it
	 */
	disabled: boolean;

	/**
	 * Whether its editors need 2FA on to save changes to it, other than leaving it
	 */
	requireTwoFactor: boolean;

	/**
	 * Whether builders make their changes in its draft while it is let there be light
	 */
	requireBuilderDraft: boolean;
}

/**
 * What a new universe needs. Its slug comes from its name, and its lobby and starting areas are set
 * once they exist (setUniverseAreas)
 */
export type NewUniverse = Pick<typeof universes.$inferInsert, 'id' | 'name' | 'shortDescription' | 'longDescription' | 'sourceLanguage' | 'stage' | 'ruleset'>;

/**
 * Adds a universe, with the default difficulty levels
 *
 * @param universe The universe, whose name must have a letter or digit
 * @param executor The database, or a transaction
 * @return The new universe's ID
 * @throws UniverseNameTakenError when another universe has the name, or one too much like it
 */
export async function createUniverse(universe: NewUniverse, executor: Executor = db): Promise<string>
{
	return(settingName(universe.name, undefined, executor, async (transaction) =>
	{
		const [created] = await transaction
			.insert(universes)
			.values({
				...universe,
				slug: universeSlug(universe.name)
			})
			.returning({ id: universes.id });

		await addDefaultDifficultyLevels(created.id, transaction);

		return(created.id);
	}));
}

/**
 * Sets the area a universe's lobby is in and the area its groups start in
 *
 * @param universeId The universe's ID
 * @param lobbyAreaId The lobby's area
 * @param startingAreaId The area groups start in
 * @param executor The database, or a transaction
 */
export async function setUniverseAreas(universeId: string, lobbyAreaId: string, startingAreaId: string, executor: Executor = db): Promise<void>
{
	await executor
		.update(universes)
		.set({
			lobbyAreaId,
			startingAreaId
		})
		.where(eq(universes.id, universeId));
}

/**
 * Finds a universe
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The universe, or undefined when there is none with that ID
 */
export async function findUniverse(universeId: string, executor: Executor = db): Promise<UniverseRecord | undefined>
{
	const [row] = await executor
		.select()
		.from(universes)
		.where(eq(universes.id, universeId))
		.limit(1);

	if (!row)
	{
		return(undefined);
	}

	return({
		id: row.id,
		name: row.name,
		shortDescription: row.shortDescription,
		stage: row.stage,
		ruleset: row.ruleset,
		lobbyAreaId: row.lobbyAreaId ?? undefined,
		lobbyColumn: row.lobbyColumn,
		lobbyRow: row.lobbyRow,
		startingAreaId: row.startingAreaId ?? undefined,
		startingColumn: row.startingColumn,
		startingRow: row.startingRow,
		disabled: (row.disabledAt !== null),
		requireTwoFactor: row.requireTwoFactor,
		requireBuilderDraft: row.requireBuilderDraft
	});
}

/**
 * A page of the universes in a stage that aren't disabled, by name
 *
 * @param stage The stage
 * @param offset How many universes to skip
 * @param limit Most universes to return
 * @param executor The database, or a transaction
 * @return The universes
 */
export async function listUniverses(stage: UniverseStage, offset: number, limit: number, executor: Executor = db): Promise<UniverseSummary[]>
{
	return(executor
		.select({
			id: universes.id,
			name: universes.name,
			slug: universes.slug,
			shortDescription: universes.shortDescription,
			ruleset: universes.ruleset,
			sourceLanguage: universes.sourceLanguage,
			translationLanguages: universes.translationLanguages
		})
		.from(universes)
		.where(and(
			eq(universes.stage, stage),
			isNull(universes.disabledAt)
		))
		.orderBy(universes.name, universes.id)
		.offset(offset)
		.limit(limit));
}

/**
 * A universe's details, with its stage, if it isn't disabled. The caller decides whether the stage
 * lets the player see it
 *
 * @param key The universe's ID or slug
 * @param executor The database, or a transaction
 * @return The universe, or undefined when there is none with that ID or slug, or it is disabled
 */
export async function findUniverseDetails(key: string, executor: Executor = db): Promise<UniverseDetails | undefined>
{
	// A key in the form of an ID is only compared with the ID column, which refuses anything else; no
	// slug has that form (hasIdShapedSlug), so one universe at most matches either way
	const byKey = (UNIVERSE_ID_PATTERN.test(key) ? eq(universes.id, key) : eq(universes.slug, key));
	const [row] = await executor
		.select({
			id: universes.id,
			name: universes.name,
			slug: universes.slug,
			shortDescription: universes.shortDescription,
			longDescription: universes.longDescription,
			ruleset: universes.ruleset,
			sourceLanguage: universes.sourceLanguage,
			translationLanguages: universes.translationLanguages,
			stage: universes.stage
		})
		.from(universes)
		.where(and(
			byKey,
			isNull(universes.disabledAt)
		))
		.limit(1);

	return(row);
}

/**
 * The columns of a version's own settings (universeVersionColumns() in schema.ts), as the editor shows them
 *
 * @param table The live version's table (universes) or the draft's (universe_drafts)
 * @return The columns
 */
function versionSettingColumns(table: typeof universes | typeof universeDrafts)
{
	return({
		name: table.name,
		shortDescription: table.shortDescription,
		longDescription: table.longDescription,
		sourceLanguage: table.sourceLanguage,
		translationLanguages: table.translationLanguages,
		displayTime: table.displayTime,
		lobbyPassageOfTime: table.lobbyPassageOfTime,
		lobbyDayHours: table.lobbyDayHours,
		lobbyFaerieMorning: table.lobbyFaerieMorning,
		lobbyAreaId: table.lobbyAreaId,
		lobbyColumn: table.lobbyColumn,
		lobbyRow: table.lobbyRow,
		startingAreaId: table.startingAreaId,
		startingColumn: table.startingColumn,
		startingRow: table.startingRow,
		groupSize: table.groupSize,
		startingPlatinum: table.startingPlatinum,
		startingGold: table.startingGold,
		startingSilver: table.startingSilver,
		startingCopper: table.startingCopper,
		startingCredits: table.startingCredits,
		platinumName: table.platinumName,
		goldName: table.goldName,
		silverName: table.silverName,
		copperName: table.copperName,
		creditsName: table.creditsName,
		platinumAbbreviation: table.platinumAbbreviation,
		goldAbbreviation: table.goldAbbreviation,
		silverAbbreviation: table.silverAbbreviation,
		copperAbbreviation: table.copperAbbreviation,
		creditsAbbreviation: table.creditsAbbreviation
	});
}

/**
 * A version's own settings
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The settings, or undefined when the universe doesn't exist or has no draft
 */
async function findVersionSettings(version: UniverseVersion, executor: Executor)
{
	const [row] = await (version.draft
		? executor
			.select(versionSettingColumns(universeDrafts))
			.from(universeDrafts)
			.where(eq(universeDrafts.universeId, version.universeId))
			.limit(1)
		: executor
			.select(versionSettingColumns(universes))
			.from(universes)
			.where(eq(universes.id, version.universeId))
			.limit(1));

	return(row);
}

/**
 * Whether a universe has a draft
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return True when it has one
 */
export async function hasDraft(universeId: string, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.select({
			universeId: universeDrafts.universeId
		})
		.from(universeDrafts)
		.where(eq(universeDrafts.universeId, universeId))
		.limit(1);

	return(rows.length > 0);
}

/**
 * A version of a universe with every setting the editor shows: the universe's own, and the version's
 *
 * @param version The universe's live version or draft
 * @param executor The database, or a transaction
 * @return The universe without the player's role, or undefined when there is none with that ID, or it
 * has no draft when the draft is asked for
 */
export async function findEditableUniverse(version: UniverseVersion, executor: Executor = db): Promise<EditableUniverseDetails | undefined>
{
	const [row] = await executor
		.select({
			id: universes.id,
			slug: universes.slug,
			stage: universes.stage,
			requireTwoFactor: universes.requireTwoFactor,
			requireBuilderDraft: universes.requireBuilderDraft,
			ruleset: universes.ruleset,
			disabledReason: universes.disabledReason,
			deletionPrevented: universes.deletionPrevented
		})
		.from(universes)
		.where(eq(universes.id, version.universeId))
		.limit(1);
	const versionSettings = (row ? await findVersionSettings(version, executor) : undefined);

	if (!row || !versionSettings)
	{
		return(undefined);
	}

	const { startingPlatinum, startingGold, startingSilver, startingCopper, startingCredits, platinumName, goldName, silverName, copperName, creditsName, platinumAbbreviation, goldAbbreviation, silverAbbreviation, copperAbbreviation, creditsAbbreviation, ...settings } = versionSettings;

	return({
		...row,
		version: (version.draft ? 'draft' : 'live'),
		hasDraft: (version.draft || await hasDraft(version.universeId, executor)),
		...settings,
		startingMoney: fromCoinColumns({ startingPlatinum, startingGold, startingSilver, startingCopper, startingCredits }),
		coinNames: fromCoinNameColumns({ platinumName, goldName, silverName, copperName, creditsName }),
		coinAbbreviations: fromCoinAbbreviationColumns({ platinumAbbreviation, goldAbbreviation, silverAbbreviation, copperAbbreviation, creditsAbbreviation }),
		startingItems: await loadStartingItems(version, executor)
	});
}

/**
 * Changes some of a universe's settings: its stage and whether it requires builders to use a draft and
 * its editors to have 2FA, which the universe has once for both versions, whichever version is given,
 * and the rest in that version
 *
 * The database refuses a faerie passage of time without a faerie morning, a faerie morning without
 * faerie time (for the universe and for its lobby), and a lobby day length, group size or starting
 * money out of range. The caller checks that a starting area is one of the version's, and that the
 * starting items are items it can use. A new name is checked against other universes' names; the live
 * version's changes the universe's slug with it, and the draft's waits until the draft is applied
 *
 * @param version The universe's live version or draft
 * @param update The settings to change; a name must have a letter or digit
 * @param executor A transaction when the update holds starting items, otherwise the database or a transaction
 * @throws UniverseNameTakenError when another universe has the new name, or one too much like it
 */
export async function updateUniverseSettings(version: UniverseVersion, update: UniverseSettingsUpdate, executor: Executor = db): Promise<void>
{
	const { startingMoney, coinNames, coinAbbreviations, startingItems, name, stage, requireTwoFactor, requireBuilderDraft, ...settings } = update;
	const versionSettings = {
		...settings,
		...((startingMoney === undefined) ? {} : toCoinColumns(startingMoney)),
		...((coinNames === undefined) ? {} : toCoinNameColumns(coinNames)),
		...((coinAbbreviations === undefined) ? {} : toCoinAbbreviationColumns(coinAbbreviations))
	};

	if (startingItems !== undefined)
	{
		await replaceStartingItems(version, startingItems, executor);
	}

	if ((stage !== undefined) || (requireTwoFactor !== undefined) || (requireBuilderDraft !== undefined))
	{
		await executor
			.update(universes)
			.set({
				stage,
				requireTwoFactor,
				requireBuilderDraft
			})
			.where(eq(universes.id, version.universeId));
	}

	/**
	 * Changes the version's settings, with its name when given
	 *
	 * @param transaction The database, or a transaction
	 * @param named The settings, with the name when it changes
	 */
	const save = async (transaction: Executor, named: Record<string, unknown>): Promise<void> =>
	{
		if (Object.keys(named).length === 0)
		{
			return;
		}

		await (version.draft
			? transaction
				.update(universeDrafts)
				.set(named)
				.where(eq(universeDrafts.universeId, version.universeId))
			: transaction
				.update(universes)
				.set({
					...named,
					...((name === undefined) ? {} : { slug: universeSlug(name) })
				})
				.where(eq(universes.id, version.universeId)));
	};

	await ((name === undefined)
		? save(executor, versionSettings)
		: settingName(name, version.universeId, executor, (transaction) => save(transaction, {
			...versionSettings,
			name
		})));
}

/**
 * Locks a universe's row until the transaction ends, so limits on what it holds (such as its number
 * of areas) are checked by one transaction at a time
 *
 * FOR NO KEY UPDATE doesn't block the key share lock foreign key checks take, so rows that refer to
 * the universe (chat messages, characters, groups) can still be added while a long save holds it
 *
 * @param universeId The universe's ID
 * @param executor A transaction
 * @return Whether the universe exists
 */
export async function lockUniverse(universeId: string, executor: Executor): Promise<boolean>
{
	const rows = await executor
		.select({
			id: universes.id
		})
		.from(universes)
		.where(eq(universes.id, universeId))
		.for('no key update');

	return(rows.length > 0);
}

/**
 * Locks a universe's row against lockUniverse() until the transaction ends, for a player's action that
 * only has to wait out a world editor save or a server admin, such as creating a character while a race
 * may be deleted. Any number of transactions can hold it at once
 *
 * The transaction must not take lockUniverse() on the same universe after it: two transactions upgrading
 * their shared lock would deadlock
 *
 * @param universeId The universe's ID
 * @param executor A transaction
 * @return Whether the universe exists
 */
export async function lockUniverseShared(universeId: string, executor: Executor): Promise<boolean>
{
	const rows = await executor
		.select({
			id: universes.id
		})
		.from(universes)
		.where(eq(universes.id, universeId))
		.for('share');

	return(rows.length > 0);
}

/**
 * Why a server admin disabled a universe
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return The reason, or null when it isn't disabled or doesn't exist
 */
export async function findDisabledReason(universeId: string, executor: Executor = db): Promise<string | null>
{
	const [row] = await executor
		.select({
			disabledReason: universes.disabledReason
		})
		.from(universes)
		.where(eq(universes.id, universeId))
		.limit(1);

	return((row?.disabledReason ?? null));
}

/**
 * Whether a server admin who disabled a universe kept its creators from deleting it
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return Whether they did: false when it isn't disabled or doesn't exist
 */
export async function isUniverseDeletionPrevented(universeId: string, executor: Executor = db): Promise<boolean>
{
	const [row] = await executor
		.select({
			deletionPrevented: universes.deletionPrevented
		})
		.from(universes)
		.where(eq(universes.id, universeId))
		.limit(1);

	return((row?.deletionPrevented ?? false));
}

/**
 * A universe as the Universes admin page lists it
 */
export interface AdminUniverseRecord
{
	id: string;
	name: string;
	slug: string;
	stage: UniverseStage;
	ruleset: Ruleset;
	createdAt: Date;

	/**
	 * Its creators, by username ignoring case
	 */
	creators: AdminUniverseCreator[];

	disabledAt: Date | null;
	disabledReason: string | null;
	deletionPrevented: boolean;
}

/**
 * A page of every universe, for the Universes admin page, by name ignoring case
 *
 * @param filter Only universes whose name holds the search, ignoring capitals, and only those disabled or not
 * @param page How many matching universes to skip, and the most to return
 * @param executor The database, or a transaction
 * @return The page, and how many universes match
 */
export async function listUniversesForAdmin(filter: { search?: string; disabled?: boolean }, page: { offset: number; limit: number }, executor: Executor = db): Promise<{ universes: AdminUniverseRecord[]; total: number }>
{
	const where = and(
		((filter.search === undefined) ? undefined : anyColumnContains([universes.name], filter.search)),
		((filter.disabled === undefined) ? undefined : (filter.disabled ? isNotNull(universes.disabledAt) : isNull(universes.disabledAt)))
	);
	// A query with a join names each column's table, which a single-table select leaves out
	const creatorList = executor
		.select({
			creators: sql`json_agg(json_build_object('username', ${players.username}, 'displayName', ${players.displayName}) ORDER BY lower(${players.username}))`
		})
		.from(universeEditors)
		.innerJoin(players, eq(players.id, universeEditors.playerId))
		.where(and(
			eq(universeEditors.universeId, universes.id),
			eq(universeEditors.role, 'creator')
		));
	const creators = sql<AdminUniverseCreator[]>`coalesce((${creatorList}), '[]'::json)`;
	const [rows, [counted]] = await Promise.all([
		executor
			.select({
				id: universes.id,
				name: universes.name,
				slug: universes.slug,
				stage: universes.stage,
				ruleset: universes.ruleset,
				createdAt: universes.createdAt,
				creators,
				disabledAt: universes.disabledAt,
				disabledReason: universes.disabledReason,
				deletionPrevented: universes.deletionPrevented
			})
			.from(universes)
			.where(where)
			.orderBy(sql`lower(${universes.name})`, universes.id)
			.offset(page.offset)
			.limit(page.limit),
		executor
			.select({
				total: count()
			})
			.from(universes)
			.where(where)
	]);

	return({
		universes: rows,
		total: counted.total
	});
}

/**
 * How a server admin disables a universe
 */
export interface UniverseDisabling
{
	/**
	 * Why it is disabled, from 1 to MAX_DISABLED_REASON_LENGTH characters
	 */
	reason: string;

	/**
	 * Whether its creators are kept from deleting it while it is disabled
	 */
	preventDeletion: boolean;
}

/**
 * Disables a universe, or enables it again
 *
 * @param universeId The universe's ID
 * @param disabling Why it is disabled and whether its creators may delete it; null enables it
 * @param executor The database, or a transaction
 * @return Whether it changed: false when it doesn't exist, or was already disabled (or enabled)
 */
export async function setUniverseDisabled(universeId: string, disabling: UniverseDisabling | null, executor: Executor = db): Promise<boolean>
{
	const rows = await executor
		.update(universes)
		.set({
			disabledAt: ((disabling === null) ? null : new Date()),
			disabledReason: (disabling?.reason ?? null),
			deletionPrevented: (disabling?.preventDeletion ?? false)
		})
		.where(and(
			eq(universes.id, universeId),
			((disabling === null) ? isNotNull(universes.disabledAt) : isNull(universes.disabledAt))
		))
		.returning({
			id: universes.id
		});

	return((rows.length > 0));
}

/**
 * Deletes a universe and everything in it: its areas and their cells, links and tiles
 *
 * @param universeId The universe's ID
 * @param executor The database, or a transaction
 * @return Whether there was a universe to delete
 */
export async function deleteUniverse(universeId: string, executor: Executor = db): Promise<boolean>
{
	const deleted = await executor
		.delete(universes)
		.where(eq(universes.id, universeId))
		.returning({ id: universes.id });

	return(deleted.length > 0);
}
