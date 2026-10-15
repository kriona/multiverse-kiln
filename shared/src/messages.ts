/**
 * Message types clients send to the game room
 *
 * Clients send inputs, never state (positions, health, scores): the server decides the outcome
 */
export enum MessageType
{
	/**
	 * The direction the player wants to move in, sent whenever it changes (payload: MovePayload)
	 */
	Move = 'move'
}

/**
 * Message types the game room sends to clients, for one-off events rather than state
 */
export enum ServerMessageType
{
	/**
	 * Sent to each client as it joins: which player in GameState.players it controls (payload: WelcomePayload)
	 */
	Welcome = 'welcome'
}

/**
 * One axis of movement: -1 (left or up), 0 (none) or 1 (right or down)
 */
export type Direction = -1 | 0 | 1;

/**
 * Payload of MessageType.Move: the direction held on each axis, which applies until the next Move
 */
export interface MovePayload
{
	x: Direction;
	y: Direction;
}

/**
 * Payload of ServerMessageType.Welcome
 */
export interface WelcomePayload
{
	/**
	 * Key of the client's own player in GameState.players. Windows of the same browser share one player
	 */
	playerId: string;
}
