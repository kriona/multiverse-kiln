/**
 * Leaving a page and coming back to it with the browser's back and forward buttons
 *
 * Browsers keep a page that is left in their back-forward cache, frozen as it was, and closing its
 * WebSocket on the way in. Coming back shows that page again without loading it, with its connection
 * to the server gone, so pages that connect reload instead, and don't report the connection closing
 * while they are being left
 */

/**
 * Whether the page is being left: true from pagehide until the page shows again
 */
let leaving = false;

/**
 * Starts following the page as it is left and shown again: a page shown again from the back-forward
 * cache reloads, so it connects to the server afresh
 */
export function startPageLifecycle(): void
{
	window.addEventListener('pagehide', () =>
	{
		leaving = true;
	});

	window.addEventListener('pageshow', (event) =>
	{
		leaving = false;

		if (event.persisted)
		{
			window.location.reload();
		}
	});
}

/**
 * Whether the page is being left, so a connection closing now is the browser's doing, not a problem to report
 *
 * @return True from the moment the page starts to be left until it is shown again
 */
export function isLeavingPage(): boolean
{
	return(leaving);
}
