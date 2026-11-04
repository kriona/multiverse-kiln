import type { BarredOptions, UniverseRole, UniverseStage } from '@multiverse-kiln/shared';

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
 * The races and classes whose characters can't play in a universe changed: a save disabled one for
 * characters already of it, or let them play again
 */
export interface BarredChange
{
	universeId: string;

	/**
	 * Every race and class barring its characters once the save committed
	 */
	barred: BarredOptions;
}

/**
 * Called after every change to what is barred
 */
export type BarredChangeListener = (change: BarredChange) => void;

/**
 * Tells the rooms when players lose the right to play a universe, so its lobby and groups turn them
 * out at once (ServerCloseCode.AccessLost), when its stage changes, so they turn out the players it
 * no longer lets play (ServerCloseCode.StageChanged) and lock or unlock, and when the races and classes
 * barring their characters change, so they stop and start letting those characters play
 *
 * Changes are published after they are saved. It lives in memory, so it only reaches rooms in the same
 * server process, like GroupChanges
 */
export class UniverseAccessChanges
{
	private readonly listeners = new Set<AccessLostListener>();

	private readonly stageListeners = new Set<StageChangeListener>();

	private readonly barredListeners = new Set<BarredChangeListener>();

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
	 * Tells every listener that the races and classes barring their characters in a universe changed
	 *
	 * @param change The universe, and what is barred now
	 */
	publishBarred(change: BarredChange): void
	{
		for (const listener of [...this.barredListeners])
		{
			listener(change);
		}
	}

	/**
	 * Listens for changes to the races and classes barring their characters
	 *
	 * @param listener Called after each change
	 * @return Stops listening
	 */
	onBarredChanged(listener: BarredChangeListener): () => void
	{
		this.barredListeners.add(listener);

		return(() =>
		{
			this.barredListeners.delete(listener);
		});
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
