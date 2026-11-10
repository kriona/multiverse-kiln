import Phaser from 'phaser';

/**
 * The data each scene is to start again with once it has been created, for scenes asked to start while
 * they were still starting
 */
const waitingData = new WeakMap<Phaser.Scene, object>();

/**
 * Starts a game's scene afresh with new data, as game.scene.start() does, even while the scene is still
 * starting: Phaser ignores a start between the scene's START and its create() (such as while its
 * preload() loads images), so then the scene starts again with the latest data as soon as it has been
 * created. A scene stopped before it is created forgets the data it was waiting with
 *
 * @param game The game
 * @param key The scene's key
 * @param data The data the scene starts with
 */
export function startScene(game: Phaser.Game, key: string, data: object): void
{
	const scene = (game.scene.isBooted ? game.scene.getScene(key) : null);
	const status = scene?.sys.settings.status;

	if (!scene || (status === undefined) || (status < Phaser.Scenes.START) || (status > Phaser.Scenes.CREATING))
	{
		// A start before the game has booted replaces the data the scene was added with
		if (scene)
		{
			waitingData.delete(scene);
		}

		game.scene.start(key, data);
		return;
	}

	const waiting = waitingData.has(scene);

	waitingData.set(scene, data);

	if (waiting)
	{
		return;
	}

	const events = scene.sys.events;

	/**
	 * Starts the scene again with the latest data once its create() has run. The start waits for the
	 * create event to finish, since Phaser emits it from inside the scene's start, and is dropped when
	 * the scene is stopped or started afresh in the meantime
	 */
	const onCreate = (): void =>
	{
		setTimeout(() =>
		{
			const latest = waitingData.get(scene);

			events.off(Phaser.Scenes.Events.SHUTDOWN, onShutdown);

			if (latest)
			{
				startScene(game, key, latest);
			}
		}, 0);
	};

	/**
	 * Forgets the data the scene was waiting with, once it has been stopped, or started afresh after
	 * it was created
	 */
	const onShutdown = (): void =>
	{
		events.off(Phaser.Scenes.Events.CREATE, onCreate);
		waitingData.delete(scene);
	};

	events.once(Phaser.Scenes.Events.CREATE, onCreate);
	events.once(Phaser.Scenes.Events.SHUTDOWN, onShutdown);
}
