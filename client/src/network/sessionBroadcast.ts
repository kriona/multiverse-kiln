/**
 * Tells this browser's other tabs that it logged in
 *
 * A window joins the session room once, as it loads, so a window opened while the browser was logged
 * out stays that way after another tab logs in. The tab that logs in says so here, and logged-out
 * pages that hear it load again, logged in. Logging out needs no broadcast: the server tells every
 * window of the session itself
 */

/**
 * The channel's name, the same in every tab
 */
const CHANNEL_NAME = 'kiln-session';

/**
 * The message saying the browser logged in
 */
const LOGGED_IN = 'loggedIn';

/**
 * Whether this tab logged the browser in. A channel hears the messages of other channels in its own
 * tab too, so this tab ignores its own announcement
 */
let loggedInHere = false;

/**
 * Tells the browser's other tabs that it has logged in
 */
export function announceLogin(): void
{
	loggedInHere = true;

	const channel = new BroadcastChannel(CHANNEL_NAME);

	channel.postMessage(LOGGED_IN);
	channel.close();
}

/**
 * Listens for another tab logging the browser in
 *
 * @param listener Called when it does
 * @return Stops listening
 */
export function onLoginElsewhere(listener: () => void): () => void
{
	const channel = new BroadcastChannel(CHANNEL_NAME);

	channel.addEventListener('message', (event: MessageEvent) =>
	{
		if ((event.data === LOGGED_IN) && !loggedInHere)
		{
			listener();
		}
	});

	return(() =>
	{
		channel.close();
	});
}
