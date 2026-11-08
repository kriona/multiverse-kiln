/**
 * Called after a player turns 2FA on or off
 *
 * @param playerId The player's ID
 * @param on Whether they have it on now
 */
export type TwoFactorChangeListener = (playerId: string, on: boolean) => void;

/**
 * Tells the rooms when a player turns 2FA on or off. The editor rooms of universes that require their
 * editors to have it on then tell the player's windows, which may save there only while it is on
 *
 * Changes are published after they are saved. It lives in memory, so it only reaches rooms in the same
 * server process, like ServerAdminChanges
 */
export class TwoFactorChanges
{
	private readonly listeners = new Set<TwoFactorChangeListener>();

	/**
	 * Tells every listener that a player turned 2FA on or off
	 *
	 * @param playerId The player's ID
	 * @param on Whether they have it on now
	 */
	publish(playerId: string, on: boolean): void
	{
		for (const listener of [...this.listeners])
		{
			listener(playerId, on);
		}
	}

	/**
	 * Listens for players turning 2FA on or off
	 *
	 * @param listener Called after each change
	 * @return Stops listening
	 */
	onChange(listener: TwoFactorChangeListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}
}

/**
 * Players turning 2FA on and off, published by 2FA's routes and followed by the editor rooms
 */
export const twoFactorChanges = new TwoFactorChanges();
