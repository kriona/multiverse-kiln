import { format } from 'node:util';

/**
 * Runs code, keeping what it logs with console.error out of the test's output and returning it, for a
 * test that checks what the server logs when it hides an error from the client
 *
 * @param run The code
 * @return Each console.error call's text, as console.error would print it
 */
export async function loggedErrors(run: () => Promise<unknown>): Promise<string[]>
{
	const consoleError = console.error;
	const logged: string[] = [];

	console.error = (...values: unknown[]) =>
	{
		logged.push(format(...values));
	};

	try
	{
		await run();
	}
	finally
	{
		console.error = consoleError;
	}

	return(logged);
}
