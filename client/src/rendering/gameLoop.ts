import Phaser from 'phaser';

/**
 * Puts a game's loop to sleep once it has drawn one more frame, for a game that has stopped its scene: that
 * frame clears the canvas to the game's background, and the loop then stops waking the browser every
 * frame to draw nothing
 *
 * A game still booting is left alone, since its loop hasn't started yet
 *
 * @param game The game
 */
export function sleepGameLoop(game: Phaser.Game): void
{
	if (!game.isRunning)
	{
		return;
	}

	game.events.off(Phaser.Core.Events.POST_RENDER, sleepAfterFrame, game);
	game.events.once(Phaser.Core.Events.POST_RENDER, sleepAfterFrame, game);
}

/**
 * Wakes a game's loop before it starts a scene, and keeps a sleep asked for since then from happening
 *
 * @param game The game
 */
export function wakeGameLoop(game: Phaser.Game): void
{
	game.events.off(Phaser.Core.Events.POST_RENDER, sleepAfterFrame, game);

	if (game.isRunning)
	{
		game.loop.wake();
	}
}

/**
 * Puts the game the event came from to sleep, once the frame is drawn
 *
 * @param this The game
 */
function sleepAfterFrame(this: Phaser.Game): void
{
	this.loop.sleep();
}
