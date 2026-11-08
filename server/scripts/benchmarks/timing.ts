/**
 * Timing code for benchmarks (see .agents/skills/kiln-review/references/benchmarks.md). Benchmarks live in
 * scratchpad/ and import this by relative path: ../server/scripts/benchmarks/timing.ts from plain Node,
 * which runs it by stripping its types, or timing.js under tsx and mocha
 *
 * Times are only for comparing before and after on the same machine: the dev server and anything else
 * running share it
 */

/**
 * How long a function takes, on average over a number of runs
 *
 * @param run The function
 * @param times How many times to run it
 * @return The average time, in milliseconds
 */
export function averageMs(run: () => unknown, times: number): number
{
	const start = performance.now();

	for (let index = 0; index < times; index++)
	{
		run();
	}

	return((performance.now() - start) / times);
}

/**
 * Runs a function, which may be async, a number of times one after another, and prints the average
 * time it took after a label
 *
 * @param label What is being timed
 * @param run The function
 * @param times How many times to run it (20 when not given)
 * @return What the last run returned
 */
export async function time<T>(label: string, run: () => Promise<T> | T, times: number = 20): Promise<T>
{
	let result!: T;
	const start = performance.now();

	for (let index = 0; index < times; index++)
	{
		result = await run();
	}

	console.log(`${label.padEnd(32)} ${((performance.now() - start) / times).toFixed(2)} ms`);

	return(result);
}
