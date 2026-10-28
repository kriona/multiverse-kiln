/**
 * What saving the editor's changes passes each change: the universe, the transaction they share, and
 * the IDs of the things made earlier in the same save (see editorChanges.ts)
 */
import { isNewRef, type EditableUniverse, type MessageDescriptor, type MessageValues, type NewRef, type NumberRef, type ResizeConflict, type StringRef, type UniverseRole } from '@multiverse-kiln/shared';

import type { Executor } from '../db/client.js';
import type { AreaChange } from '../world/areaChanges.js';
import { errorMessages, type Refusal } from './errors.js';

/**
 * An uploaded tileset, checked, re-encoded and stored before the save's transaction starts
 */
export interface PreparedUpload
{
	graphicId: string;
	storageKey: string;
}

/**
 * The state one save's changes share
 */
export interface ChangeContext
{
	readonly playerId: string;

	/**
	 * The universe as the changes before this one left it
	 */
	universe: Omit<EditableUniverse, 'role'>;

	readonly role: UniverseRole;

	/**
	 * The save's transaction, which holds the universe's lock
	 */
	readonly transaction: Executor;

	/**
	 * The ID each thing made so far was saved with, by its ref
	 */
	readonly ids: Map<NewRef, number | string>;

	/**
	 * The save's uploaded tilesets, by their refs
	 */
	readonly uploads: ReadonlyMap<NewRef, PreparedUpload>;

	/**
	 * What to tell the rooms once the save commits
	 */
	readonly published: AreaChange[];

	/**
	 * Images of deleted tilesets, removed from storage once the save commits
	 */
	readonly deletedImages: string[];
}

/**
 * Why a change was refused, thrown by the change so the save rolls back
 */
export class ChangeRefusal extends Error
{
	/**
	 * @param refusal The status and the reason
	 * @param resizeConflict For a resize refused because it would discard something, what it would discard
	 */
	constructor(readonly refusal: Refusal, readonly resizeConflict?: ResizeConflict)
	{
		super(refusal.message.id);
	}
}

/**
 * Refuses the change being saved, rolling the save back
 *
 * @param status The HTTP status, e.g. 409
 * @param message Why
 * @param values The message's arguments' values
 */
export function refuse(status: number, message: MessageDescriptor, values?: MessageValues): never
{
	throw new ChangeRefusal({ status, message, values });
}

/**
 * Refuses a change that names a ref no earlier change in the save made, or that makes one twice
 *
 * @param problem What is wrong, in English, like a validation error
 */
function refuseRef(problem: string): never
{
	refuse(400, errorMessages.invalidRequest, { problem });
}

/**
 * Remembers the ID a new thing was saved with, for the changes after it and the save's answer
 *
 * @param context The save
 * @param ref The thing's ref
 * @param id Its ID
 */
export function recordRef(context: ChangeContext, ref: NewRef, id: number | string): void
{
	if (context.ids.has(ref))
	{
		refuseRef(`${ref} is made twice`);
	}

	context.ids.set(ref, id);
}

/**
 * The ID a numeric reference stands for
 *
 * @param context The save
 * @param ref A saved thing's ID, or the ref of one made earlier in the save
 * @return The ID
 */
export function resolveNumberRef(context: ChangeContext, ref: NumberRef): number
{
	if (!isNewRef(ref))
	{
		return(ref);
	}

	const id = context.ids.get(ref);

	if (typeof id !== 'number')
	{
		refuseRef(`${ref} isn't made earlier in the save`);
	}

	return(id);
}

/**
 * The ID an area or tile graphic reference stands for
 *
 * @param context The save
 * @param ref A saved thing's ID, or the ref of one made earlier in the save
 * @return The ID
 */
export function resolveStringRef(context: ChangeContext, ref: StringRef): string
{
	if (!isNewRef(ref))
	{
		return(ref);
	}

	const id = context.ids.get(ref);

	if (typeof id !== 'string')
	{
		refuseRef(`${ref} isn't made earlier in the save`);
	}

	return(id);
}
