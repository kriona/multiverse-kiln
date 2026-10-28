# CLAUDE.md

Context and rules for working in this repository. Read this before making changes.
See `PLAN.md` for the build roadmap and current phase, and `STRUCTURE-OVERVIEW.md` for the pages, editors and game rules the phases build. Read the relevant sections of `STRUCTURE-OVERVIEW.md` before planning or implementing a feature, and update it when a design decision changes.

## Project overview

An engine for making multiplayer browser-based role-playing games.

- **Client:** TypeScript + Phaser, rendering to a `<canvas>` via WebGL. Dev server: Vite.
- **Server:** Node.js + TypeScript running Colyseus (rooms, matchmaking, state sync over WebSockets).
- **Database:** PostgreSQL on Neon, accessed through Drizzle ORM.
- **Hosting (production):** Colyseus Cloud for the game server; Neon for the database.
- **Development:** everything runs locally first (Docker Postgres + local Colyseus + Vite).

## Repository layout

```
/client          Phaser game (Vite). Uses `@colyseus/sdk` (formerly colyseus.js) to connect to the server.
                 Eight pages, linked without .html (/game): index.html (Home; src/main.ts, src/style.scss),
                 universe.html (a universe's page at /universe/<slug or id>; src/universe.ts, src/universe.scss),
                 game.html (lobby and game at /game/<slug or id>, apart from Home so other pages can be open in
                 other tabs while playing; src/game.ts, src/style.scss), edit.html (the
                 world editor at /edit/<universe id>; src/edit.ts, src/edit.scss), character.html (Create Character; src/character.ts,
                 src/character.scss), license.html (the game's license and the
                 licenses of what it uses, linked from the footer; src/license.ts, src/license.scss), privacy.html
                 (the privacy policy, linked from the footer; src/privacy.ts, src/privacy.scss) and
                 admin.html (settings for the whole site; src/admin.ts, src/admin.scss). HTML the pages share (the tags every <head> starts with, status, notice and login screens,
                 footer, the keyboard shortcut list and screen reader live regions) lives in partials/, included with <!-- include footer.html --> (vite.config.ts).
                 Both styles use src/_shared.scss, and
                 src/pages.ts holds the addresses that link the pages. src/localization.ts shows text in the
                 player's language
/server          Colyseus server.
  src/index.ts       Colyseus Cloud entry point - never modify it (Colyseus's rule for Cloud deploys)
  src/app.config.ts  define room types, HTTP routes, Express middleware
  src/transport.ts   HTTPS/WSS transport
  src/rooms/         Room classes (lifecycle hooks, message handlers, tick loop): SessionRoom (one, global: login,
                     account), LobbyRoom (one per universe) and GameRoom (one per group, made from the database
                     when a member returns). The two map rooms share AreaPlayers (movement, areas, who sees whom,
                     area links) and AreaCache
  src/players/       who is logged in, and changes to characters and groups published to the rooms (in memory;
                     accounts, characters and groups are in the database)
  src/world/         changes the world editor makes, published to the rooms playing in that world (in memory)
  src/logic/         pure game-simulation functions (no I/O)
  src/db/            Drizzle client, schema, and repository modules
  src/storage/       object storage for uploads (any S3-compatible service; SeaweedFS locally)
  src/images/        checking and re-encoding uploaded images, such as tilesets
  src/auth/          token verification
  src/http/          REST routes (health, universes for Home, characters, groups and invite links, the world
                     editor's API, uploaded tilesets, the admin page's site settings). The world editor saves
                     every change through one route, editorChanges.ts, in one transaction; each kind of
                     change is checked and saved by its module (editorAreas.ts, editorItems.ts and so on)
  scripts/           development tools run by hand, such as the seed script
/shared          Code imported by both client and server:
                 message type enums, payload interfaces, close codes, constants,
                 the synced state's @colyseus/schema classes (src/state.ts),
                 the map and chunk layout (src/maps.ts) and universe settings (src/universes.ts),
                 each ruleset's data and rules (src/rulesets/<ruleset>/, Open Game Content for PF1E and
                 SF1E; see client/license.html), and what the rulesets share: money (src/money.ts) and
                 the abilities, sizes, races, classes and themes tables (src/racesAndClasses.ts),
                 messages and the Translator (src/localization.ts)
  locales/           en.json, the English catalog extracted from the code, and each translation's file, which
                     stores each message with the English it was made from (en-x-pirate.json is Pirate, a
                     test language). The client's dev server writes en-XA.json, the pseudo-language's
                     (git-ignored)
  scripts/           the message extractor (extractMessages.ts), run by `npm run messages` and the client's dev server
docker-compose.yml   local Postgres and object storage (SeaweedFS)
```

