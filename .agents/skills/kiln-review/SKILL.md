---
name: kiln-review
description: "Reviews the branch's changes, or the whole repository with full, in four passes (bugs, security, performance and the repository's own rules), checks every finding with an agent that didn't make it, proves findings against running code where it can, and writes numbered findings to scratchpad/. Use when the user runs /kiln-review, optionally naming full and any of bugs, security, performance and rules."
disable-model-invocation: true
---
# Kiln review

Reviews the code in up to four passes, has every finding checked by a verifier that didn't make it, and writes one file of numbered findings per pass to `scratchpad/`. The reviewers and verifiers run in one workflow, `.claude/workflows/review-passes.js`; this skill does the setup before it and writes the files after it.

Running `/kiln-review` is the user's opt-in to the workflow it starts: call the Workflow tool in step 6 without asking again.

## Arguments

`/kiln-review [full] [bugs] [security] [performance] [rules]`

- No arguments: diff mode, all four passes.
- Passes named: only those passes, e.g. `/kiln-review security` or `/kiln-review bugs performance`.
- `full`: the whole repository, with all four passes whatever else is named. Used sparingly, such as before publishing a major version. It may run well over 10 agents; say how many before starting it.

Diff mode reviews the branch's changes: from the merge-base with `main` to the working tree, uncommitted and untracked files included. It runs at most 10 agents: up to 6 reviewers and up to 4 verifiers.

## Files this skill uses

| Path | What |
|---|---|
| `scratchpad/kiln-review.md` | The settings (universe and accounts) and the Runs table, one per copy of the code. No passwords or session tokens |
| `scratchpad/{branch}-{pass}.md` | A run's findings for one pass. `/` in the branch name becomes `-`. A later run on the branch adds `-2`, `-3` and so on |
| `scratchpad/review/{branch}/` | Repro tests, live checks and benchmarks, kept for later runs, named `<ID>-<name>.<ext>` |
| `scratchpad/review/{branch}/.sessions.json` | The run's session tokens, for the verifiers. Deleted when the run ends. Never copy a token anywhere else |
| `references/areas.md` | The areas, their paths and which passes review each |
| `references/checklists.md` | What each pass looks for |
| `references/verification.md` | Evidence levels, repro tests, live checks |
| `references/benchmarks.md` | The three kinds of benchmark |
| `scripts/request.mjs` | Sends one HTTP request to the dev server as one of the review's accounts |

`CLAUDE.md` lets the review change a finding's status in review notes and add to `scratchpad/kiln-review.md`. Every other note in `scratchpad/` is left alone. The older notes (`bugs.txt`, `performance.txt`, `security.txt`) mark fixes with `(✅Fixed)`; keep that style when editing them.

## Steps

### 1. Settings

Read `scratchpad/kiln-review.md`.

- If it's missing, or a value is missing, ask the user in one message for the review universe's name and the usernames of the four review accounts, then stop until they answer:
	- **owner**: the universe's creator (role `creator`)
	- **editor**: a builder in it (role `builder`)
	- **player**: an account with no role in it, which plays it
	- **outsider**: an account with no role in it, used to try what it shouldn't reach

	The universe is one the review may change: live checks add and change things in it. The accounts must already exist; the review never creates accounts. Then write the file (format below).
- If the values are there, show them and ask to confirm with AskUserQuestion, using these values (Recommended) first and changing them second.

### 2. Check the environment

- The dev server answers its health route. Its address is `VITE_SERVER_URL` in `client/.env` with `wss://` turned into `https://` (`https://www.multiversekiln.localhost:2567` by default):

	```bash
	node --use-system-ca -e "fetch(process.argv[1] + '/health').then((response) => console.log(response.status), (error) => console.log(error.message))" https://www.multiversekiln.localhost:2567
	```

	If it doesn't answer 200, ask the user to start it (`npm run dev`) and stop.
- Build `shared` (`npm run build -w shared`), so benchmarks importing `shared/dist` time the current code.
- Tell the user that the dev server runs `tsx watch` and restarts when server files are saved, so they shouldn't edit server files while the run's live checks are going.

### 3. Sessions

For each of the four accounts, from the repository root:

```bash
npm run --silent review:session -w server -- <username>
```

It prints `{ "token": "...", "playerId": "..." }`. It refuses to run unless `ENABLE_DEV_TOOLS` is on and `DATABASE_URL` is a database on this computer; if it refuses, stop and tell the user why. If it says an account doesn't exist, ask the user for another username.

Write `scratchpad/review/{branch}/.sessions.json`:

