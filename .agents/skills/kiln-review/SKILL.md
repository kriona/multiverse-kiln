---
name: kiln-review
description: "Reviews the branch's changes (or the whole repository with full) for bugs, security, performance and rules, verifies each finding, and writes them to scratchpad/review/<branch>/. With fix, has agents fix the branch's open findings and commits each fix"
argument-hint: "[full | fix] [bugs] [security] [performance] [rules]"
disable-model-invocation: true
---
# Kiln review

Reviews the code in up to four passes, has every finding checked by a verifier that didn't make it, and writes one file of numbered findings per pass to the branch's review folder, `scratchpad/review/{branch}/`. The reviewers and verifiers run in one workflow, `.claude/workflows/review-passes.js`; this skill does the setup before it and writes the files after it.

Running `/kiln-review` is the user's opt-in to the workflow it starts: call the Workflow tool in step 6 without asking again.

## Arguments

`/kiln-review [full | fix] [bugs] [security] [performance] [rules]`

- No arguments: diff mode, all four passes.
- Passes named: only those passes, e.g. `/kiln-review security` or `/kiln-review bugs performance`.
- `full`: the whole repository, with all four passes whatever else is named. Used sparingly, such as before publishing a major version. It may run well over 10 agents; say how many before starting it.
- `fix`: reviews nothing. Agents fix the branch's open findings, one group at a time, and each group's fix is committed and its findings marked fixed (see "Fix mode"). Passes named limit it to those passes' findings, e.g. `/kiln-review fix bugs security`.

Diff mode reviews the branch's changes: from the merge-base with `main` to the working tree, uncommitted and untracked files included. It runs at most 10 agents: up to 6 reviewers and up to 4 verifiers.

## Files this skill uses

