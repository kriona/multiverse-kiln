/**
 * The open room of one kind for each key, such as each group's game room, in this process. A room that
 * holds its key's state in memory and saves it as it closes claims its key in onCreate, so a second room
 * for the same key is refused rather than loading a second copy of that state and saving over the
 * first's. Matchmaking's filterBy already sends clients asking for the same key to one room, and this
 * stops a room made some other way
 */
export class OneRoomPerKey<RoomType extends object>
{
	private readonly rooms = new Map<string, RoomType>();

	/**
	 * The key each room claimed, so it can be let go of when the room never got as far as storing it
	 */
	private readonly keys = new WeakMap<RoomType, string>();

	/**
	 * @param what What the key is the ID of, such as 'group', for the refusal's message
	 */
	constructor(private readonly what: string)
	{
	}

	/**
	 * Makes room the open room for key. Call it at the start of onCreate, before anything is awaited, so
	 * rooms created at the same moment can't both claim it
	 *
	 * @param key The room's key, such as its group's ID
	 * @param room The room
	 * @throws When another room is open for key, which turns away the client asking for the new room
	 */
	claim(key: string, room: RoomType): void
	{
		if (this.rooms.has(key))
		{
			throw new Error(`The ${this.what} ${key} already has a room`);
		}

		this.rooms.set(key, room);
		this.keys.set(room, key);
	}

	/**
	 * Lets go of the key room claimed, if it claimed one. Call it at the start of onDispose, which also
	 * runs when onCreate fails, so a room for the key can be created as soon as this one starts closing
	 *
	 * @param room The room
	 */
	release(room: RoomType): void
	{
		const key = this.keys.get(room);

		if ((key !== undefined) && (this.rooms.get(key) === room))
		{
			this.rooms.delete(key);
		}

		this.keys.delete(room);
	}
}
