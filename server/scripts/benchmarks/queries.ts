/**
 * Watches the queries the server's database clients run, for benchmarks (see
 * .agents/skills/kiln-review/references/benchmarks.md): counts them, adds a delay before each, as a network
 * between the server and the database does, and lists the slow ones
 *
 * It replaces pg.Client.prototype.query, so it sees every query, from the pool and from transactions
 * alike. Benchmarks live in scratchpad/ and import this by relative path under tsx or mocha, as
 * ../server/scripts/benchmarks/queries.js
 */
import pg from 'pg';

/**
 * A query that took at least the slow query time
 */
export interface SlowQuery
{
	/**
	 * How long it took, in milliseconds, not counting the delay added before it
	 */
	ms: number;

	/**
	 * Its SQL, cut to its first 160 characters
	 */
	text: string;
}

/**
 * What watchQueries() sees. Its settings can be changed between one part of a benchmark and the next
 */
export interface QueryWatch
{
	/**
	 * How many queries have run since the watch started or was last reset
	 */
	count: number;

	/**
	 * How long to wait before each query, in milliseconds. On Windows, setTimeout() rounds a delay of 1 ms
	 * up to about 15 ms
	 */
	delayMs: number;

	/**
	 * How long a query takes, in milliseconds, to be listed in slowQueries, or undefined to list none
	 */
	slowMs: number | undefined;

	/**
	 * Whether to print each slow query as it finishes
	 */
	printSlow: boolean;

	/**
	 * The slow queries since the watch started or was last reset
	 */
	slowQueries: SlowQuery[];

	/**
	 * Sets count back to 0 and empties slowQueries
	 */
	reset(): void;

	/**
	 * Puts back the query function the watch replaced
	 */
	restore(): void;
}

/**
 * A database client's query function, which takes text, values and a callback, a query config object, or
 * a submittable (such as a cursor)
 */
type QueryFunction = (this: pg.Client, ...args: unknown[]) => unknown;

/**
 * Settings for watchQueries()
 */
export interface QueryWatchOptions
{
	delayMs?: number;
	slowMs?: number;
	printSlow?: boolean;
}

/**
 * The query function the current watch replaced, or undefined when nothing is watching
 */
let watchedQuery: QueryFunction | undefined;

/**
 * Starts watching every query the database clients run. Only one watch runs at a time
 *
 * @param options How long to wait before each query (none when not given), how long a query takes to be
 * listed as slow (none are when not given), and whether to print slow queries as they finish
 * @return The watch, whose restore() ends it
 * @throws Error when another watch is running
 */
export function watchQueries(options: QueryWatchOptions = {}): QueryWatch
{
	if (watchedQuery)
	{
		throw new Error('Queries are already being watched: restore() the other watch first');
	}

	const prototype = pg.Client.prototype as unknown as { query: QueryFunction };
	const originalQuery = prototype.query;

	const watch: QueryWatch = {
		count: 0,
		delayMs: (options.delayMs ?? 0),
		slowMs: options.slowMs,
		printSlow: (options.printSlow ?? false),
		slowQueries: [],
		reset(): void
		{
			watch.count = 0;
			watch.slowQueries = [];
		},
		restore(): void
		{
			prototype.query = originalQuery;
			watchedQuery = undefined;
		}
	};

	/**
	 * Lists a query when it was slow
	 *
	 * @param text Its SQL
	 * @param start When it started (performance.now())
	 */
	const finished = (text: string, start: number): void =>
	{
		const ms = Math.round(performance.now() - start);

		if ((watch.slowMs === undefined) || (ms < watch.slowMs))
		{
			return;
		}

		const slow = {
			ms,
			text: text.slice(0, 160)
		};

		watch.slowQueries.push(slow);

		if (watch.printSlow)
		{
			console.log(`        ${slow.ms} ms: ${slow.text}`);
		}
	};

	/**
	 * Counts a query, waits the delay, then runs it, timing it
	 *
	 * @param args The query's arguments
	 * @return What the query function returns
	 */
	prototype.query = function watchedQueryFunction(this: pg.Client, ...args: unknown[]): unknown
	{
		const first = args[0];

		// A submittable is returned to the caller to read from, so it can't wait behind a promise
		if ((typeof first === 'object') && (first !== null) && (typeof (first as { submit?: unknown }).submit === 'function'))
		{
			return(originalQuery.apply(this, args));
		}

		watch.count++;

		const configText = (first as { text?: unknown } | null)?.text;
		const text = ((typeof first === 'string') ? first : ((typeof configText === 'string') ? configText : ''));
		const callback = args[args.length - 1];

		/**
		 * Runs the query, timing it
		 *
		 * @return What the query function returns
		 */
		const run = (): unknown =>
		{
			const start = performance.now();

			// The pool runs its queries with a callback, and transactions with a promise
			if (typeof callback === 'function')
			{
				const timedArgs = [...args];

				timedArgs[timedArgs.length - 1] = (...results: unknown[]): unknown =>
				{
					finished(text, start);
					return((callback as (...callbackArgs: unknown[]) => unknown)(...results));
				};

				return(originalQuery.apply(this, timedArgs));
			}

			return((originalQuery.apply(this, args) as Promise<unknown>)
				.finally(() => finished(text, start)));
		};

		if (watch.delayMs <= 0)
		{
			return(run());
		}

		if (typeof callback === 'function')
		{
			setTimeout(run, watch.delayMs);
			return(undefined);
		}

		return(new Promise((resolve) => setTimeout(resolve, watch.delayMs))
			.then(run));
	};

	watchedQuery = originalQuery;

	return(watch);
}
