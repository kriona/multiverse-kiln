/**
 * A character on the map of a room, and the area they are in
 */
export interface Occupant
{
	characterId: string;
	areaId: string;
}

/**
 * Lists the characters on a room's map
 */
export type OccupantSource = () => Iterable<Occupant>;

/**
 * Which areas the characters playing in each universe are in, for the world editor's warning before an
 * area with characters in it is disabled. Saved positions are in the database; this has those only the
 * rooms know, since a group's room saves where its members are only when their players leave
 *
 * Each room with a map registers itself while it is open. It lives in memory, so it only knows rooms in
 * the same server process, like AreaChanges
 */
export class AreaOccupants
{
	private readonly sources = new Map<string, Set<OccupantSource>>();

	/**
	 * Adds a room's characters to its universe's
	 *
	 * @param universeId The universe the room plays in
	 * @param source Lists the room's characters
	 * @return Removes the room
	 */
	register(universeId: string, source: OccupantSource): () => void
	{
		let sources = this.sources.get(universeId);

		if (!sources)
		{
			sources = new Set();
			this.sources.set(universeId, sources);
		}

		sources.add(source);

		return(() =>
		{
			const current = this.sources.get(universeId);

			current?.delete(source);

			if (current?.size === 0)
			{
				this.sources.delete(universeId);
			}
		});
	}

	/**
	 * Every character on the map of a room playing in a universe
	 *
	 * @param universeId The universe's ID
	 * @return The characters and their areas
	 */
	list(universeId: string): Occupant[]
	{
		return([...(this.sources.get(universeId) ?? [])].flatMap((source) => [...source()]));
	}
}

/**
 * The server's rooms' characters, registered by every room with a map and read by the editor's warnings
 */
export const areaOccupants = new AreaOccupants();