npm workspaces are assumed (`client`, `server`, `shared`). Update this section if the package manager changes.

## Architecture rules (do not violate)

1. **Server-authoritative.** Clients send *inputs* (e.g. "move left", "fire"), never positions, health, scores, or other state. The server validates every message and is the only thing that mutates game state.
2. **Synced state lives in Colyseus Schema.** Mutate `this.state` on the server and let Colyseus send delta patches. Use `broadcast()` / `client.send()` only for one-off events (effects, chat), not for state.
3. **Keep synced state lean.** Server-only or hidden data does not go in the Schema.
4. **Game rules are pure functions** in `server/src/logic/`, called from the room's simulation interval. No database, network, or timer calls inside them. They should be unit-testable without Colyseus.
5. **Message contracts live in `/shared`.** Never use string literals for message types; import the enum. Payloads are typed interfaces in `/shared`.
6. **The client renders and interpolates;** it does not decide outcomes.

## Database rules

- **Never touch the database inside the simulation tick.** No `await` on DB calls in `setTimestep` / `setFixedTimestep` callbacks (`setSimulationInterval` before Colyseus 0.18).
- DB access happens at lifecycle boundaries only:
  - `onAuth` / `onJoin`: load the player profile.
  - `onLeave` / `onDispose`: save results and progress.
  - Optional periodic checkpoints for long sessions, run off the tick path.
- All queries go through repository modules in `server/src/db/` (e.g. `playerRepo.ts`). Rooms call repositories, never raw SQL or the Drizzle client directly.
- Schema changes are made in the Drizzle schema, then a migration is generated with `drizzle-kit`. Never edit the database by hand, and never run migrations automatically on server startup.
- Give migrations descriptive names (`npx drizzle-kit generate --name=<name>` from `server/`). Data every database needs, such as a ruleset's default tiles, goes in a custom migration (`--custom --name=<name>`); sample data for development goes in the seed script instead.
- Use a standard TCP Postgres driver (`pg` or `postgres.js`) with a connection pool. Do not use Neon's HTTP/serverless driver; the server is a long-running process.
- In production, use Neon's **pooled** connection string.
- Two roles: migrations run as the migration role, which owns the tables; the server runs as the app role, which can read and write rows but not alter tables. Locally, the scripts in `docker/postgres/init/` create them, along with the `kiln` and `kiln_test` databases. Never give the server the migration role's credentials.
- `server/src/db/client.ts` throws on import when `DATABASE_URL` is unset. Tests run against their own database: `server/test/setup.ts` points `DATABASE_URL` at `TEST_DATABASE_URL`, rebuilds it from the migrations at the start of every run, and before each test deletes every row except those the migrations inserted (such as default tiles), so a test never depends on rows another test left behind. It refuses a database whose name doesn't end in `_test`.
- Write repository tests against the real test database (`server/test/db/`), not mocks.

## Configuration

