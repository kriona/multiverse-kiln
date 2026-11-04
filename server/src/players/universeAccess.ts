import type { UniverseRole, UniverseStage } from '@multiverse-kiln/shared';

/**
 * A change to who may play a universe: players whose role in it was changed or taken away so that they
 * may no longer play it in its stage
 */
export interface AccessLost
{
	universeId: string;
	playerIds: ReadonlySet<string>;
}

/**
 * Called after every change
 */
export type AccessLostListener = (change: AccessLost) => void;

/**
 * A universe's stage changed, which can change who may play it and lock or unlock its groups
 */
export interface StageChange
{
	universeId: string;
	stage: UniverseStage;

	/**
	 * Every editor's role once the save that changed the stage committed, by player ID; players without
	 * one aren't in it
	 */
	roles: ReadonlyMap<string, UniverseRole>;
}

/**
 * Called after every stage change
 */
export type StageChangeListener = (change: StageChange) => void;

/**
 * Tells the rooms when players lose the right to play a universe, so its lobby and groups turn them
 * out at once (ServerCloseCode.AccessLost), and when its stage changes, so they turn out the players it
 * no longer lets play (ServerCloseCode.StageChanged) and lock or unlock
 *
 * Changes are published after they are saved. It lives in memory, so it only reaches rooms in the same
 * server process, like GroupChanges
 */
export class UniverseAccessChanges
{
	private readonly listeners = new Set<AccessLostListener>();

	private readonly stageListeners = new Set<StageChangeListener>();

	/**
	 * Tells every listener about players who lost the right to play a universe
	 *
	 * @param change The universe and the players
	 */
	publish(change: AccessLost): void
	{
		if (change.playerIds.size === 0)
		{
			return;
		}

		for (const listener of [...this.listeners])
		{
			listener(change);
		}
	}

	/**
	 * Tells every stage listener that a universe's stage changed
	 *
	 * @param change The universe, its new stage and its editors' roles
	 */
	publishStage(change: StageChange): void
	{
		for (const listener of [...this.stageListeners])
		{
			listener(change);
		}
	}

	/**
	 * Listens for players losing the right to play a universe
	 *
	 * @param listener Called after each change
	 * @return Stops listening
	 */
	onLost(listener: AccessLostListener): () => void
	{
		this.listeners.add(listener);

		return(() =>
		{
			this.listeners.delete(listener);
		});
	}

	/**
	 * Listens for universes' stages changing
	 *
	 * @param listener Called after each change
	 * @return Stops listening
	 */
	onStageChanged(listener: StageChangeListener): () => void
	{
		this.stageListeners.add(listener);

		return(() =>
		{
			this.stageListeners.delete(listener);
		});
	}
}

/**
 * The server's access changes, published by the editor's save and followed by the lobbies and game rooms
 */
export const universeAccessChanges = new UniverseAccessChanges();