```json
{
	"serverUrl": "https://www.multiversekiln.localhost:2567",
	"universe": { "id": "...", "name": "...", "slug": "..." },
	"accounts": {
		"owner": { "username": "...", "playerId": "...", "token": "..." },
		"editor": { "username": "...", "playerId": "...", "token": "..." },
		"player": { "username": "...", "playerId": "...", "token": "..." },
		"outsider": { "username": "...", "playerId": "...", "token": "..." }
	}
}
```

Then check the universe and the roles with `GET /editor/universes`, which lists the universes an account has a role in:

```bash
node --use-system-ca .agents/skills/kiln-review/scripts/request.mjs scratchpad/review/{branch}/.sessions.json owner GET editor/universes
```

The path has no leading `/`, since Git Bash turns an argument starting with `/` into a Windows path.

- The owner's list has the universe, by name, with role `creator`. Take its `id` and `slug` from there for `.sessions.json`.
- The editor's list has it with role `builder`.
- Neither the player's nor the outsider's list has it.

If a check fails, end the sessions (step 9), tell the user what is wrong and stop.

### 4. The files to review

- Diff mode:
	```bash
	git merge-base main HEAD
	git diff --name-only <merge-base>
	git ls-files --others --exclude-standard
	```
	The first list is every file changed between the merge-base and the working tree, committed or not; the second is the untracked files.
