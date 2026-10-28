import { isNewRef, type EditorChange, type NewRef, type NumberRef, type ResizeConflict, type SaveChangesPayload, type SaveRefusedPayload } from '@multiverse-kiln/shared';

import type { EditorApiError } from '../../network/editorApi';

/**
 * Why the server refused a change in a save, which saved nothing
 */
export interface SaveRefusal
{
	error: EditorApiError;

	/**
	 * For a map refused because shrinking it would discard something: what it would discard
	 */
	resizeConflict?: ResizeConflict;

	/**
	 * Sends the save again, for a tab that has changed what it sends, such as after the player agreed
	 * to discard what a smaller map cuts off
	 */
	retry(): void;
}

/**
 * The IDs a save gave the things it made, by the refs they were sent with
 */
export class SavedIds
{
	/**
	 * @param ids The IDs, as the server answered them
	 */
	constructor(private readonly ids: SaveChangesPayload['ids'])
	{
	}

	/**
	 * The saved ID of a numeric reference
	 *
	 * @param ref A saved thing's ID, or a new thing's ref
	 * @return Its ID, or undefined for a ref the save didn't make
	 */
	number(ref: NumberRef): number | undefined
	{
		if (!isNewRef(ref))
		{
			return(ref);
		}

		const id = this.ids[ref];

		return(((typeof id === 'number') ? id : undefined));
	}

	/**
	 * The saved ID of an area or uploaded tile graphic
	 *
	 * @param ref A saved thing's ID, or a new thing's ref
	 * @return Its ID, or undefined for a ref the save didn't make
	 */
	string(ref: string): string | undefined
	{
		if (!isNewRef(ref))
		{
			return(ref);
		}

		const id = this.ids[ref];

		return(((typeof id === 'string') ? id : undefined));
	}
}

/**
 * The changes one save of the editor sends, gathered from every tab with unsaved changes, and what each
 * tab does when one of its changes is refused
 */
export class EditorSave
{
	private readonly entries: { change: EditorChange; onRefused: (refusal: SaveRefusal) => void; owner: unknown }[] = [];
	private readonly finished: (() => void)[] = [];

	/**
	 * The tab adding changes, which owns the changes added until the next tab starts
	 */
	owner: unknown;

	/**
	 * The changes, in the order the server saves them
	 *
	 * @return The changes
	 */
	changes(): EditorChange[]
	{
		return(this.entries.map((entry) => entry.change));
	}

	/**
	 * Adds a change
	 *
	 * @param change The change
	 * @param onRefused Shows on the tab why the server refused it
	 */
	add(change: EditorChange, onRefused: (refusal: SaveRefusal) => void): void
	{
		this.entries.push({ change, onRefused, owner: this.owner });
	}

	/**
	 * Calls back once the save is over, whether or not it was saved, for a tab that stops edits while saving
	 *
	 * @param callback Called once
	 */
	onFinished(callback: () => void): void
	{
		this.finished.push(callback);
	}

	/**
	 * Tells the tab whose change was refused why
	 *
	 * @param index The change's place in the save
	 * @param refusal Why
	 * @return The tab that added the change, or undefined when the index isn't one of the save's
	 */
	refuse(index: number, refusal: SaveRefusal): unknown
	{
		const entry = this.entries.at(index);

		entry?.onRefused(refusal);

		return(entry?.owner);
	}

	/**
	 * Tells the tabs that asked that the save is over
	 */
	finish(): void
	{
		for (const callback of this.finished.splice(0))
		{
			callback();
		}
	}
}

/**
 * The ref a save sends a new thing with, from the ID it has on the page
 *
 * @param kind What it is, e.g. tile
 * @param stagedId Its ID on the page, such as a negative tile ID or a new area's "new-1"
 * @return The ref
 */
export function newRef(kind: string, stagedId: number | string): NewRef
{
	return(`new:${kind}${stagedId}`);
}

/**
 * How a save names a thing with a numeric ID: a saved one by its ID, and a new one, whose ID is
 * negative, by its ref
 *
 * @param kind What it is, e.g. tile
 * @param id Its ID on the page
 * @return The reference
 */
export function numberRef(kind: string, id: number): NumberRef
{
	return(((id < 0) ? newRef(kind, id) : id));
}

/**
 * Whether an answer from the server is a refused save's
 *
 * @param data The answer's body
 * @return True for a SaveRefusedPayload
 */
export function isSaveRefused(data: unknown): data is SaveRefusedPayload
{
	return((typeof data === 'object') && (data !== null) && ('changeIndex' in data));
}
