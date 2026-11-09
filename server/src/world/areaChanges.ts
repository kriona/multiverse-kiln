/**
 * A cell of an area
 */
export interface AreaPlace
{
	areaId: string;
	column: number;
	row: number;
}

/**
 * A change the world editor has made to a universe's world, for the rooms playing in it
 *
 * - cells: cells of an area changed, in the chunks listed (by chunkKey())
 * - area: an area's settings, bounds or links changed
 * - deleted: an area was deleted
 * - tiles: a universe's tiles changed (an edited, restored, added or deleted tile)
 * - time: a universe's passage of time, its lobby's, or an area's that others may inherit, changed
 * - universeDeleted: the universe was deleted, with its world, groups and characters, so its rooms
 *   turn every window away
 * - universeDisabled: a server admin disabled the universe, so its rooms turn every window away
 * - evacuated: an area was disabled, and everyone in it goes to destination, or to where they start
 *   (the lobby area, or their group's starting area) when it is null. Published after the area's own
 *   change, and handled by the rooms rather than AreaPlayers.applyChange()
 * - lobby: a universe's lobby moved to another area or starting cell, or now has no area. Its lobby room
 *   reads where its players walk again (published with an area change for the old and new lobby areas,
 *   whose time and vision follow the lobby's settings while they are its area)
 * - text: a universe's text changed (a name, a translation or its languages), so its rooms tell their
 *   clients to fetch it again (ServerMessageType.UniverseText)
 */
export type AreaChange =
	| { kind: 'cells'; areaId: string; chunkKeys: string[] }
	| { kind: 'area'; areaId: string }
	| { kind: 'deleted'; areaId: string }
	| { kind: 'evacuated'; areaId: string; destination: AreaPlace | null }
	| { kind: 'lobby'; universeId: string }
	| { kind: 'text'; universeId: string }
	| { kind: 'tiles'; universeId: string }
	| { kind: 'time'; universeId: string }
	| { kind: 'universeDeleted'; universeId: string }
	| { kind: 'universeDisabled'; universeId: string };

/**
 * Called after every change
 */
export type AreaChangeListener = (change: AreaChange) => void;

/**
 * Tells the rooms about changes to the world as they are made, so edits apply to players immediately
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
 * The server's world changes, published by the editor's routes and followed by every room with an area
 */
export const areaChanges = new AreaChanges();
