# Benchmarks

A performance finding is measured when a benchmark shows it, and suspected otherwise. Measured numbers are only for comparing before and after on the same machine: the dev server and the other agents share it.

- Before writing a benchmark, look for one in `scratchpad/` that covers the code, and run it.
- A new benchmark goes in `scratchpad/review/{branch}/` as `<ID>-<name>.<ext>`. Its first comment says what it measures and how to run it.
- Every new benchmark uses the helpers in `server/scripts/benchmarks/`:
	- `timing.ts`: `averageMs(run, times)` times a function that isn't async; `time(label, run, times = 20)` times one that may be, prints the average and returns the last run's result.
	- `queries.ts`: `watchQueries({ delayMs, slowMs, printSlow })` counts every query the database clients run, waits `delayMs` before each (as a network between the server and Neon does; on Windows `setTimeout()` rounds 1 ms up to about 15 ms), and lists the queries slower than `slowMs`. The watch's `count`, `slowQueries`, `delayMs` and `slowMs` can be read and changed as the benchmark goes; `reset()` starts counting again and `restore()` ends the watch.
- Benchmarks that write in bulk use a review test database, so the review universe doesn't fill with benchmark data.
- Run before and after a fix the same way, and report both numbers.

## The three kinds

| Kind | Example | Runs against | For |
|---|---|---|---|
| Plain Node on `shared/dist` | `scratchpad/benchmarks.mjs` | nothing | parsers, hashing, pure logic |
| Mocha with the test setup | `scratchpad/translationSaveBench.test.ts` | a review test database | anything that writes: saves, drafts, query counts |
| tsx with the dev `.env` | `scratchpad/translationListBench.ts` | the local database, the review universe | reads on realistic data |

### Plain Node on `shared/dist`

Build `shared` first (`npm run build -w shared`). Node runs `timing.ts` itself, stripping its types.

```js
// What it measures. Run from the repository root: node scratchpad/review/<branch>/<ID>-<name>.mjs
import { averageMs } from '../../../server/scripts/benchmarks/timing.ts';
import { readTranslationFile } from '../../../shared/dist/translationFiles.js';

// ... makeText(count) builds an input of count entries

for (const count of [500, 1000, 2000, 4000])
{
	const text = makeText(count);

	console.log(count + ': ' + averageMs(() => readTranslationFile('po', text), 5).toFixed(1) + ' ms');
}
```

Double the input each step: time that doubles is linear, time that quadruples grows with the square of the input.

### Mocha with the test setup

For anything that writes. Run from `server/` in the verifier's review slot (see `verification.md`), with a long timeout:

```bash
cd server && TEST_REVIEW_SLOT=<slot> npx mocha -r tsx -r ./test/setup.ts ../scratchpad/review/<branch>/<ID>-<name>.test.ts --timeout 600000
```

```ts
// What it measures. Run from server/: TEST_REVIEW_SLOT=<slot> npx mocha -r tsx -r ./test/setup.ts ../scratchpad/review/<branch>/<ID>-<name>.test.ts --timeout 600000
import { watchQueries } from '../../../server/scripts/benchmarks/queries.js';
import { createUniverse, logIn, saveChanges } from '../../../server/test/editorRequests.js';
import { getTestServer } from '../../../server/test/testServer.js';

describe('<ID> benchmark', () =>
{
	before(async () =>
	{
		await getTestServer();
	});

	for (const delayMs of [0, 1])
	{
		it(`saves ..., with ${delayMs} ms added to each query`, async () =>
		{
			const ada = await logIn('Ada');
			const universeId = await createUniverse(ada, 'Benchmark');
			const queries = watchQueries({ delayMs, slowMs: 10, printSlow: true });

			try
			{
				const start = performance.now();

				await saveChanges(ada, universeId, [/* ... */]);
				console.log(`      ${Math.round(performance.now() - start)} ms, ${queries.count} queries`);
			}
			finally
			{
				queries.restore();
			}
		});
	}
});
```

The database is emptied before each test, so each `it()` sets up what it times.

### tsx with the dev `.env`

For reads on realistic data, against the local database and the review universe. Only reads: never write to the dev database from a benchmark.

```bash
cd server && npx tsx --env-file-if-exists=.env ../scratchpad/review/<branch>/<ID>-<name>.ts "<universe name>"
```

```ts
// What it measures. Run from server/: npx tsx --env-file-if-exists=.env ../scratchpad/review/<branch>/<ID>-<name>.ts "<universe name>"
import { time } from '../../../server/scripts/benchmarks/timing.js';
import { listAreas } from '../../../server/src/db/areaRepo.js';
import { pool } from '../../../server/src/db/client.js';

// ... find the universe's ID through a repository, by name

await time('warm up', () => listAreas(version));
await time('listAreas', () => listAreas(version));

await pool.end();
```