- Full mode: the whole repository (as if diffed against git's empty tree, so every file counts as changed). Give the reviewers each area's paths rather than every file.
- Map each file to its area with `references/areas.md`. Leave out the areas no pass that is running reviews, and the files the table says aren't reviewed.

If no files are left, say so, end the sessions and stop.

### 5. The previous run

Find this branch's last run in the Runs table of `kiln-review.md`, and read its files.

- For each finding whose Status is `open`:
	- If it has a repro test, live check or benchmark, run it again (see `references/verification.md` and `references/benchmarks.md`). A repro test fails while the problem is there.
		- It still fails, or the benchmark still shows the problem: leave the Status `open` and note it for the header ("still reproduces").
		- It passes, and the code at its Where has changed since that run's commit: `fixed (reproduced before, not after: <repro file>, <commit>)`.
		- It passes, and that code hasn't changed: `no longer reproduces`.
	- If it was only confirmed by reading, read the code at its Where again. If the problem is gone, `fixed (confirmed by reading, <commit>)`; otherwise leave it open.
	- Change only the Status line of each finding (CLAUDE.md allows this).
- Collect the findings still open (ID, pass, title, Where), so the reviewers don't report them again.
- IDs continue across runs on a branch: each pass's numbers start after the highest ID in any of that pass's files for the branch, so "fix B-003" never means two findings. Work out the next free number for each pass (`B`, `S`, `P`, `R`).

### 6. Review and verify: run the workflow

Call the Workflow tool with `scriptPath: ".claude/workflows/review-passes.js"` and these `args` (as a JSON object, not a string):

```json
{
	"mode": "diff",
	"passes": ["bugs", "security", "performance", "rules"],
	"branch": "phase-15",
	"branchSlug": "phase-15",
	"commit": "d7fe432",
	"mergeBase": "1a2b3c4",
	"areas": [
		{ "name": "http", "files": ["server/src/http/editorAreas.ts"] }
	],
	"untracked": ["server/src/http/newRoute.ts"],
	"universe": { "id": "...", "name": "Scratchpad", "slug": "scratchpad" },
	"accounts": { "owner": "...", "editor": "...", "player": "...", "outsider": "..." },
	"serverUrl": "https://www.multiversekiln.localhost:2567",
	"sessionsFile": "scratchpad/review/phase-15/.sessions.json",
	"reviewDir": "scratchpad/review/phase-15",
	"openFindings": [
		{ "id": "S-001", "pass": "security", "title": "...", "where": "server/src/http/editorAreas.ts:212" }
	],
	"nextIds": { "bugs": 1, "security": 4, "performance": 1, "rules": 1 }
}
```

- `areas` lists only the areas being reviewed, each with its files (diff mode) or its paths (full mode, where `mergeBase` is omitted). Which passes review each area is in the workflow, from the table in `references/areas.md`; keep the two the same.
- `accounts` holds usernames only. The tokens stay in `sessionsFile`.

The workflow runs the reviewers, then the verifiers, and returns:

- `findings`: each with its ID, pass, severity, title, Where, description, "fails when", fix, and the verifier's verdict (`reproduced`, `confirmed`, `plausible` or `rejected`), evidence, repro file and, for performance, whether it was measured
- `notReviewed`: the (pass, areas) whose reviewer didn't finish
- `agents`: how many agents ran

Reviewers never edit code, and verifiers write only in `reviewDir`.

### 7. Write the files

One file per pass that ran, even with no findings, named as in "Files this skill uses". In each:

- The header (below).
- The findings that weren't rejected, most severe first, then by ID.
- A problem found by two passes (the verifier's `duplicateOf`, or the same Where and cause) is written once, in the pass it fits best, with an `Also:` line; the other pass's file has a short entry that only points at it.
- An appendix, `## Rejected`, with each rejected finding's ID, title and the verifier's reason.
- A verdict the verifier changed the severity of says so in its Evidence line.

Report everything that survived verification; don't drop low findings.

### 8. Finish

- End each session the run made, then delete `.sessions.json`:
	```bash
	npm run --silent review:session -w server -- --end <token>
	```
- Add the run to the Runs table in `kiln-review.md`.
- Tell the user each file's path, its counts by severity, the earlier findings' new statuses, anything not reviewed, and anything the live checks added to the review universe (named `review-<ID>`).

If the run stops early at any step after sessions were made, still end them and delete `.sessions.json`.

## Output format

### Header

```markdown
# Security review: phase-15

- Commit: d7fe432 (plus uncommitted changes)
- Date: 2026-11-07
- Scope: diff from merge-base 1a2b3c4 (12 files) | full repository
- Areas reviewed: http, auth, rooms
- Areas not reviewed: client (no changes)
- Findings: critical 0, high 1, medium 2, low 1 (3 rejected)
- Earlier findings: S-001 fixed, S-002 still reproduces
```

The passes' titles are Bugs, Security, Performance and Rules.

### A finding

```markdown
### S-003 (high): Editors can rename areas in universes they don't edit

- Status: open
- Evidence: reproduced (scratchpad/review/phase-15/S-003-areaRename.test.ts)
- Where: server/src/http/editorAreas.ts:212
- Also: B-007 (the same missing check, as a bug)

A player with an editor role in one universe can send an area ID from another universe in a save, and the rename is saved there.

Fails when: player A edits universe 1 and sends a save for universe 1 whose change names area 40, which belongs to universe 2.

Fix: check that each area in the save belongs to the save's universe, in the same query that locks it.
```

- IDs: `B-` bugs, `S-` security, `P-` performance, `R-` rules, then three digits.
- Evidence: `reproduced (<file>)`, `confirmed by reading`, or `plausible (<what couldn't be checked>)`. A performance finding adds `measured` with its numbers, or `suspected`.
- `Also:` only when another finding covers the same problem.

### Status values

- `open`
- `fixed (reproduced before, not after: <repro file>, <commit>)`
- `fixed (confirmed by reading, <commit>)`
- `no longer reproduces` (nothing was changed on purpose, but the repro passes)

### Severity

Every reviewer and verifier grades with these:

- **critical**: any player can cause data loss, take over an account, crash the server or run code on it, or the problem breaks the game for every player.
- **high**: a player can do something their role doesn't allow, game state ends up wrong, a common action fails or crashes, or normal use freezes or slows down badly.
- **medium**: a bug in an unusual case, a missing layer of defense that something else currently covers, or a slowdown at large but realistic sizes.
- **low**: minor, unlikely or cosmetic.

### `scratchpad/kiln-review.md`

```markdown
# Kiln review

## Settings
- Universe: Scratchpad
- Accounts: owner `ada`, editor `bea`, player `cy`, outsider `dee`

## Runs
| Date | Branch | Commit | Mode | Passes | Agents | Findings | Files |
|---|---|---|---|---|---|---|---|
| 2026-11-07 | phase-15 | d7fe432 | diff | all | 9 | B 4, S 2, P 3, R 1 | phase-15-bugs.md, phase-15-security.md, phase-15-performance.md, phase-15-rules.md |
```

Findings counts leave out rejected ones.

## Setup notes

- The review test databases (`kiln_review_1_test` to `kiln_review_4_test`) are made by `docker/postgres/init/02-databases.sh` when the Postgres volume is created. A volume made before they existed adds them with the same script, run by hand (in Git Bash, put `MSYS_NO_PATHCONV=1` first):

	```bash
	docker compose exec postgres sh /docker-entrypoint-initdb.d/02-databases.sh
	```

	A repro test that fails with "The test database ... doesn't exist" needs this.
- `server/.env` needs `ENABLE_DEV_TOOLS=true` for the session script.
- The review accounts' session cookie is `__Host-kiln-session`, which a browser shares across every port of `www.multiversekiln.localhost`. Never put a review account's token in a browser there: it would replace the user's own login.
