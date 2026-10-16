# PLAN.md

Phased roadmap for building the game locally, then deploying to Colyseus Cloud + Neon.
Each phase ends with a "Done when" check. Tick boxes as work completes and keep the
**Current phase** line updated so each new session knows where to pick up.
`STRUCTURE-OVERVIEW.md` describes the pages, editors and game rules these phases build.

**Current phase:** 9

---

## Phase 0: Repository scaffold

- [✅] Create npm workspaces root with `client`, `server`, `shared`
- [✅] Scaffold server from the official Colyseus template (`npm create colyseus-app`)
- [✅] Scaffold client with Vite + TypeScript + Phaser
- [✅] Create `shared` package; confirm both client and server can import from it
- [✅] Shared TypeScript config with `strict: true`
- [✅] Add `.gitignore` (including `.env*` except `.env.example`)
- [✅] Add `CLAUDE.md` and `PLAN.md` to the repo root

**Done when:** `npm install` at the root succeeds and both client and server compile.

## Phase 1: Local infrastructure

- [✅] `docker-compose.yml` with Postgres (match Neon's major version); bind the port to `127.0.0.1` only and read the password from `.env`
- [✅] Separate Postgres roles: the app role can read and write data but not alter tables; migrations run under a migration role
- [✅] Install Drizzle ORM, `drizzle-kit`, and a TCP Postgres driver in `server`
- [✅] `server/src/db/client.ts` creating a pooled connection from `DATABASE_URL`
- [✅] Initial Drizzle schema (e.g. `players` table: id, display name, created_at)
- [✅] `db:generate` and `db:migrate` scripts
- [✅] First migration applied locally
- [✅] `.env.example` files for server and client

**Done when:** Postgres runs in Docker and the first migration creates the tables.

## Phase 2: Server skeleton

- [✅] Message type enum and payload interfaces in `/shared`
- [✅] Schema classes: `GameState` containing a `MapSchema<Player>`
- [✅] `GameRoom` with `onCreate`, `onJoin`, `onLeave`, `onDispose`; set `maxMessagesPerSecond` (Colyseus defaults it to `Infinity`)
- [✅] Input message handler that queues inputs per player; validate payloads against the `/shared` types (no `any`) and don't log raw client input
- [✅] Simulation loop (~30 Hz) calling pure logic in `server/src/logic/`: `setTimestep`, or `setFixedTimestep` if we add client-side prediction (see the `colyseus` skill)
- [✅] Health-check HTTP route; remove the template's `/api/hello` and `/hi` routes (or serve them only with dev tools on)
- [✅] Unit tests for the movement logic

**Done when:** the Colyseus dev tools can join the room and show player state changing.

## Phase 3: Client connection

- [✅] Connect via `@colyseus/sdk` (formerly colyseus.js) using `VITE_SERVER_URL`
- [✅] Phaser scene creates and removes sprites from state `onAdd` / `onRemove`
- [✅] Send keyboard input as messages; never send positions
- [✅] Interpolate rendered positions between server patches
- [✅] Add a "Source" link to the client UI (repository URL, copyright line, AGPL notice). The AGPL (section 13) requires anyone running a modified version to offer players its source; having the link already in place means forks carry it with them

**Done when:** two browser tabs show two players moving smoothly and seeing each other.

## Phase 4: Repository security

- [✅] Move the inline `<style>` in `client/index.html` to a CSS file so the CSP (Phase 15) doesn't need `'unsafe-inline'`
- [✅] In the GitHub repository's Settings > Advanced Security, turn on Dependabot alerts, Dependabot security updates and secret scanning with push protection (`.github/dependabot.yml` already configures version updates, and gitleaks runs in the pre-commit hook)
- [✅] Add a `docker-compose` entry to `.github/dependabot.yml`
- [ ] Add a `github-actions` entry to `.github/dependabot.yml` once there are workflows
- [✅] Review `npm audit`: the known low/moderate findings come from `@colyseus/auth` (bundled with `colyseus`, unused; its `grant` dependency pulls in the flagged `elliptic` and `uuid`) and the old `esbuild` under `drizzle-kit` (dev-only; the advisory concerns esbuild's dev server, which drizzle-kit doesn't run); don't run `npm audit fix --force`, which downgrades Colyseus

**Done when:** GitHub's security features are on and `npm audit` has no unexplained findings.

## Phase 5: Lobby and groups

- [✅] Lobby: name-only login (in memory until Phase 13), chat, who's online, and a Create game button
- [✅] Groups of up to 6 players, each in its own game room; a player is in one group at a time and can leave it
- [✅] Rate limits on room messages (`maxMessagesPerSecond`) and on chat

**Done when:** players can log in by name, chat in the lobby, and move around together in a group's room.

## Phase 6: Persistence

- [✅] Test database (`kiln_test`) for the test suite: migrated before the tests run and emptied before each test
- [✅] `playerRepo`: the name-only login loads the player with that name (ignoring capitals) or creates them, so a name is the whole login until Phase 13. A player can be logged in from one browser at a time
- [✅] The player is loaded when they log in. Nothing changes during play yet, so there is nothing to save in `onLeave` / `onDispose` until characters exist (Phase 10)
- [✅] A test that fails if the database is used while players move

**Done when:** a player's identity survives a server restart, and the test suite runs against its own database.

## Phase 7: Universes, zones and maps

The game runs on real universe data. Content comes from a seed script until the editor exists (Phase 8).

Built in three steps: data and logic, then rooms, then the client.

- [✅] Tables: `universes` (name, descriptions, stage, ruleset, passage of time, lobby and starting zones), `zones` (universe, parent, name, enabled, indoors, default tile, bounds, loops, passage of time), `tiles` (ruleset defaults plus each universe's own tiles), `map_chunks` and `zone_links`. Edited copies of default tiles come with the tile editor (Phase 8)
- [✅] Store map cells in chunks of 32 x 32, saving only chunks that differ from the zone's default tile: a map can be 50,000 tiles in each direction
- [✅] PF1E default tiles (Grass, Forest, Desert, Mountains, Water, Wood Floor), added by a migration
- [✅] Seed script for a sample universe (`npm run db:seed -w server`): a town square lobby with a cottage and a cellar, and a crossroads for groups that loops east-west. Run by hand like migrations, never on startup
- [✅] Pure logic with tests: movement cost (50% = double, 100% = impassable), map bounds around 0,0, no cutting past impassable corners, wrapping in zones that loop, stopping on automatic links, finding a free cell to arrive in
- [✅] Rename today's global `LobbyRoom` to `SessionRoom` (login, account, group membership), and add a `LobbyRoom` per universe (`filterBy` the universe ID) with the map, chat, who's here and Create game. Groups belong to a universe and start in its starting zone
- [✅] A room holds every zone its players are in; each player has a zone, and each client only sees the players in its own zone (`StateView`, one per client for now)
- [✅] Rooms load zone maps at lifecycle boundaries, and load the next zone before a player moves into it, never inside the tick
- [✅] `GET /universes` lists the universes Home shows, a page at a time
- [✅] Client draws tiles by color from the zone data (graphics come in Phase 17), drawing only the chunks near the camera. The server still sends the whole zone (see Phase 8)
- [✅] Looping zones wrap seamlessly: near an edge the client draws the far side's chunks beyond it, players on the far side appear across the edge, and stepping over the edge doesn't jump the camera or the player
- [✅] Zone links: automatic links move you, manual links offer a prompt (press E)
- [✅] The lobby screen shows the lobby's map next to chat and who's here, so players can walk around it
- [✅] Home page: universes in `let there be light` (paginated from the start), the universe overview, and Enter Universe -> that universe's lobby. Leaving the lobby goes back to Home; the long description is shown as plain text until Markdown rendering (Phase 8)

**Done when:** a player picks a universe on Home, walks its lobby's map (blocked by mountains and water, slowed by forest) and walks through a door into a house.

## Phase 8: World editor

Built in four steps: the server API, the editor pages, the map editor, then loading chunks as players approach them.

- [✅] Editor API as REST routes in `server/src/http/` backed by repositories (editing isn't real-time, so it doesn't need a room). Every request checks the user may edit that universe, and validates against the same limits as the UI. Who may edit is stored in `universe_editors` (creator, builder, beta tester; Phase 14 adds the Editors tab), and until logins exist (Phase 13) a request's player is the one its browser ID cookie is logged in as
- [✅] Create Universe modal (name, 1-sentence description, ruleset), up to 5 per user. Creates a lobby zone and a default zone as every race's starting zone, and makes the user its creator. Home lists the universes the user has a role in, which opens them in the editor
- [✅] Edit Universe page: name, descriptions (markdown rendered sanitized with `marked` and DOMPurify, also on Home's overview), stage, ruleset, passage of time. Logo and banner wait for image storage (Phase 17). A Lobby tab opens the lobby's zone until the rest of the tab arrives (Phase 12)
- [✅] Tilesets tab (filters for name, passable, custom and edited; pagination) and tile editor (name, indoors, color, vision cost, movement cost)
- [✅] Zones tab with the single-zone drill-down, and the zone editor's settings. Its map is the next item
- [✅] Map editor: grid centered on 0,0, expand buttons, edit-size dialog with its warning, draw tool (a tile or Void; size 1-100; circle or square), undo/redo with a drag counted as one step. It loads chunks as the view reaches them, pans with the right or middle mouse button and zooms with the wheel. Undo covers painting; resizing to a smaller map clears the undo history
- [✅] Zone link layer: automatic or manual, "requires the whole group", select destination coordinates with an optional return link (placed in the target zone, leading back to the link's cell)
- [✅] Edits apply immediately (universe versions come in Phase 14): the editor routes tell open rooms in this process about changed cells, zones, links and tiles (`zoneChanges`), and the rooms update the zones they have loaded and their clients. Players a smaller map leaves out move to the nearest free cell inside it; players in a deleted zone go to the lobby zone (lobby) or starting zone (group)
- [✅] Rooms load a zone's chunks as players come near them and drop chunks nobody is near, instead of loading the whole map (`loadZone` reads only the zone's settings, links and tiles), since the editor can make maps up to 50,000 cells per side. Loading stays outside the tick, on a 250 ms interval: a player waits at the edge of a chunk that hasn't arrived yet. Clients are likewise sent only the chunks near their player (`ZonePayload`, then `ChunksPayload` as they move)

**Done when:** a universe can be built from scratch in the browser (tiles, zones, maps and links) and played in its lobby.

## Phase 9: Localization groundwork

From here on, all text players read can be translated (see Localization in `STRUCTURE-OVERVIEW.md`), so the PF1E content in Phase 10 is translatable from the start. English is the only language for now.

- [✅] Messages are written in the code: each has an ID, its English text, and a description for translators saying what it is and where it appears (e.g. "Button that stores the form's changes in the database", so German picks "Speichern" and not "Retten"). Each is an object literal where it's used (`t({ id, defaultMessage, description })`), or declared with `defineMessages()` when it's used in more than one place or looked up from a table; text in the pages' HTML is marked with `data-message` and `data-translation-context` attributes instead, and the client's Vite config strips `data-translation-context` from the pages it serves and builds. The same English in two places gets two IDs, so each can be translated on its own
- [✅] The extractor (`npm run messages`, `shared/scripts/extractMessages.ts`) writes `shared/locales/en.json`, with the descriptions, from the code and pages. `npm run lint` and the pre-commit hook fail when the catalog isn't current, when a message has no description, when one ID has two different English texts, or when text in a page isn't marked. It uses the TypeScript compiler API rather than `formatjs extract`, whose dependencies have open high-severity advisories. Other languages' catalogs sit beside it
- [✅] `Translator` in `/shared` over `intl-messageformat` (ICU messages, for plurals and other grammar), and on the client `t()`, `formatList()` and the page's locale for `Intl` formatting. Other languages' catalogs load on demand with `import.meta.glob`. Until profiles exist (Phase 13), the player's language comes from the browser's settings
- [✅] Move the client's hard-coded text into messages, along with the enum labels (stages, roles, passage of time, faerie mornings, `RULESET_NAMES`)
- [✅] The server sends a `LocalizedMessage` (ID, English text and values) instead of English, through `sendError()` for every HTTP error. New universes' zone names are messages too, in English until the creator's language is known
- [✅] Default tiles' names are engine messages (`DEFAULT_TILE_NAMES`) found by their `key`; a universe's edited copy stores a name only when it was renamed. The Tilesets tab's name filter still matches those names in English, since the server has no translations
- [✅] A pseudo-language (`?locale=en-XA` in development), loaded as a catalog like any other language: the client's dev server writes it and `en.json` whenever a file with messages is saved, and production builds leave it out. An ESLint rule against literal text in the UI and in error responses, and a test that every translation parses and uses the same arguments as its English
- [✅] Add the rule to `CLAUDE.md`: text players read is a message with an ID, English text and a description
- [✅] Pirate (`en-x-pirate`), a test language shipped in production builds, and a language picker in the footer that the browser remembers until profiles exist. Each translation stores the English it was made from, and `npm run messages` reports each language's missing and out-of-date messages (players see English, or the old translation, until it's updated)

**Done when:** every page shows no untranslated text in the pseudo-language, and the English catalog is extracted from the code with a description for every message.

## Phase 10: Characters and the PF1E ruleset

- [ ] Review the Pathfinder 1E licensing (the OGL 1.0a and Paizo's terms for the "Pathfinder" name) before adding PF1E data, and add the required notices
- [ ] Rulesets as modules (PF1E first): races, classes, settings and default items, with game rules as pure functions and their names as engine messages
- [ ] Ruleset tab: stat rolling (3d6 variants, 4d6 variants, the point buy budgets and a custom budget), plus the sleep, weight and ammo settings (stored now, used later)
- [ ] Items tab, item editor (name, type, enabled) and PF1E default items; item selection with quantities
- [ ] Money field as a pure function with tests ("1pp 2gp 2sp 4cp", stored in copper)
- [ ] Characters tab: group size, starting equipment, money and zone. Races and Classes tabs with their overrides, custom races and classes, and the PF1E fields (ability modifiers, floating bonus, darkvision, size, primary ability, tradition, casting style)
- [ ] Create Character: the server rolls the stats and validates point buy choices (the client never sends ability scores); up to 20 per universe; starting zone by precedence (class + race > class > race > universe); starting equipment and money
- [ ] Lobby: ghosts (invisible, don't block cells, can read but not send chat), choosing and switching characters, chatting as your character
- [ ] Character sheet modal

**Done when:** a player creates a PF1E character with rolled stats and starting gear, then walks and chats as them in the lobby while ghosts watch.

## Phase 11: Groups and the anchor being

- [ ] Rework sessions so a player controls characters rather than a browser being one player: a player's characters can be in different groups, several can be in the same group, and the UI switches between them without changing tabs
- [ ] Groups belong to the anchor being, start in its starting zone, and are limited to the universe's group size
- [ ] Invite links: random, unguessable tokens; single or multi-use; valid for 1 day, 1 week or indefinitely; Copy Link
- [ ] Opening an invite: character selection (characters already in a group grayed out, create a character), or a "group is full" message
- [ ] Leaving: a member can leave; the anchor being leaving disbands the group
- [ ] Links that require the whole group are refused while any member (including the anchor being) is missing
- [ ] Group rooms are created from the database when a member returns, and save and dispose when everyone has left
- [ ] Enter Universe: return to your last character's group, or to the lobby as that character if the group isn't running or is gone
- [ ] Listing groups in the lobby (once its design is decided)

**Done when:** a player invites friends by link, one player brings several characters into the group, and the group picks up where it was after everyone logs off and back on.

## Phase 12: Time, vision and world state

- [ ] Game clock per group: standing still passes no time, walking a square takes a set time (to be defined), a combat round is 6 seconds
- [ ] Passage of time per zone with `inherit`; fixed times of day; `faerie` (time of day from map position and "where is morning"; faerie zones can't loop)
- [ ] Lobby tab: lobby time (fixed, real-time from the Unix epoch with a day of 1-240 hours, or faerie)
- [ ] Day and night rendering
- [ ] Vision as a pure function with tests: vision budget, tile vision costs, lower at night unless the character has darkvision
- [ ] Decide where vision runs. Prefer the server, sending each client only what it can see (Colyseus `StateView`)
- [ ] World state per group, stored as a diff of the universe: explored areas first. Deleted when the group disbands
- [ ] Offline group members (the summoning ring, if chosen)

**Done when:** a group watches day turn to night as it explores, sees less at night unless it has darkvision, can't see past mountains, and its explored areas are remembered after a restart.

## Phase 13: Authentication and accounts

- [ ] Choose an approach (own JWT login route vs. a hosted auth provider). If choosing `@colyseus/auth`, check its `npm audit` findings first
- [ ] Google and Discord login through OAuth, recommended on the login and register pages
- [ ] Local accounts: email-based logins, passwords hashed with a modern KDF (e.g. argon2id), and the email code rules from `STRUCTURE-OVERVIEW.md` as pure functions with tests
- [ ] Email sending service; register, forgot password and change email flows, with notification emails. A password change signs the account out everywhere
- [ ] Optional 2FA
- [ ] Account linking when a provider login and a local account share an email
- [ ] Replace the name-only login
- [ ] Verify tokens in `onAuth`; reject unauthenticated joins. Tokens are short-lived with a pinned algorithm, and `exp`, `iss` and `aud` are checked
- [ ] Client login flow passing the token in join options
- [ ] Rate-limit login, signup and reset routes; use generic error messages that don't reveal whether an account exists
- [ ] Log auth events (logins, failures, resets) without passwords or tokens
- [ ] Tests for expired tokens, tokens for deleted users, another user's resource IDs and replayed codes
- [ ] Profile edit and view, with character visibility and the player's language (used ahead of the browser's settings)
- [ ] Emails written in the recipient's language
- [ ] Account deletion (handling universes with no other creator and groups the user anchors), data export and a privacy policy
- [ ] Review against sections 1-3 and 5 of `SECURITY-PRACTICES.md`

**Done when:** only authenticated players can join, their identity maps to a DB row, and local accounts can register and reset passwords by email.

## Phase 14: Universe management

- [ ] Editors tab: creators, builders, beta testers and translators (with their languages), with permissions checked on the server
- [ ] Stages: who can play in each (`in the beginning`: creators and builders; `prologue`: beta testers; `end of time`: view only) and which are listed on Home
- [ ] Disabling things players are using: the warnings and options for races, classes, zones, items and group size
- [ ] Universe languages: a source language and the languages it's translated into, shown on Home
- [ ] Translations stored in one table (universe, what the text belongs to, field, language, text, and a hash of the source text it was made from) through a repository, with the fallback order from `STRUCTURE-OVERVIEW.md` as a pure function with tests
- [ ] Universe text reaches each client in its own language outside the Schema (which sends the same state to everyone in a room): synced state carries IDs, and the client fetches the universe's text in its language once, cached with an ETag
- [ ] Translations tab: the table of universe text with its filters, editors' notes for translators, and updating or confirming out-of-date translations
- [ ] Universe versions: build a new version while players play the current one, then switch to it. A version includes its translations
- [ ] Server admins: disable universes, and edit universes that have gone dormant

**Done when:** a team of editors and beta testers takes a universe from `in the beginning` to `let there be light`, and a creator can disable a race without breaking its existing characters. A translator adds French to the universe, and a French player sees it in French.

## Phase 15: Cloud deployment

Neon and Colyseus Cloud cost money, so this waits until the game is worth testing with outside players.
The first deploy tends to surface WebSocket, TLS and environment issues, so leave time for it.

- [ ] Choose where the production client is hosted (Colyseus Cloud only hosts the game server), and whether QA/staging uses a subdomain or its own domain
- [ ] Create Neon project with `dev` and `prod` branches, in the region nearest the planned Colyseus Cloud location. Use Postgres 18 to match `docker-compose.yml`
- [ ] Create the migration and app roles on each Neon branch with the same ownership and grants as the scripts in `docker/postgres/init/`, using `docker/postgres/neon/01-roles.sql` and `02-grants.sql` (roles made in the Neon console join `neon_superuser`); the server gets only the app role's pooled connection string
- [ ] Run migrations against Neon `prod`
- [ ] Deploy server with `npx @colyseus/cloud deploy`; set env vars in the dashboard (pooled Neon URL, `ALLOWED_ORIGINS` = the production client origin)
- [ ] Read the client address from Colyseus Cloud's forwarding header, trusted only from its proxy, so per-network rate limits count clients rather than the proxy
- [ ] Point a production client build at the `wss://` endpoint
- [ ] Set security headers on the client host and test them against the production build:
	- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' https://<game server> wss://<game server>; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests` (Phaser needs `data:`/`blob:` for some textures and audio)
	- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`
- [ ] Check whether Colyseus Cloud's proxy sends `Strict-Transport-Security` for the game server; add it if not

**Done when:** two players on different networks can join the same room in the cloud.

## Phase 16: Robustness and polish

- [ ] Reconnection with `allowReconnection` for unexpected disconnects
- [ ] Graceful handling of server restarts during deploys
- [ ] Basic logging and error reporting
- [ ] Neon production autosuspend disabled or lengthened
- [ ] Confirm Neon's point-in-time restore retention and test a restore
- [ ] Alerts for spikes in failed logins and server errors
- [ ] Load test with simulated clients to size the Colyseus Cloud plan
- [ ] Load test the lobby to set its `maxClients`, and open another lobby instance when one is full
- [ ] Right-to-left languages: `dir` on the page, CSS logical properties (`margin-inline-start`) in the SCSS, and Phaser's `rtl` text style

**Done when:** players survive brief network drops and a redeploy without data loss.

## Phase 17: Images and moderation

Needed before universes are open to the public.

- [ ] Choose image storage (object storage, not Postgres). Validate type and size, and re-encode uploads to strip metadata and anything that isn't an image. The CSP's `img-src` will need the storage origin
- [ ] "I have the rights to use this image" on every upload
- [ ] Profile photos, universe logos and banners, tile graphics (Dual-Grid / 47-Tile Blob, possibly per layer)
- [ ] Stock graphics for each ruleset
- [ ] Reporting content and players, copyright infringement reports, and a review queue for server admins

**Done when:** universes can use uploaded art, and anything inappropriate can be reported and taken down.

## Phase 18: Messages

- [ ] Private messages with blocking, reporting and rules for who can message whom
- [ ] Group invites sent by private message
- [ ] A way to tell users with the same name apart, which user search depends on

**Done when:** players can message each other and invite each other to groups, and can block anyone who abuses it.

## Later (not yet specified)

- Combat, monsters, NPCs and dialog (their results go in world state), and gaining experience
- One-off event messages for effects (hits, explosions)
- The overworld map and its scale
- Cross-universe play: the portal room, the Connect to the Multiverse tab, "[Name] of [Universe]"
- Character sprites and avatars, and art for each item
- Large objects such as trees and houses hiding players behind them
- Exporting and importing a universe's translations (JSON or XLIFF), and a translation service such as Weblate for the engine's catalogs

---

## Open decisions

- How long walking a square takes (Phase 12)
- Whether vision runs on the server or the client (Phase 12)
- How groups are listed in the lobby (Phase 11)
- Auth approach, account linking, the email sending service, and whether to add a CAPTCHA (Phase 13)
- Image storage, and the tile graphic formats (Phase 17)
- Telling users with the same name apart (Phase 18)
- Whether a universe can rename engine terms, such as calling gold "crowns" (Phase 14)
- Fonts for map text in scripts the default font doesn't cover (Phase 16)
- Whether to offer machine translation of chat (later)
- Whether to add client-side prediction (after Phase 7, if movement feels laggy)
- Colyseus Cloud deployment location(s) (Phase 15)
- Client host, and a subdomain or separate domain for QA/staging (Phase 15)