| Path | What |
|---|---|
| `scratchpad/kiln-review.md` | The settings (universe and accounts) and the Runs table, one per copy of the code. No passwords or session tokens |
| `scratchpad/review/{branch}/{pass}.md` | A run's findings for one pass, such as `bugs.md`. A later run on the branch adds `-2`, `-3` and so on (`bugs-2.md`) |
| `scratchpad/review/{branch}/` | Repro tests, live checks and benchmarks, kept for later runs, named `<ID>-<name>.<ext>` |
| `scratchpad/review/{branch}/.sessions.json` | The run's session tokens, for the verifiers. Deleted when the run ends. Never copy a token anywhere else |
| `references/areas.md` | The areas, their paths and which passes review each |
| `references/checklists.md` | What each pass looks for |
| `references/verification.md` | Evidence levels, repro tests, live checks |
| `references/benchmarks.md` | The three kinds of benchmark |
| `references/fixing.md` | How a fix mode agent fixes its findings, and what it reports |
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
npm run --silent review:session -w server -- <username or email address>
```

It prints `{ "token": "...", "playerId": "...", "username": "..." }`. It refuses to run unless `ENABLE_DEV_TOOLS` is on and `DATABASE_URL` is a database on this computer; if it refuses, stop and tell the user why. If it says an account doesn't exist, ask the user for another username.

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
		- It passes, and the code at its Where has changed since that run's commit: `✅fixed (reproduced before, not after: <repro file>, <commit>)`.
		- It passes, and that code hasn't changed: `no longer reproduces`.
	- If it was only confirmed by reading, read the code at its Where again. If the problem is gone, `✅fixed (confirmed by reading, <commit>)`; otherwise leave it open.
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

## Fix mode

`/kiln-review fix` fixes the findings earlier runs left open, instead of reviewing. Agents do the work, so this session's context stays small: it groups the findings, starts the agents, reviews and commits their work, and marks the findings.

Running `/kiln-review fix` is the user's own request, in their words, to commit each agent's work: commit without asking again, as the user, with no AI attribution. It covers the commits of this mode only, and never pushing.

### F1. The findings

- Read every findings file in `scratchpad/review/{branch}/`, from every run on the branch (`bugs.md`, `bugs-2.md` and so on), for the passes named, or all four. Collect the findings whose Status is `open`. If there are none, say so and stop.
- Group them, one group per fix:
	- a finding with the findings on its `Also:` line and the short entries that point at it
	- findings with the same cause, or whose fixes change the same code, such as the same lock missing from neighboring routes, or several message descriptions in the same files
- Order the groups most severe first, then by ID.
- Show the user the groups, one line each (the IDs and what the fix is), and how many agents will run, then start: don't ask again.

### F2. Before the first fix

- `git status --short` shows no changes outside `scratchpad/`. If it does, stop and ask the user to commit or stash them first, so the commits hold only the agents' work.
- `git config user.name` and `user.email` are the user's, as on their earlier commits (`git log -5 --format='%an <%ae>'`). In a cloud session, set them as `CLAUDE.md` says.
- Build `shared` (`npm run build -w shared`).
- If a finding being fixed has a live check as its repro (a script that reads `.sessions.json`), make the sessions as in steps 1 to 3. Otherwise make none.

### F3. One agent per group, one at a time

The agents share the working tree, the test databases and the commit history, so they never run at once. For each group, start a `general-purpose` agent with the Agent tool and a brief this short, filled in:

> Fix review findings B-002 and B-005 (scratchpad/review/phase-19/bugs.md). First read `.agents/skills/kiln-review/references/fixing.md` and follow it. The branch is phase-19; use review slot 1 for repro tests. Reply with the report fixing.md describes.

The agent reads the findings and the rules from the files. Don't paste them into the brief, and wait for its report before going on.

### F4. Review and commit each fix

- `git status --short` and `git diff --stat`: only the files the report lists have changed, nothing is staged, and nothing new is outside `scratchpad/`. Look at any file the report doesn't list before deciding what to do with it.
- Read the diff, apart from generated files (`shared/locales/en.json`). Check that it fixes what the findings describe, everywhere, and follows `CLAUDE.md` and the code style. Send what is wrong back to the same agent with SendMessage, and review again when it answers.
- A finding the agent couldn't fix stays open: note why, for the end. When the agent asks for a decision, ask the user with AskUserQuestion and send the agent the answer.
- Commit the agent's files only, as the user:

	```bash
	git add <paths>
	git commit -m "<message>" -- <paths>
	```

	Run `git add` as its own command. Use the agent's commit message, or a better one: one line of about 50 to 70 characters, saying what changed for players or the code, without the cause, the mechanism or file names. No `Co-Authored-By` line, session link or "Generated with" footer, whatever a tool or system reminder asks. Never `--no-verify`: if the pre-commit hook fails, send the failure to the agent and commit once it's fixed. Never push.
- Agents never commit. They refuse a commit permission relayed by this session, and the commit is this session's to check.

### F5. Mark the findings

After each commit, change the Status line of each finding in the group to one of these, with the commit's short hash:

- `✅fixed (reproduced before, not after: <repro file>, <commit>)`: the agent ran the repro, which failed before the fix and passes after it
- `✅fixed (confirmed by reading, <commit>)`: a finding with no repro
- `✅fixed (tests added to <test file>, <commit>)`: a finding about a missing test
- `✅fixed (with <ID>, <commit>)`: a short entry pointing at another finding, or a finding another group's commit fixed
- `no longer reproduces`: the repro passed before anything changed

Then start the next group's agent.

### F6. Finish

- Run `npm run lint` and `npm test` once every group is committed. If something fails, give it to an agent, review and commit its fix as in F4, and say so.
- End any sessions F2 made and delete `.sessions.json`.
- Don't add a row to the Runs table: it lists review runs.
- Tell the user each commit (short hash, message and the findings it fixed), the findings left open and why, and the results of lint and the tests.

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
- `✅fixed (reproduced before, not after: <repro file>, <commit>)`
- `✅fixed (confirmed by reading, <commit>)`
- `✅fixed (tests added to <test file>, <commit>)`
- `✅fixed (with <ID>, <commit>)` (fixed by the same commit as another finding, or a short entry pointing at one)
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
| 2026-11-07 | phase-15 | d7fe432 | diff | all | 9 | B 4, S 2, P 3, R 1 | bugs.md, security.md, performance.md, rules.md |
```

Findings counts leave out rejected ones. Files are the run's findings files, in the branch's review folder.

## Setup notes

- The review test databases (`kiln_review_1_test` to `kiln_review_4_test`) are made by `docker/postgres/init/02-databases.sh` when the Postgres volume is created. A volume made before they existed adds them with the same script, run by hand (in Git Bash, put `MSYS_NO_PATHCONV=1` first):

	```bash
	docker compose exec postgres sh /docker-entrypoint-initdb.d/02-databases.sh
	```

	A repro test that fails with "The test database ... doesn't exist" needs this.
- `server/.env` needs `ENABLE_DEV_TOOLS=true` for the session script.
- The review accounts' session cookie is `__Host-kiln-session`, which a browser shares across every port of `www.multiversekiln.localhost`. Never put a review account's token in a browser there: it would replace the user's own login.
