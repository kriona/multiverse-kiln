/**
 * Leaving a page and coming back to it with the browser's back and forward buttons
 *
 * Browsers keep a page that is left in their back-forward cache, frozen as it was. Its WebSockets may be
 * closed on the way in, or stay open with the browser still answering the server's pings, so the server
 * would go on counting a frozen page as a window that is open. Every room the page joins
 * (network/serverConnection.ts) is left as the page is left. Coming back shows the page again without
 * loading it, so pages that connect reload instead, and don't report the connection closing while they
 * are being left
 */

/**
 * A joined room, as leaveOnPageHide() needs it
 */
interface LeavableRoom
{
	connection: { isOpen: boolean };

	leave(): Promise<unknown>;

	onLeave(callback: () => void): unknown;
}

/**
 * Whether the page is being left: true from pagehide until the page shows again
 */
let leaving = false;

/**
 * The rooms the page has joined and not yet left
 */
const openRooms = new Set<LeavableRoom>();

/**
 * Whether pagehide leaves the open rooms yet; it starts with the first room joined
 */
let leavingRoomsOnHide = false;

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
 * Leaves a joined room as the page is left, so the server takes this window off the room at once rather
 * than keeping it while the page sits in the back-forward cache
 *
 * @param room The room, just joined
 */
export function leaveOnPageHide(room: LeavableRoom): void
{
	if (!leavingRoomsOnHide)
	{
		leavingRoomsOnHide = true;
		window.addEventListener('pagehide', leaveOpenRooms);
	}

	openRooms.add(room);
	room.onLeave(() =>
	{
		openRooms.delete(room);
	});
}

/**
 * Leaves every room the page has joined and not yet left
 */
function leaveOpenRooms(): void
{
	for (const room of openRooms)
	{
		if (room.connection.isOpen)
		{
			void room.leave();
		}
	}

	openRooms.clear();
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
