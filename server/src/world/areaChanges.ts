/**
 * A change the world editor has made to a universe's world, for the rooms playing in it
 *
 * - cells: cells of an area's map changed, in the chunks listed (by chunkKey())
 * - area: an area's settings, bounds or links changed
 * - deleted: an area was deleted
 * - tiles: a universe's tiles changed (an edited, restored, added or deleted tile)
 * - time: a universe's passage of time, its lobby's, or an area's that others may inherit, changed
 */
export type AreaChange =
	| { kind: 'cells'; areaId: string; chunkKeys: string[] }
	| { kind: 'area'; areaId: string }
	| { kind: 'deleted'; areaId: string }
	| { kind: 'tiles'; universeId: string }
	| { kind: 'time'; universeId: string };

/**
 * Called after every change
 */
export type AreaChangeListener = (change: AreaChange) => void;

/**
 * Tells the rooms about changes to the world as they are made, so edits apply to players straight away
 *
 * Changes are published after they are saved. It lives in memory, so it only reaches rooms in the same
 * server process, like OnlinePlayers
 */
export class AreaChanges
{
	private readonly listeners = new Set<AreaChangeListener>();

	/**
	 * Tells every listener about a change that has been saved
	 *
	 * @param change The change
	 */
	publish(change: AreaChange): void
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
	onChange(listener: AreaChangeListener): () => void
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
export const areaChanges = new AreaChanges();
