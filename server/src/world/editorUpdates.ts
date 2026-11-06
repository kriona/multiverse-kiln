import type { UniverseEditDetail, UniverseRole, UniverseVersionName } from '@multiverse-kiln/shared';

/**
 * A save that has committed, for the editor room to tell the other windows of
 */
export interface SavedUpdate
{
	kind: 'saved';
	universeId: string;

	/**
	 * The editor room session ID of the window that saved, which isn't told, or undefined when it named none
	 */
	windowId: string | undefined;

	/**
	 * Who saved, with their display name and username
	 */
	playerId: string;
	name: string;
	username: string;

	/**
	 * The version the save changed
	 */
	version: UniverseVersionName;

	/**
	 * What it changed, as the Audit tab lists it
	 */
	details: readonly UniverseEditDetail[];
}

/**
 * Something open editors of a universe hear about, for its editor room
 *
 * - roles: a save gave players a role, changed it or took it away (undefined), by player ID
 * - access: a server admin disabled the universe or enabled it again, which changes who may save
 * - saved: a save committed (SavedUpdate)
 */
export type EditorUpdate =
	| { kind: 'roles'; universeId: string; roles: ReadonlyMap<string, UniverseRole | undefined> }
	| { kind: 'access'; universeId: string }
	| SavedUpdate;

/**
 * Called after every update
 */
export type EditorUpdateListener = (update: EditorUpdate) => void;

/**
 * Tells the editor rooms what changes for the editors of a universe, so its open editors hear of it at
 * once rather than on their next save
 *
 * Updates are published after they are saved. It lives in memory, so it only reaches rooms in the same
 * server process, like AreaChanges
 */
export class EditorUpdates
{
	private readonly listeners = new Set<EditorUpdateListener>();

	/**
	 * Tells every listener about an update that has been saved
	 *
	 * @param update The update
	 */
	publish(update: EditorUpdate): void
	{
		for (const listener of [...this.listeners])
		{
			listener(update);
		}
	}

	/**
	 * Listens for updates
	 *
	 * @param listener Called after each update
	 * @return Stops listening
	 */
	onUpdate(listener: EditorUpdateListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}
}

/**
 * The server's editor updates, published by the editor's and admin page's routes and followed by the
 * editor rooms
 */
export const editorUpdates = new EditorUpdates();
