/**
 * Called after a player stops being a server admin
 */
export type ServerAdminLostListener = (playerId: string) => void;

/**
 * Tells the rooms when a player stops being a server admin, removed on the Server Admins page. The
 * editor rooms then stop letting them edit with the site admin role, and turn away their windows of
 * universes they have no role in (ServerCloseCode.AccessLost)
 *
 * Changes are published after they are saved. It lives in memory, so it only reaches rooms in the same
 * server process, like UniverseAccessChanges
 */
export class ServerAdminChanges
{
	private readonly listeners = new Set<ServerAdminLostListener>();

	/**
	 * Tells every listener that a player is no longer a server admin
	 *
	 * @param playerId The player's ID
	 */
	publishLost(playerId: string): void
	{
		for (const listener of [...this.listeners])
		{
			listener(playerId);
		}
	}

	/**
	 * Listens for players who stop being server admins
	 *
	 * @param listener Called after each change
	 * @return Stops listening
	 */
	onLost(listener: ServerAdminLostListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}
}

/**
 * The server's changes to who is a server admin, published by the admin page's routes and followed by
 * the editor rooms
 */
export const serverAdminChanges = new ServerAdminChanges();
