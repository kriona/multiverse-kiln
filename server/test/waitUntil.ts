/**
 * Resolves once a condition is true, checking every few milliseconds
 *
 * For server-side effects with no event to wait on, such as onLeave after a room has emptied (an empty
 * room is disposed, so waiting for its next timestep would never resolve)
 *
 * @param condition Returns true when the wait is over
 * @param timeoutMs How long to wait before failing
 */
export async function waitUntil(condition: () => boolean, timeoutMs: number = 2000): Promise<void>
{
	const deadline = Date.now() + timeoutMs;

	while (!condition())
	{
		if (Date.now() > deadline)
		{
			throw new Error(`condition not met within ${timeoutMs}ms`);
		}

		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
