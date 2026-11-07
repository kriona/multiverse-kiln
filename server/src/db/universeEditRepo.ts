/**
 * The record of saves made in universes' editors, for the editor's Audit tab: the only module that reads
 * or writes the universe_edits table
 */
import { and, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { AuditField, AuditSubject, EditorRole, UniverseEditDetail } from '@multiverse-kiln/shared';

import { db, type Executor } from './client.js';
import { players, universeEdits } from './schema.js';

/**
 * A save to record
 */
export interface NewUniverseEdit
{
	universeId: string;
	playerId: string;
	role: EditorRole;

	/**
	 * Whether the save changed the universe's draft; left out, it changed the live version
	 */
	draft?: boolean;

	/**
	 * What it changed, each with the ID of the thing (SavedEditDetail), which findLastSaver() looks for
	 */
	changeDetails: UniverseEditDetail[];
	savedAt: Date;
}

/**
 * A recorded save, with the player who made it
 */
export interface UniverseEditRecord
{
	id: string;

	/**
	 * The player who saved, or null once their account is deleted
	 */
	player: { username: string; displayName: string } | null;

	role: EditorRole;

	/**
	 * Whether the save changed the universe's draft
	 */
	draft: boolean;
	changeDetails: UniverseEditDetail[] | null;
	savedAt: Date;
}

/**
 * One thing a save changed, as the Audit tab lists it, without the ID it was recorded with
 *
 * @param detail The detail as recorded
 * @return The detail
 */
function omitId(detail: UniverseEditDetail & { id?: unknown }): UniverseEditDetail
{
	const listed = { ...detail };

	delete listed.id;

	return(listed);
}

/**
 * Records a save made in a universe's editor
 *
 * @param edit The save
 * @param executor The database, or a transaction (the save's own, so the record is kept exactly when the save is)
 */
export async function recordUniverseEdit(edit: NewUniverseEdit, executor: Executor = db): Promise<void>
{
	await executor
		.insert(universeEdits)
		.values(edit);
}

/**
 * Deletes up to a batch of the saves made before a time, in every universe. A delete is kept to a batch
 * so it holds its locks briefly and writes a small transaction, however many saves are due; the
 * universe_edits_saved_at_index finds them without reading the rest
 *
 * @param before Saves made before this are deleted
 * @param limit The most to delete
 * @param executor The database, or a transaction
 * @return How many were deleted, so a caller can delete again while a whole batch was
 */
export async function deleteUniverseEditsBefore(before: Date, limit: number, executor: Executor = db): Promise<number>
{
	const due = executor
		.select({
			id: universeEdits.id
		})
		.from(universeEdits)
		.where(lt(universeEdits.savedAt, before))
		.limit(limit);
	const result = await executor
		.delete(universeEdits)
		.where(inArray(universeEdits.id, due));

	return(result.rowCount ?? 0);
}

/**
 * Who last saved a setting of something in a version of a universe, from the saves recorded with the ID
 * of each thing they changed (SavedEditDetail)
 *
 * @param universeId The universe's ID
 * @param draft Whether to look in the draft's saves rather than the live version's
 * @param setting What the setting belongs to, its ID (null for the universe's settings and the ruleset),
 * and the setting as the Audit tab names it
 * @param executor The database, or a transaction
 * @return Their display name and username, or undefined when no recorded save names it or their account is deleted
 */
export async function findLastSaver(universeId: string, draft: boolean, setting: { subject: AuditSubject; id: number | string | null; field: AuditField }, executor: Executor = db): Promise<{ name: string; username: string } | undefined>
{
	const pattern = JSON.stringify([{
		subject: setting.subject,
		id: setting.id,
		fields: [{ field: setting.field }]
	}]);
	const [row] = await executor
		.select({
			name: players.displayName,
			username: players.username
		})
		.from(universeEdits)
		.innerJoin(players, eq(players.id, universeEdits.playerId))
		.where(and(
			eq(universeEdits.universeId, universeId),
			eq(universeEdits.draft, draft),
			sql`${universeEdits.changeDetails} @> ${pattern}::jsonb`
		))
		.orderBy(desc(universeEdits.savedAt), desc(universeEdits.id))
		.limit(1);

	return(row);
}

/**
 * A page of the saves made in a universe's editor
 *
 * @param universeId The universe's ID
 * @param page How many saves to skip, newest first, and most to return
 * @param executor The database, or a transaction
 * @return The page of saves, newest first, and how many there are in all
 */
export async function listUniverseEdits(universeId: string, page: { offset: number; limit: number }, executor: Executor = db): Promise<{ edits: UniverseEditRecord[]; total: number }>
{
	const rows = await executor
		.select({
			id: universeEdits.id,
			username: players.username,
			displayName: players.displayName,
			role: universeEdits.role,
			draft: universeEdits.draft,
			changeDetails: universeEdits.changeDetails,
			savedAt: universeEdits.savedAt
		})
		.from(universeEdits)
		.leftJoin(players, eq(players.id, universeEdits.playerId))
		.where(eq(universeEdits.universeId, universeId))
		.orderBy(desc(universeEdits.savedAt), desc(universeEdits.id))
		.offset(page.offset)
		.limit(page.limit);
	const [counted] = await executor
		.select({
			total: count()
		})
		.from(universeEdits)
		.where(eq(universeEdits.universeId, universeId));

	return({
		edits: rows.map(({ username, displayName, changeDetails, ...edit }) => ({
			...edit,
			// The ID of each thing changed is kept for findLastSaver(), and the Audit tab names things by name
			changeDetails: (changeDetails?.map((detail) => omitId(detail)) ?? null),
			player: (((username === null) || (displayName === null)) ? null : {
				username,
				displayName
			})
		})),
		total: counted.total
	});
}