- All environment-specific values come from environment variables. Never hard-code URLs, credentials, or secrets, and never commit `.env` files. The pre-commit hook runs gitleaks on staged changes and blocks commits that contain secrets.
- Root (`docker-compose.yml`): `POSTGRES_PASSWORD`, `KILN_MIGRATOR_PASSWORD`, `KILN_APP_PASSWORD`, `POSTGRES_PORT`, `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` (the local storage's keys), `STORAGE_PORT`.
- Server: `DATABASE_URL` (the app role), `MIGRATION_DATABASE_URL` (the migration role; drizzle-kit only, never the running server), `PORT` (default 2567), `ENABLE_DEV_TOOLS` (playground and `/monitor`, never in production), `SSL_KEY_FILE` / `SSL_CERT_FILE`, `ALLOWED_ORIGINS`, `LOADTEST_ENDPOINT`, `STORAGE_ENDPOINT` / `STORAGE_REGION` / `STORAGE_BUCKET` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` / `STORAGE_FORCE_PATH_STYLE` (object storage for uploads), `TEST_STORAGE_BUCKET`, auth secret(s).
- Client: `DEV_HOST`, `DEV_PORT`, `DEV_SSL_KEY_FILE` / `DEV_SSL_CERT_FILE`, `VITE_SERVER_URL` (`wss://www.multiversekiln-dev.com:2567` locally, `wss://...` in production), `VITE_SOURCE_URL` (the source code link in the page footer, required by the AGPL; a fork sets its own repository), `VITE_PRIVACY_CONTACT` (the email address the privacy policy gives players; a fork sets its own).
- Commit `.env.example` files listing every variable with placeholder values, and keep them up to date.

## HTTPS

- Local development is always HTTPS/WSS on the hostname `www.multiversekiln-dev.com` (hosts file -> `127.0.0.1`), using an mkcert certificate in the git-ignored `certs/` folder. See README.md for setup.
- Never add a plain HTTP fallback. `server/src/transport.ts` refuses to start without a certificate, except on Colyseus Cloud (its proxy terminates TLS and the server listens on a local socket) and when `NODE_ENV=test` (the `@colyseus/testing` harness only connects over `ws://`; `server/test/setup.ts` sets this).
- The Vite dev server requires `DEV_SSL_KEY_FILE` / `DEV_SSL_CERT_FILE`; production builds don't.
- Node scripts that connect to the local server need to trust the mkcert CA: run them with `--use-system-ca` (see the `loadtest` script).

## Origins and response headers

- Only origins in `ALLOWED_ORIGINS` may use the server from a browser; the server refuses to start without it. `server/src/http/responseHeaders.ts` replaces Colyseus's default CORS (which allows every origin with credentials), and `createOriginCheck` in `server/src/http/origins.ts` rejects WebSocket connections from other origins (browsers don't apply CORS to WebSockets). Requests without an `Origin` header (non-browser clients) are allowed.
- Every HTTP response gets `X-Content-Type-Options: nosniff`; `X-Powered-By` is disabled, and `/` returns 404 unless dev tools are on, so the server doesn't advertise Colyseus or Express. Don't undo these, and cover new routes in `server/test/http.test.ts`.
- Tests share one server through `server/test/testServer.ts` (`getTestServer()`): the app's `Server` instance can only be booted once per run.

## Local development

`start.bat` (starts Docker Desktop and Postgres if needed, runs `npm install`, then `npm run dev`) or `npm run dev` at the root builds `shared`, then runs the shared watcher, server, and client together in one terminal.

```bash
docker compose up -d                 # start local Postgres and object storage
npm run storage:setup -w server      # create the storage bucket (start.bat does it)
npm run db:generate -w server        # create a migration after changing server/src/db/schema.ts
npm run db:migrate -w server         # apply Drizzle migrations
npm run db:seed -w server            # add or replace the sample universe (server/scripts/sampleUniverse.ts); -- --creator "<name>" makes that player its creator
npm run messages                     # update shared/locales/en.json after changing messages (the client's dev server does it as you save), and list each translation's missing and out-of-date messages
npm run dev -w server                # Colyseus on wss://www.multiversekiln-dev.com:2567
npm run dev -w client                # Vite on https://www.multiversekiln-dev.com:5173
```

Run all npm commands from the repository root, using `-w <package>` to target one package (e.g. `npm install <pkg> -w server`).
Test multiplayer with separate browsers or profiles: every tab of one browser is the same player. The local Postgres major version should match the Neon project's.

## Coding conventions

