/**
 * A change the world editor has made to a universe's world, for the rooms playing in it
 *
 * - cells: cells of a zone's map changed, in the chunks listed (by chunkKey())
 * - zone: a zone's settings, bounds or links changed
 * - deleted: a zone was deleted
 * - tiles: a universe's tiles changed (an edited, restored, added or deleted tile)
 */
export type ZoneChange =
	| { kind: 'cells'; zoneId: string; chunkKeys: string[] }
	| { kind: 'zone'; zoneId: string }
	| { kind: 'deleted'; zoneId: string }
	| { kind: 'tiles'; universeId: string };

/**
 * Called after every change
 */
export type ZoneChangeListener = (change: ZoneChange) => void;

/**
 * Tells the rooms about changes to the world as they are made, so edits apply to players straight away
 *
 * Changes are published after they are saved. It lives in memory, so it only reaches rooms in the same
 * server process, like OnlinePlayers
 */
export class ZoneChanges
{
	private readonly listeners = new Set<ZoneChangeListener>();

	/**
	 * Tells every listener about a change that has been saved
	 *
	 * @param change The change
	 */
	publish(change: ZoneChange): void
	{
		for (const listener of [...this.listeners])
		{
			listener(change);
		}
	}

	/**
	 * Listens for changes
	 *
	 * @param listener Called after each change
	 * @return Stops listening
	 */
	onChange(listener: ZoneChangeListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}
}

/**
 * The server's world changes, published by the editor's routes and followed by every room with a map
 */
export const zoneChanges = new ZoneChanges();
