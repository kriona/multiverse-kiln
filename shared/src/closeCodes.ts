/**
 * WebSocket close codes the server uses when it disconnects a client
 *
 * Colyseus reserves 4000-4010 (see CloseCode in colyseus); 4011-4999 are free for the game to use
 */
export enum ServerCloseCode
{
	/**
	 * The client sent too many messages that failed validation
	 */
	TooManyInvalidMessages = 4011,

	/**
	 * The player is no longer in this room's group: they left it, joined another group or logged out
	 */
	LeftGroup = 4012
}