- TypeScript `strict` mode everywhere. Avoid `any`; validate untrusted input (client messages, request bodies) at the boundary.
- Prefer small, focused modules. Room classes orchestrate; logic lives elsewhere.
- Write unit tests for `server/src/logic/` and repository modules.
- **Text players read is a message** (see Localization in `STRUCTURE-OVERVIEW.md`): an ID, its English text and a description that tells translators what it is and where it appears, written as an object literal where it's used, e.g. `t({ id, defaultMessage, description })` with `t()` from `client/src/localization.ts`, so the English reads in place. Declare a message with `defineMessages()` from `/shared` only when it's used in more than one place or looked up from a table (such as `UNIVERSE_STAGE_NAMES`), and put the declaration as close to its uses as possible. Give the same English used for two purposes two IDs, and one concept shown in several places (a setting's heading in its editor, filter and table column; a value shown as filter choices and in a column) one ID: each ID is separate work for translators, so look for an existing message before adding one, and write its description to cover every place it appears. In a page's HTML, repeat the same `data-message` ID with the same text and `data-translation-context`. Build sentences with ICU arguments and plurals (`'{count, plural, one {# area} other {# areas}}'`), never by joining pieces. Text in a page's HTML gets `data-message` and `data-translation-context` attributes (see `shared/scripts/extractMessages.ts`); the client's Vite config strips `data-translation-context` from the pages it serves and builds. The server never sends English: HTTP errors go through `sendError()` (`server/src/http/errors.ts`) as a `LocalizedMessage`. Text players write (names, chat) and universe text (names and descriptions creators write) aren't messages. The client's dev server keeps `shared/locales/en.json` current as files are saved; without it, run `npm run messages`, since lint fails until the catalog is current. When it or lint warns that a translation is missing messages or out of date, update it with the `translate` skill (`.agents/skills/translate/SKILL.md`): Pirate (`en-x-pirate`) right away, a real language only when asked. Check new pages in the pseudo-language with `?locale=en-XA`.
- **The game engine's name is only ever `SITE_NAME`** (`shared/src/constants.ts`), never written into a message or page. Code uses the constant; a page's HTML writes `%SITE_NAME%`, which `client/vite.config.ts` fills in. A message that names it takes it as an argument, `{siteName}`, which in a page's HTML is `<span data-argument="siteName" translate="no">%SITE_NAME%</span>`. Browser tab titles leave it out: set them with `setPageTitle()` (`client/src/ui/dom.ts`), which adds ` - ${SITE_NAME}`.
- **Icons** come from Phosphor's Regular icons (`ph:<name>`, https://phosphoricons.com) for interface actions and game-icons.net (`game-icons:<name>`, https://game-icons.net) for game concepts. A page marks one with `<!-- icon ph:floppy-disk -->` before a button's text; code imports one with `import trashIcon from 'virtual:icon/ph:trash'` and shows it with `setButtonLabel()` (`client/src/ui/dom.ts`). The icons plugin in `client/vite.config.ts` inlines them as SVG at build time. Both are credited, with their licenses, on `client/license.html`; credit any new third-party code or assets the pages use there too.
- **Every screen works with only a keyboard and with a screen reader** (see Accessibility in `STRUCTURE-OVERVIEW.md`). When adding a screen, dialog or game feature:
	- Give its main buttons shortcuts with `data-shortcut="Alt+<letter>"`, following the pattern there (Alt+S submits, Alt+N adds, and so on). `client/src/ui/shortcuts.ts` underlines the letter, sets `aria-keyshortcuts` and lists it under `?`. Use `addShortcut()` for a shortcut that isn't a button, and `addKeyHelp()` to list keys the code handles itself. Don't use Alt+D, Alt+E or Alt+F, and don't give deleting a shortcut.
	- Read out what changes without the player acting, and what is only drawn on a canvas, with `announce()` (`client/src/ui/announcer.ts`), the way `MapAnnouncer` does for the game's map.
	- Show a field's problem with `reportFieldError()` (`client/src/ui/fieldErrors.ts`), and point the form's buttons at its error text with `aria-describedby`.
	- Never show something by color alone, give anything drawn on a canvas a keyboard way to reach it, and set `document.title` when the screen shows.
- **The universe editor stages every change.** Nothing a universe editor tab or its dialogs change reaches the server until the player clicks the Save button in the editor's bar (see Unsaved changes in `STRUCTURE-OVERVIEW.md`): adding, changing and deleting, uploads and deleting uploads included. Dialogs Apply their changes to the tab, the tab shows what will change, and Save sends it all. Never add a control that changes the universe straight away, even after a confirmation.
- **Don't let work be lost by accident.** Give a form or dialog that edits something a `ChangeTracker` (`client/src/ui/changeTracker.ts`): call `markSaved()` once it is filled and after it saves, `confirmDiscard()` before closing or replacing it, and `guardDialog()` for a dialog. Anything else holding work not yet saved (such as painting still being sent) registers with `watchUnsavedWork()`. While any of it has unsaved changes, the browser asks before the page is left.
- Code must pass `npm run lint` (ESLint, `eslint.config.js`); a pre-commit hook enforces it. Run it after making changes, and fix problems with Edit rather than `eslint --fix`. The import restrictions for `server/src/logic/` and `server/src/rooms/` enforce the architecture and database rules above - don't disable them.
- Colyseus APIs changed substantially in 0.17 and 0.18, and recall of them is usually out of date. **Use the `colyseus` skill** (`.agents/skills/colyseus/SKILL.md`) before writing or changing any Colyseus code: rooms, Schema state, messages, matchmaking, reconnection, the client SDK (`@colyseus/sdk`) or server config. Read the matching file in its `references/` folder before non-trivial work in that area. Check the installed versions in `server/package.json` and `client/package.json` first; the skill is written for `colyseus` 0.18 and `@colyseus/schema` 5.
- Phaser 4 also changed substantially from Phaser 3, which most recall is based on. **Use the Phaser skills** (official, from `phaserjs/phaser`: one per engine area in `.agents/skills/<area>/SKILL.md`, e.g. `scenes`, `sprites-and-images`, `loading-assets`, `input-keyboard-mouse-touch`, `tweens`, `tilemaps`) before writing or changing client code that uses Phaser. When unsure whether an API still exists, check `v4-new-features` and `v3-to-v4-migration` first. Check the installed version in `client/package.json`; the skills are written for Phaser 4.
- **Never use Phaser physics (`physics-arcade`, `physics-matter`) for gameplay.** Movement, collisions and every other game rule run on the server (architecture rules 1, 4 and 6); the client only renders and interpolates. Phaser physics is acceptable only for purely cosmetic effects that never feed back into game state. If client-side prediction is added later, it reuses the server's pure functions from `server/src/logic/` (moved to `/shared` if needed), not Phaser physics.
- Skill examples show library APIs, not this project's conventions. Where they differ, this file and the global code style win: rooms reach the database only through repositories and only at lifecycle boundaries (the Colyseus skill's example queries a database from a message handler), the client connects to `VITE_SERVER_URL` rather than `http://localhost:2567`, client code is TypeScript (the Phaser skills' examples are JavaScript), and code follows the house style (single quotes, Allman braces).
- When unsure about an architectural choice, follow the rules above and ask rather than inventing a new pattern.

### Formatting

On top of the global code style:

- Name variables and parameters with full words, not abbreviations: `(request, response)` in an Express handler, not `(req, res)`.
- A chain of two or more method calls (Drizzle queries, `filter`/`sort`/`map`, promise chains) puts each call on its own line, indented one tab under where the chain starts.
- An object literal with more than one property goes one property per line when it doesn't fit comfortably on one line, including objects passed into a chain (`.select({...})`, `.values({...})`, `.set({...})`). A message's values (the object after the message in `t()`, `sendError()` and the like) always go one property per line when there is more than one.

```ts
const [row] = await executor
	.select({
		id: universes.id,
		name: universes.name
	})
	.from(universes)
	.where(eq(universes.id, universeId))
	.limit(1);

const others = [...this.members]
	.filter(([playerId]) => (playerId !== this.ownPlayerId))
	.sort(([, a], [, b]) => a.localeCompare(b));

const payload: UniverseListPayload = {
	universes: universes.slice(0, limit),
	hasMore: (universes.length > limit)
};
```

## Deployment (later phases)

- Game server: `npx @colyseus/cloud deploy` from `/server`. Production env vars are set in the Colyseus Cloud dashboard.
- Database: Neon, with separate `dev` and `prod` branches. Run migrations against the target branch as a deploy step, before rolling out new server code.
- Put the Neon project in the region closest to the Colyseus Cloud deployment.
- Disable or lengthen Neon autosuspend on the production branch to avoid cold starts on player login.
