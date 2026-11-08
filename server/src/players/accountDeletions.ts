/**
 * Called after a player's account is deleted
 */
export type AccountDeletedListener = (playerId: string) => void;

/**
 * Tells the rooms when a player's account is deleted. The rooms with a chat then take the player's name
 * off the messages they hold, and tell their windows to (see Deleting an account in STRUCTURE-OVERVIEW.md)
 *
 * Deletions are published after they are saved. It lives in memory, so it only reaches rooms in the same
 * server process, like ServerAdminChanges
 */
export class AccountDeletions
{
	private readonly listeners = new Set<AccountDeletedListener>();

	/**
	 * Tells every listener that a player's account was deleted
	 *
	 * @param playerId The player's ID
	 */
	publish(playerId: string): void
	{
		for (const listener of [...this.listeners])
		{
			listener(playerId);
		}
	}

	/**
	 * Listens for accounts being deleted
	 *
	 * @param listener Called after each deletion
	 * @return Stops listening
	 */
	onDeleted(listener: AccountDeletedListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}
}

/**
 * The accounts deleted, published by the account deletion route and followed by the rooms with a chat
 */
export const accountDeletions = new AccountDeletions();
