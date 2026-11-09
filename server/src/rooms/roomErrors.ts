/**
 * What a client is told when a room can't be made or joined. Colyseus sends the message of whatever a
 * room's static onAuth, onCreate, onAuth or onJoin throws back to the client: in the matchmaking
 * request's answer, or as the error a joining window gets. So the rooms send only ServerErrors made to
 * be sent, and a fixed message for everything else
 */
import { ErrorCode, ServerError } from 'colyseus';

/**
 * What a client is told when a room can't be made or joined for a reason not meant for it, the same
 * whatever the reason, so it can't tell a group or universe that doesn't exist from one that does
 */
const UNEXPLAINED_ROOM_ERROR = 'The room could not be opened';

/**
 * The error a room throws to refuse making or joining it for a reason the client isn't told, such as a
 * group that doesn't exist
 *
 * @param code ErrorCode.MATCHMAKE_UNHANDLED while matchmaking (static onAuth and onCreate), or
 * ErrorCode.APPLICATION_ERROR while a window joins (onAuth and onJoin), the codes Colyseus gives an
 * error without one
 * @return The error
 */
export function unexplainedRoomError(code: number = ErrorCode.MATCHMAKE_UNHANDLED): ServerError
{
	return(new ServerError(code, UNEXPLAINED_ROOM_ERROR));
}

/**
 * Runs a step of making or joining a room, passing on what it returns and any ServerError it throws,
 * which is made to be sent to the client. Anything else it throws, such as a database error, whose
 * message holds the SQL and its values, is logged with the step, and the client gets only
 * unexplainedRoomError()
 *
 * @param step What is being done, for the log, such as "Creating game room"
 * @param code The code the client gets (unexplainedRoomError())
 * @param run The step
 * @return What the step returns
 */
export async function withoutErrorDetails<T>(step: string, code: number, run: () => Promise<T>): Promise<T>
{
	try
	{
		return(await run());
	}
	catch (error)
	{
		if (error instanceof ServerError)
		{
			throw error;
		}

		console.error(`${step} failed:`, error);
		throw unexplainedRoomError(code);
	}
}
