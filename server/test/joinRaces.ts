/**
 * Makes a change while a window is joining a room: after the room's onAuth has looked the window up,
 * before the window is among the room's clients, which is the race JoinChanges covers
 */

/**
 * Makes a room's next call of one of its methods make a change once the call has read what it reads,
 * before the call returns. The method then goes back to what it was, so a later lookup reads the
 * change
 *
 * @param room The server-side room
 * @param method The name of the method onAuth looks the window up with
 * @param change Makes the change, and publishes it as its route would
 */
export function changeDuringNextLookup(room: object, method: string, change: () => Promise<void>): void
{
	const methods = room as Record<string, unknown>;
	const original = methods[method];

	if (typeof original !== 'function')
	{
		throw new Error(`The room has no method ${method}`);
	}

	const lookUp = original as (...args: unknown[]) => Promise<unknown>;

	methods[method] = async (...args: unknown[]): Promise<unknown> =>
	{
		delete methods[method];

		const found = await lookUp.apply(room, args);

		await change();

		return(found);
	};
}

/**
 * Whether a join was refused with a close code, for assert.rejects
 *
 * @param code The code
 * @return Checks the error the join rejected with
 */
export function refusedWith(code: number): (error: unknown) => boolean
{
	return((error: unknown) => ((error as { code?: unknown }).code === code));
}
