/**
 * Which copy of a universe's content a repository reads or writes: its live version, which players play,
 * or its draft (see Universe versions in STRUCTURE-OVERVIEW.md). The content tables mark each row with
 * the copy it belongs to (their draft column)
 */
import { and, eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * A universe's live version or its draft
 */
export interface UniverseVersion
{
	universeId: string;

	/**
	 * Whether it is the draft
	 */
	draft: boolean;
}

/**
 * A universe's live version, the one players play
 *
 * @param universeId The universe's ID
 * @return The version
 */
export function liveVersion(universeId: string): UniverseVersion
{
	return({
		universeId,
		draft: false
	});
}

/**
 * A universe's draft
 *
 * @param universeId The universe's ID
 * @return The version
 */
export function draftVersion(universeId: string): UniverseVersion
{
	return({
		universeId,
		draft: true
	});
}

/**
 * Whether two versions are the same version of the same universe
 *
 * @param a One version
 * @param b The other
 * @return True when they are
 */
export function isSameVersion(a: UniverseVersion, b: UniverseVersion): boolean
{
	return((a.universeId === b.universeId) && (a.draft === b.draft));
}

/**
 * Matches the rows of a content table that belong to one version of a universe
 *
 * @param table The table's universe and draft columns
 * @param version The version
 * @return The condition
 */
export function inVersion(table: { universeId: AnyPgColumn; draft: AnyPgColumn }, version: UniverseVersion): SQL
{
	return(and(
		eq(table.universeId, version.universeId),
		eq(table.draft, version.draft)
	) as SQL);
}
