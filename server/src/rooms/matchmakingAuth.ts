/**
 * The check matchmaking runs before it makes a room that only logged-in browsers may join
 */
import { ErrorCode, type AuthContext } from 'colyseus';

import { resolveSession } from '../auth/sessions.js';
import { withoutErrorDetails } from './roomErrors.js';

/**
 * Whether a matchmaking request comes from a logged-in browser. A room class's static onAuth calls it:
 * matchmaking runs the static onAuth before it makes a room, while the instance onAuth only runs once
 * the window connects to a room already made and its onCreate already run. Refusing here stops anyone
 * who isn't logged in making the server load rooms and start their ticks
 *
 * It returns true rather than the session because Colyseus skips the instance onAuth when the static
 * one returns anything else, and the instance onAuth has to look the window up in full and mark where
 * its lookup starts (JoinChanges). A failure looking the session up, such as a database error, tells
 * the client nothing of what went wrong (withoutErrorDetails())
 *
 * @param context The matchmaking request's headers, which carry the session cookie
 * @return Whether the browser is logged in
 */
export async function isLoggedInToMatchmake(context: AuthContext): Promise<boolean>
{
	return(withoutErrorDetails('Checking the session to matchmake', ErrorCode.MATCHMAKE_UNHANDLED, async () => ((await resolveSession(context.headers.get('cookie'))) !== undefined)));
}
