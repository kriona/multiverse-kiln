# Verification

A verifier takes a batch of findings it didn't make and tries to disprove each one. It reads the code paths first: the caller, the checks before the line named, the transaction or lock around it, what the client sends and what the server accepts. Only a finding that survives that is proven, with a repro test, a live check or a benchmark, where one can show it.

Verifiers never change the repository's code. They write only in the run's review folder, `scratchpad/review/{branch}/`.

## Evidence, strongest first

1. **Reproduced**: a repro test, live check or benchmark showed it. The finding links the file.
2. **Confirmed by reading**: the verifier traced the code paths and found nothing that prevents it.
3. **Plausible**: likely, but something couldn't be checked. Say what.
4. **Rejected**: something prevents it. Say what, with its file and line; the finding goes in the appendix.

A verifier may also change a finding's severity, with the reason, or mark it a duplicate of another finding in its batch (`duplicateOf`), when both have the same cause.

## Repro tests

A repro test asserts what the code should do, so it **fails while the problem is there** and passes once it is fixed. Later runs re-run it to mark the finding fixed.

- Name it `scratchpad/review/{branch}/<ID>-<name>.test.ts`, e.g. `S-003-areaRename.test.ts`.
- Its first comment says what it shows and how to run it.
- Run it from `server/`, against the verifier's own review test database: the workflow gives each verifier a slot from 1 to 4, and `TEST_REVIEW_SLOT` picks that slot's database (`kiln_review_<slot>_test`) and test server port (`server/test/reviewSlot.ts`), so verifiers running repros at once don't empty each other's database:

	```bash
	cd server && TEST_REVIEW_SLOT=<slot> npx mocha -r tsx -r ./test/setup.ts ../scratchpad/review/<branch>/<ID>-<name>.test.ts --timeout 15000
	```

	Never run it with `--parallel`, and never without `TEST_REVIEW_SLOT`: plain `kiln_test` is the user's.
- Import the repository's code by relative path from the review folder, e.g. `../../../server/test/testServer.js`.
- Use the test helpers rather than writing new ones:
	- `getTestServer()` and `testServerUrl` (`server/test/testServer.ts`): the app on a test port. Never write the port.
	- `server/test/editorRequests.ts`: `logIn()`, `send()`, `createUniverse()`, `createArea()`, `saveChanges()`, `saveChange()`, `saveAll()`.
	- `server/test/players.ts`: `addPlayer()`, `logInBrowser()`, `TestBrowsers`.
	- `server/test/db/fixtures.ts`: `addUniverse()`, `addArea()`, `addPlayableUniverse()`, `addCharacter()`, `addGroup()` and the default tile, race and class IDs.
	- Look at a test in `server/test/` that covers the same code for how it sets things up.
- Pass a clock or a time parameter instead of waiting for real time; test a rate limit with a clock passed in, never by sending requests until one is refused.
- Run it twice. A repro that only fails sometimes is evidence for a race, and says so; one that fails for another reason (a typo, a setup error) proves nothing.

## Live checks

Against the dev server and the universe in `scratchpad/kiln-review.md`, for what a repro test can't show as well: the running server with its real settings, or the real data in the review universe.

- Only through the server's HTTP routes and rooms, never with SQL.
- Only the review universe and the review accounts, whose session tokens are in the run's `.sessions.json`. Never copy a token into a finding, a script's output or any other file. Bot accounts from `POST /dev/bot-login` may stand in for extra outsiders.
- What a check adds to the universe is named `review-<ID>`, so verifiers running at once don't change each other's things. Undo what a check changed when the same routes can; say what is left.
- No load beyond what one repro needs.
- Never a browser on `www.multiversekiln.localhost` for a review account: the session cookie (`__Host-kiln-session`) is shared by every port on the host, so it would replace the user's own session.
- The user's own editor tab on the universe sees the changes, which is expected.

### HTTP

`scripts/request.mjs` sends one request as one of the accounts (or `none`, logged out) and prints the status and the JSON answer:

```bash
node --use-system-ca .agents/skills/kiln-review/scripts/request.mjs <sessions file> <owner|editor|player|outsider|none> <METHOD> <path> ['<JSON body>']
```

e.g. `... outsider GET editor/universes/<universe id>/areas`. Write the path without its leading `/`: Git Bash turns an argument starting with `/` into a Windows path. Requests without an `Origin` header are allowed, as for every client that isn't a browser.

### Rooms

A live check that joins rooms is a script in the review folder, `<ID>-<name>.ts`, run from `server/` with `npx tsx --use-system-ca ../scratchpad/review/<branch>/<ID>-<name>.ts`. It connects with `@colyseus/sdk`, putting the session cookie in its own header, as `server/loadtest/example.ts` does:

```ts
import { readFileSync } from 'node:fs';
import { Client } from '@colyseus/sdk';

const sessions = JSON.parse(readFileSync('../scratchpad/review/<branch>/.sessions.json', 'utf8'));
const serverUrl = sessions.serverUrl.replace(/^https:/, 'wss:');
const client = new Client(serverUrl, { headers: { cookie: `__Host-kiln-session=${sessions.accounts.outsider.token}` } });
```

Read the room's `onAuth` and `onJoin` for the options it takes, and the `colyseus` skill for the SDK. Leave every room before the script ends.

## Benchmarks

See `benchmarks.md`. Look for one in `scratchpad/` that covers the code first, and run it.
