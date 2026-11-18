# Fixing findings

`/kiln-review fix` gives each group of findings to an agent, one agent at a time. This is that agent's guide. The main session reviews what you change, commits it and marks the findings fixed; you only change the code.

## Rules

- Never commit or stage, and never run a git command that changes the working tree, the index or the stash: no `commit`, `add`, `stash`, `checkout`, `switch`, `reset`, `restore`, `rebase` or `merge`. Read-only git (`status`, `diff`, `log`, `show`, `blame`) is fine.
- Don't edit the findings files (`bugs.md`, `security.md` and so on) or any other note in `scratchpad/`. Repro tests and benchmarks in the review folder may be run, not changed.
- Follow `CLAUDE.md` and the global code style: the Edit tool for every change, tabs, CRLF, Allman braces, docblocks on new functions, comments that describe the code as it is now, American spelling, and the rules for messages, accessibility and the editor's staged saves.
- Load the skill an area needs before changing it: `colyseus` for rooms and Schema, the Phaser skills for Phaser code, `modern-web-guidance` for the pages' HTML, SCSS and DOM code.
- Fix the cause, everywhere it happens. Look for the same pattern in the sibling routes, rooms, repositories and pages, fix those too, and list them in the report.
- Fix only the findings you were given. Report anything else you notice instead of fixing it.
- If a fix would change a design decision in `STRUCTURE-OVERVIEW.md` or `PLAN.md`, or there are two reasonable fixes that players would notice the difference between, don't choose: stop and report the question. When a fix changes something `STRUCTURE-OVERVIEW.md` describes, update it.

## Steps

1. Read each finding in its file, by ID, and the code at its Where and around it. The finding's Fix is a suggestion: use it when it's right, and a better one when it isn't.
2. Before changing anything, run the finding's repro test or benchmark, if its Evidence names one, and check that it still shows the problem. A repro test runs from `server/` on the review slot you were given:

	```bash
	cd server && TEST_REVIEW_SLOT=<slot> npx mocha -r tsx -r ./test/setup.ts ../scratchpad/review/<branch>/<ID>-<name>.test.ts --timeout 15000
	```

	For a benchmark, keep its numbers. If the repro passes before any change, stop and report the finding as no longer reproducing.
3. Fix it.
4. A bug or security fix gets a test in the suite (`server/test/`) that fails without the fix, unless an existing test already covers it; adapting the repro test is fine. Follow `CLAUDE.md`'s rules for tests: the test database, no waiting for real time.
5. Check it:
	- The repro test passes, or the benchmark shows the improvement.
	- The suite's tests for the code you changed pass, run as in step 2 with `test/<name>.test.ts`. Never run tests with `--parallel` or without `TEST_REVIEW_SLOT`.
	- Rebuild what you changed: `npm run build -w shared` for `shared/`, `npm run build -w client` for the client's TypeScript and SCSS, `npm run typecheck -w server` for the server.
	- After changing messages, `npm run messages`, and update Pirate with the `translate` skill when it warns.
	- `npm run lint` passes.
6. Reply with a short report, about 15 lines at most:
	- each finding's ID and its result: fixed, not fixed (why), no longer reproduces, or needs a decision (the question)
	- every file you changed or added, as paths from the repository root
	- the repro before and after, and a benchmark's numbers before and after
	- the tests you added, and the tests, builds and lint you ran, with their results
	- other places you fixed the same problem
	- a commit message: one line of about 50 to 70 characters saying what changed for players or the code, without the cause, the mechanism or file names
