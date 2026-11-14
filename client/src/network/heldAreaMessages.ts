import type { Room } from '@colyseus/sdk';
import { ServerMessageType, type ChunksPayload, type NeighborAreasPayload } from '@multiverse-kiln/shared';

/**
 * A message about the areas around the player's area: the areas across its seams, or chunks of an area
 */
export type HeldAreaMessage =
	| { type: ServerMessageType.NeighborAreas; payload: NeighborAreasPayload }
	| { type: ServerMessageType.Chunks; payload: ChunksPayload };

/**
 * The messages a room with an area sends about the areas around the player that arrive while no area
 * scene listens for them: after the area arrives and before the scene that draws it has started, as on
 * joining or switching characters. The room sends each only once, so a scene starting takes the ones
 * held and goes on from there. Those that came before the latest area are dropped, as the room sends the
 * areas around a new area again
 */
export class HeldAreaMessages
{
	private held: HeldAreaMessage[] = [];

	/**
	 * Whether an area scene is listening, so nothing needs holding
	 */
	private listening = false;

	/**
	 * @param room The room, just joined, before it has sent its area
	 */
	constructor(room: Room)
	{
		room.onMessage(ServerMessageType.Area, () =>
		{
			this.held = [];
		});

		room.onMessage(ServerMessageType.NeighborAreas, (payload: NeighborAreasPayload) =>
		{
			this.hold({ type: ServerMessageType.NeighborAreas, payload });
		});

		room.onMessage(ServerMessageType.Chunks, (payload: ChunksPayload) =>
		{
			this.hold({ type: ServerMessageType.Chunks, payload });
		});
	}

	/**
	 * Takes the messages held, for an area scene that has started listening for them itself; nothing more
	 * is held until it stops
	 *
	 * @return The messages, in the order they arrived
	 */
	take(): HeldAreaMessage[]
	{
		const held = this.held;

		this.held = [];
		this.listening = true;

		return(held);
	}

	/**
	 * Holds the messages that arrive from now on, for when the area scene stops listening
	 */
	stopListening(): void
	{
		this.listening = false;
	}

	/**
	 * Holds a message while no area scene listens
	 *
	 * @param message The message
	 */
	private hold(message: HeldAreaMessage): void
	{
		if (!this.listening)
		{
			this.held.push(message);
		}
	}
}

/**
 * The held messages of each joined room with an area
 */
const heldByRoom = new WeakMap<Room, HeldAreaMessages>();

/**
 * Starts holding a room's messages about the areas around the player, as soon as it is joined
 *
 * @param room The room
 */
export function holdAreaMessages(room: Room): void
{
	if (!heldByRoom.has(room))
	{
		heldByRoom.set(room, new HeldAreaMessages(room));
	}
}

/**
 * The messages held for a room's area scene
 *
 * @param room The room
 * @return Its held messages, holding from now on when it wasn't already
 */
export function heldAreaMessages(room: Room): HeldAreaMessages
{
	holdAreaMessages(room);

	return(heldByRoom.get(room) as HeldAreaMessages);
}
