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
	 * The character the window controls is no longer in this room's group: they left it, or were deleted
	 */
	LeftGroup = 4012,

	/**
	 * The group's anchor being left it, so the group is no more
	 */
	GroupDisbanded = 4013,

	/**
	 * The window's login session ended: the player logged out, changed their password, deleted their
	 * account, or the session expired
	 */
	LoggedOut = 4014,

	/**
	 * The universe was deleted, along with its creator's account
	 */
	UniverseDeleted = 4015,

	/**
	 * The player's role in the universe was changed or taken away, and they may no longer play it in its stage
	 */
	AccessLost = 4016,

	/**
	 * A server admin disabled the universe
	 */
	UniverseDisabled = 4017,

	/**
	 * The universe's stage changed to one the player's role doesn't let them play it in
	 */
	StageChanged = 4018,

	/**
	 * The universe reached the end of time, so its lobby is locked; groups can still be opened, read-only
	 */
	UniverseLocked = 4019,

	/**
	 * The universe's creators disabled the race or class of the character the window controls, for
	 * characters already of it, so they can't play until it is enabled again
	 */
	CharacterBarred = 4020,

	/**
	 * The universe's creators lowered its group size, which took the character the window controls out
	 * of the group, or disbanded it
	 */
	GroupSizeLowered = 4021,

	/**
	 * The universe requires its editors to have 2FA on, and the player doesn't: its creators started
	 * requiring it, or the player turned 2FA off
	 */
	TwoFactorRequired = 4022
}
