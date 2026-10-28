# PLAN.md

Phased roadmap for building the game locally, then deploying to Colyseus Cloud + Neon.
Each phase ends with a "Done when" check. Tick boxes as work completes and keep the
**Current phase** line updated so each new session knows where to pick up.
`STRUCTURE-OVERVIEW.md` describes the pages, editors and game rules these phases build.

**Current phase:** 14

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

- [✅] Move the inline `<style>` in `client/index.html` to a CSS file so the CSP (Phase 16) doesn't need `'unsafe-inline'`
- [✅] In the GitHub repository's Settings > Advanced Security, turn on Dependabot alerts, Dependabot security updates and secret scanning with push protection (`.github/dependabot.yml` already configures version updates, and gitleaks runs in the pre-commit hook)
- [✅] Add a `docker-compose` entry to `.github/dependabot.yml`
- [ ] Add a `github-actions` entry to `.github/dependabot.yml` once there are workflows
- [✅] Review `npm audit`: the known low/moderate findings come from `@colyseus/auth` (bundled with `colyseus`, unused; its `grant` dependency pulls in the flagged `elliptic` and `uuid`) and the old `esbuild` under `drizzle-kit` (dev-only; the advisory concerns esbuild's dev server, which drizzle-kit doesn't run); don't run `npm audit fix --force`, which downgrades Colyseus

**Done when:** GitHub's security features are on and `npm audit` has no unexplained findings.

## Phase 5: Lobby and groups

- [✅] Lobby: name-only login (in memory until Phase 14), chat, who's online, and a Create game button
- [✅] Groups of up to 6 players, each in its own game room; a player is in one group at a time and can leave it
- [✅] Rate limits on room messages (`maxMessagesPerSecond`) and on chat

**Done when:** players can log in by name, chat in the lobby, and move around together in a group's room.

## Phase 6: Persistence

- [✅] Test database (`kiln_test`) for the test suite: migrated before the tests run and emptied before each test
- [✅] `playerRepo`: the name-only login loads the player with that name (ignoring capitals) or creates them, so a name is the whole login until Phase 14. A player can be logged in from one browser at a time
- [✅] The player is loaded when they log in. Nothing changes during play yet, so there is nothing to save in `onLeave` / `onDispose` until characters exist (Phase 10)
- [✅] A test that fails if the database is used while players move

**Done when:** a player's identity survives a server restart, and the test suite runs against its own database.

## Phase 7: Universes, areas and maps

The game runs on real universe data. Content comes from a seed script until the editor exists (Phase 8).

Built in three steps: data and logic, then rooms, then the client.

- [✅] Tables: `universes` (name, descriptions, stage, ruleset, passage of time, lobby and starting areas), `areas` (universe, parent, name, enabled, indoors, default tile, bounds, loops, passage of time), `tiles` (ruleset defaults plus each universe's own tiles), `map_chunks` and `area_links`. Edited copies of default tiles come with the tile editor (Phase 8)
- [✅] Store map cells in chunks of 32 x 32, saving only chunks that differ from the area's default tile: a map can be 50,000 tiles in each direction
- [✅] PF1E default tiles (Grass, Forest, Desert, Mountains, Water, Wood Floor), added by a migration
- [✅] Seed script for a sample universe (`npm run db:seed -w server`): a town square lobby with a cottage and a cellar, and a crossroads for groups that loops east-west. Run by hand like migrations, never on startup
- [✅] Pure logic with tests: walk time per tile (twice the default = half speed, 0 = impassable), map bounds around 0,0, no cutting past impassable corners, wrapping in areas that loop, stopping on automatic links, finding a free cell to arrive in
- [✅] Rename today's global `LobbyRoom` to `SessionRoom` (login, account, group membership), and add a `LobbyRoom` per universe (`filterBy` the universe ID) with the map, chat, who's here and Create game. Groups belong to a universe and start in its starting area
- [✅] A room holds every area its players are in; each player has an area, and each client only sees the players in its own area (`StateView`, one per client for now)
- [✅] Rooms load area maps at lifecycle boundaries, and load the next area before a player moves into it, never inside the tick
- [✅] `GET /universes` lists the universes Home shows, a page at a time
- [✅] Client draws tiles by color from the area data (graphics come in Phase 13), drawing only the chunks near the camera. The server still sends the whole area (see Phase 8)
- [✅] Looping areas wrap seamlessly: near an edge the client draws the far side's chunks beyond it, players on the far side appear across the edge, and stepping over the edge doesn't jump the camera or the player
- [✅] Area links: automatic links move you, manual links offer a prompt (press E)
- [✅] The lobby screen shows the lobby's map next to chat and who's here, so players can walk around it
- [✅] Home page: universes in `let there be light` (paginated from the start), the universe overview, and Enter Universe -> that universe's lobby. Leaving the lobby goes back to Home; the long description is shown as plain text until Markdown rendering (Phase 8)

**Done when:** a player picks a universe on Home, walks its lobby's map (blocked by mountains and water, slowed by forest) and walks through a door into a house.

## Phase 8: World editor

Built in four steps: the server API, the editor pages, the map editor, then loading chunks as players approach them.

- [✅] Editor API as REST routes in `server/src/http/` backed by repositories (editing isn't real-time, so it doesn't need a room). Every request checks the user may edit that universe, and validates against the same limits as the UI. Who may edit is stored in `universe_editors` (creator, builder, beta tester; Phase 15 adds the Editors tab), and until logins exist (Phase 14) a request's player is the one its browser ID cookie is logged in as
- [✅] Create Universe modal (name, 1-sentence description, ruleset), up to 5 per user. Creates a lobby area and a default area as every race's starting area, and makes the user its creator. Home lists the universes the user has a role in, which opens them in the editor
- [✅] Edit Universe page: name, descriptions (markdown rendered sanitized with `marked` and DOMPurify, also on Home's overview), stage, ruleset, passage of time. Logo and banner wait for image storage (Phase 18). A Lobby tab opens the lobby's area until the rest of the tab arrives (Phase 12)
- [✅] Tilesets tab (filters for name, passable, custom and edited; pagination) and tile editor (name, indoors, color, vision cost, walk time)
- [✅] Areas tab with the single-area drill-down, and the area editor's settings. Its map is the next item
- [✅] Map editor: grid centered on 0,0, expand buttons, edit-size dialog with its warning, draw tool (a tile or Void; size 1-100; circle or square), undo/redo with a drag counted as one step. It loads chunks as the view reaches them, pans with the right or middle mouse button and zooms with the wheel. Undo covers painting; resizing to a smaller map clears the undo history
- [✅] Area link layer: automatic or manual, "requires the whole group", select destination coordinates with an optional return link (placed in the target area, leading back to the link's cell)
- [✅] Edits apply immediately (universe versions come in Phase 15): the editor routes tell open rooms in this process about changed cells, areas, links and tiles (`areaChanges`), and the rooms update the areas they have loaded and their clients. Players a smaller map leaves out move to the nearest free cell inside it; players in a deleted area go to the lobby area (lobby) or starting area (group)
- [✅] Rooms load an area's chunks as players come near them and drop chunks nobody is near, instead of loading the whole map (`loadArea` reads only the area's settings, links and tiles), since the editor can make maps up to 50,000 cells per side. Loading stays outside the tick, on a 250 ms interval: a player waits at the edge of a chunk that hasn't arrived yet. Clients are likewise sent only the chunks near their player (`AreaPayload`, then `ChunksPayload` as they move)

**Done when:** a universe can be built from scratch in the browser (tiles, areas, maps and links) and played in its lobby.

## Phase 9: Localization groundwork

From here on, all text players read can be translated (see Localization in `STRUCTURE-OVERVIEW.md`), so the PF1E content in Phase 10 is translatable from the start. English is the only language for now.

- [✅] Messages are written in the code: each has an ID, its English text, and a description for translators saying what it is and where it appears (e.g. "Button that stores the form's changes in the database", so German picks "Speichern" and not "Retten"). Each is an object literal where it's used (`t({ id, defaultMessage, description })`), or declared with `defineMessages()` when it's used in more than one place or looked up from a table; text in the pages' HTML is marked with `data-message` and `data-translation-context` attributes instead, and the client's Vite config strips `data-translation-context` from the pages it serves and builds. The same English in two places gets two IDs, so each can be translated on its own
- [✅] The extractor (`npm run messages`, `shared/scripts/extractMessages.ts`) writes `shared/locales/en.json`, with the descriptions, from the code and pages. `npm run lint` and the pre-commit hook fail when the catalog isn't current, when a message has no description, when one ID has two different English texts, or when text in a page isn't marked. It uses the TypeScript compiler API rather than `formatjs extract`, whose dependencies have open high-severity advisories. Other languages' catalogs sit beside it
- [✅] `Translator` in `/shared` over `intl-messageformat` (ICU messages, for plurals and other grammar), and on the client `t()`, `formatList()` and the page's locale for `Intl` formatting. Other languages' catalogs load on demand with `import.meta.glob`. Until profiles exist (Phase 14), the player's language comes from the browser's settings
- [✅] Move the client's hard-coded text into messages, along with the enum labels (stages, roles, passage of time, faerie mornings, `RULESET_NAMES`)
- [✅] The server sends a `LocalizedMessage` (ID, English text and values) instead of English, through `sendError()` for every HTTP error. New universes' area names are messages too, in English until the creator's language is known
- [✅] Default tiles' names are engine messages (`DEFAULT_TILE_NAMES`) found by their `key`; a universe's edited copy stores a name only when it was renamed. The Tilesets tab's name filter still matches those names in English, since the server has no translations
- [✅] A pseudo-language (`?locale=en-XA` in development), loaded as a catalog like any other language: the client's dev server writes it and `en.json` whenever a file with messages is saved, and production builds leave it out. An ESLint rule against literal text in the UI and in error responses, and a test that every translation parses and uses the same arguments as its English
- [✅] Add the rule to `CLAUDE.md`: text players read is a message with an ID, English text and a description
- [✅] Pirate (`en-x-pirate`), a test language shipped in production builds, and a language picker in the footer that the browser remembers until profiles exist. Each translation stores the English it was made from, and `npm run messages` reports each language's missing and out-of-date messages (players see English, or the old translation, until it's updated)

**Done when:** every page shows no untranslated text in the pseudo-language, and the English catalog is extracted from the code with a description for every message.

## Phase 10: Characters and the PF1E ruleset

Built in seven steps: licensing and the ruleset module; the Ruleset tab and the universe's character settings; items; races and classes; characters; the lobby with characters; then the character sheet and finishing.

1. Licensing and the ruleset module
	- [✅] Review the Pathfinder 1E licensing (the OGL 1.0a and Paizo's terms for the "Pathfinder" name) before adding PF1E data, and add the required notices: the OGL with its Section 15 notices and Paizo's Community Use Policy notice, on the license page
	- [✅] Rulesets as modules (PF1E first): abilities, sizes, races, classes, stat methods, settings and default items, with their names as engine messages
	- [✅] Game rules as pure functions with tests: dice rolling (with the random source passed in), PF1E point buy costs (7 = -4 up to 18 = 17, scores 7-18 before racial modifiers), ability modifiers, the money field ("1pp 2gp 2sp 4cp", kept as pieces of each coin and never converted automatically) and the money changer's conversion to the fewest coins
2. Ruleset tab and the universe's character settings
	- [✅] Ruleset tab: stat rolling (3d6 variants, 4d6 variants, the point buy budgets and a custom budget), plus the sleep, weight and ammo settings (stored now, used later)
	- [✅] Characters tab: group size, starting money and starting area, with the area selection modal
3. Items
	- [✅] Items tab, item editor (name, type, enabled) and the PF1E default items (a dagger for now); item selection with quantities
	- [✅] Characters tab: starting equipment (a dagger for everyone by default)
4. Races and classes
	- [✅] Races and Classes tabs with their overrides, custom races and classes, and the PF1E fields (ability modifiers, floating bonus, darkvision, size, primary ability, tradition, casting style)
	- [✅] Each race's and class's starting equipment, money and area, and the class's per-race areas; the starting area's precedence (class + race > class > race > universe) as a pure function with tests
5. Characters
	- [✅] Create Character: the server rolls the stats, and the player can rearrange the rolled scores among the abilities (the class's primary ability is a hint); point buy choices are validated on the server (the client never sends ability scores); up to 20 per universe; starting equipment and money
6. Lobby with characters
	- [✅] Ghosts (invisible, don't block cells, can read but not send chat), choosing and switching characters, chatting as your character; Create game needs a character. The lobby starts a player as the character they played or made most recently (`characters.last_played_at`, saved as they leave); the group room still uses the login name until Phase 11
7. Character sheet and finishing
	- [✅] Character sheet modal
	- [✅ Check the new screens in the pseudo-language, update Pirate, and add keyboard shortcuts and screen reader text for the new dialogs

**Done when:** a player creates a PF1E character with rolled stats and starting gear, then walks and chats as them in the lobby while ghosts watch.

Alongside it, a basic Starfinder 1E ruleset (see SF1E in `STRUCTURE-OVERVIEW.md`), with a few fields from each step; the rest of the ruleset comes later:
- [✅] Licensing: the Starfinder Core Rulebook in the OGL's Section 15, and the Community Use Policy covering the name
- [✅] Money as each ruleset's coins (credits for SF1E), stored in a column per coin
- [✅] Ruleset tab (ability points, sleep, ammo), races (hit points), classes (key ability, hit and stamina points), themes on the Characters tab, default tiles and a survival knife
- [✅] Create Character with a theme step and ability points, and the character sheet's theme, hit points and stamina points

## Phase 11: Groups and the anchor being

- [✅] Rework sessions so a player controls characters rather than a browser being one player: a player's characters can be in different groups, several can be in the same group, and the UI switches between them without changing tabs (each window plays one character; see Create Group in `STRUCTURE-OVERVIEW.md`)
- [✅] Groups belong to the anchor being, start in its starting area, and are limited to the universe's group size
- [✅] Invite links: random, unguessable tokens; single or multi-use; valid for 1 day, 1 week or indefinitely; Copy Link. Only the anchor being's player makes them
- [✅] Opening an invite: character selection (characters already in a group grayed out, create a character), or a "group is full" message
- [✅] Leaving: a member can leave; the anchor being leaving disbands the group
- [✅] Links that require the whole group are refused while any member (including the anchor being) is missing; when everyone is together, the whole group goes through
- [✅] Group rooms are created from the database when a member returns, and save and dispose when everyone has left
- [✅] Enter Universe: return to your last character's group, or to the lobby as that character if the group is gone
- [ ] Listing groups in the lobby (once its design is decided)
- [✅] Difficulty levels on the Characters tab (default, name, mob scale, permadeath), with Story, Normal, Hard and Hardcore in every universe; Create Group chooses one and saves it to the group. The hit point and chance to hit scaling are pure functions with tests, used once combat exists

**Done when:** a player invites friends by link, one player brings several characters into the group, and the group picks up where it was after everyone logs off and back on.

## Phase 12: Time, vision and world state

Decided: walking a square takes the tile's walk time in game time (10 seconds by default indoors and 10 minutes outdoors, crossed at the same speed on screen; 0 is impassable); vision runs on the server, which shows each client only the players it can see, and the client runs the same shared function to draw fog over the tiles it already has; world state remembers the areas a group has explored and the cells it has seen in them; the summoning ring waits for items and NPCs.

Built in three steps: time, vision, then world state.

1. Time
	- [✅] Time of day as pure functions in `/shared` with tests: fixed times, flowing time from a clock, real time from the Unix epoch, faerie time from map position, daylight, and each area's passage of time resolved through `inherit`
	- [✅] Game clock per group, saved with the group: standing still passes no time, walking a square takes the tile's walk time, a combat round is 6 seconds
	- [✅] Tiles are for indoors, outdoors, both or neither, and an area's draw tool and default tile offer only the tiles for its kind. Outdoor tiles default to 10 minutes. The Tilesets tab shows where each tile is used and filters by it
	- [✅] Lobby tab: lobby time (fixed, real-time from the Unix epoch with a day of 1-240 hours, or faerie)
	- [✅] Day and night rendering, and the time of day for screen readers
2. Vision
	- [✅] Vision as a pure function in `/shared` with tests: vision range, tile vision costs, shorter at night unless the character has darkvision
	- [✅] The server shows each client only the players its group can see (`StateView`); the client draws fog with the same function
3. World state
	- [✅] World state per group, stored as a diff of the universe: the areas explored and the cells seen in them, deleted when the group disbands
	- [✅] Seen cells drawn dimmed, unseen ones black
	- [✅] Check the new screens in the pseudo-language, update Pirate, and add screen reader text

**Done when:** a group watches day turn to night as it explores, sees less at night unless it has darkvision, can't see past mountains, and its explored areas are remembered after a restart.

## Phase 13: Tilesets

Decided:
- Cells are 32 world units (`GRID_CELL_SIZE`), the size most tile art is drawn at.
- The ground layer uses the Dual-Grid System: each tile's graphic is 16 frames of one cell, drawn on the corners where 4 cells meet, half a cell up and left of the cells (the sheet layout is under the tile editor in `STRUCTURE-OVERVIEW.md`). Phaser has no autotiling, so the client picks the frames.
- A tile graphic's format is set per layer, never per tile within a layer: Dual-Grid tiles are drawn half a cell off the cells, so they can't meet another format cleanly. Not per area kind either, since a tile can be for both indoors and outdoors. Tiles with 47-Tile Blob Set graphics, such as hedges, are drawn in their own layer over the ground. A cell still holds one tile, so the ground under one is drawn as the area's default tile. Stone walls drawn as their tops are Dual-Grid: anything made of edges and corners can be, and then the floor beside a wall shows through its corners.
- Forests are one Dual-Grid sheet, its treetops drawn over its floor, and players are drawn over the trees. A canopy in a layer over players, see-through around the player's own character, was tried and dropped: hiding players and uncovering them didn't look right. Ordinary 32x32 frames can still draw treetops rising half a cell above the forest's north edge (the frames on that edge cover half of the cells north of it), so trees 1.5 cells tall need no taller frames; taller trees would need taller frames (32x64 for a full cell).
- Impassable tiles with graphics, such as mountains 1.5 cells tall, are drawn again in a layer over players, cut down to what they draw over the cell north of them. No player can stand on them, so this puts a player north of a mountain behind its peaks without the hiding and uncovering that ruled out the forest canopy. The fog is drawn over that layer.
- Distinctive buildings and lone trees are placed objects, not tiles (see Later).
- Graphics only change what the client draws: movement, vision and the server don't change.
- The engine ships default graphics as files in the client (`client/src/assets/tilesets/`), and a universe's editors can upload their own tilesets: PNG Dual-Grid sheets 128x128, each with a name and a draw order. Uploads go to S3-compatible object storage (SeaweedFS locally, any S3-compatible service in production), which pulls image storage forward from Phase 18. Uploading and deleting tilesets wait for the Tilesets tab's Save like every editor change. The server checks and re-encodes each upload, the uploader confirms they have the rights to use it, and the game server serves it to anyone at `/tile-graphics/<ID>.png`, cached for good since an upload never changes.

- [✅] Cells are 32 world units; a step takes 0.16 seconds
- [✅] A sample Dual-Grid grass sheet (`client/src/assets/tilesets/grass.png`)
- [✅] Blob graphics (the 47-Tile Blob Set) drawn in a walls layer over the ground, each cell's frame picked from its 8 neighbors, with a sample hedge sheet (`client/src/assets/tilesets/hedge.png`) used by the sample universe's Hedge; its Stone Wall uses a Dual-Grid sheet of a wall top (`stoneWall.png`)
- [✅] Uploading blob tilesets: the upload dialog chooses the layout (matched to the image's size), each upload stores its format, and the server checks the image against that format's size; a blob sheet has no draw order
- [✅] `AreaRenderer` draws a tile's Dual-Grid graphic, falling back to its color: frames picked from each corner's 4 cells, wrapping on areas that loop, with void, unseen and out-of-bounds cells counting as another tile
- [✅] Several tiles meeting: each graphic has a draw order in `TILE_GRAPHICS` (which graphic's edges overlap which; tiles drawn in their colors go below every graphic), and one frame is drawn for each combination of 4 corner tiles as it appears, cached in an atlas, so each piece stays one layer
- [✅] A piece is redrawn when a chunk next to it changes, since its edge cells depend on it; painting a cell redraws the 4 frames touching it
- [✅] Grid lines drawn as an overlay, not baked into each tile
- [✅] A tile's graphic chosen from sheets that ship with the engine or the universe's uploaded tilesets, shown in the tile editor with its day and night preview
- [✅] Uploading tilesets from the tile editor, staged until the Tilesets tab is saved: object storage, checking and re-encoding, the rights confirmation, and drawing maps with them once they load (tiles show their colors until then)
- [✅] Deleting an uploaded tileset from the tile editor, after asking, staged until the tab is saved; tiles drawn with it go back to their colors
- [ ] Removing a universe's uploads from storage when the universe is deleted (once universes can be deleted)
- [✅] The editor's Save saves every tab's changes together, all or nothing, as `STRUCTURE-OVERVIEW.md` describes: one request (POST `/:universeId/changes`, `server/src/http/editorChanges.ts`) saves them in one transaction, in place of a route for each change, and a change can name what an earlier one in the same save makes
- [✅] The Areas tab's maps draw the Tilesets tab's staged changes: changed colors and graphics, new tiles, staged uploads (from the page's own copy), and tiles staged for deletion drawn as their chosen replacements, including as an area's default tile. The draw tool and the default tile choices offer new tiles and stop offering tiles staged for deletion, and painting staged on the Areas tab with such a tile is saved as its replacement
- [✅] The area previews in the link and starting area dialogs draw the Tilesets tab's staged changes too
- [✅] Graphics for the ruleset's default tiles (grass, and PF1E's forest and mountains, so far)
- [✅] Check the new screens in the pseudo-language, update Pirate, and add screen reader text

**Done when:** an outdoor area painted with grass, dirt and forest shows smooth edges where they meet, the forest's treetops rise over the cells north of it, and painting in the map editor updates the edges as it paints.

## Phase 14: Authentication and accounts

Decided:
- Built in-house, not with a hosted provider or `@colyseus/auth`: the email code rules in `STRUCTURE-OVERVIEW.md` are more specific than a provider offers. A small OAuth library (such as `arctic`) handles Google and Discord, and passwords are hashed with Argon2id.
- Sessions live on the server (a `sessions` table) and reach the browser as an HttpOnly `__Host-` cookie, in place of today's browser ID cookie; there are no JWTs. `onAuth` looks the session up, a lifecycle boundary. Logging out, or changing the password, deletes sessions on the server, so a password change signs the account out everywhere. Production therefore needs the client and game server on the same site (e.g. `play.<domain>` and `api.<domain>`), which Phase 16's hosting choice has to keep.
- Session lifetimes (see Login in `STRUCTURE-OVERVIEW.md`): 1 hour idle and 24 hours in all without "Remember me"; with it, 30 days idle and 90 days in all. An open connection to a room counts as activity.
- Every account has a unique handle, for finding users and invites, and a display name that needn't be unique. The name-only login's data is dropped rather than carried over, and the seed script's `--creator` names a handle.
- Linking: a provider login whose email matches a local account is never linked automatically. The player proves they own the local account (its password, or an email code) to link them; providers can also be linked from the profile.
- Email is sent over SMTP with `nodemailer`, so the service is configuration (chosen in Phase 16), and caught by Mailpit in `docker-compose.yml` locally. Emails are HTML, with a plain text part, in the recipient's language.
- Rate limits and the email code counters are Postgres rows updated atomically, so they hold across several server processes. The client's network comes from one function, which Phase 16 teaches to read the proxy's forwarding header.
- Passwords are at least 8 characters, with no composition rules, and are checked against HaveIBeenPwned's k-anonymity API (only the first 5 characters of the password's SHA-1 hash leave the server).
- 2FA is TOTP with recovery codes, for local accounts only; provider logins rely on the provider's 2FA. Passkeys can come later. No CAPTCHA for now.
- Home, universe pages and the license and privacy pages are public; the lobby, game, editor, Create Character and profile edit need a login.
- Auth events (logins, failures, logouts, resets, email and password changes, 2FA changes, linking) go in an `auth_events` table: the account if known, the kind, the time, and the network as a keyed hash, never passwords, codes or session IDs. They are kept 90 days, and deleted with the account.
- Deleting an account asks first about each universe the player is the only creator of: hand it to another of its editors as creator, or delete it. Groups the player anchors disband, as when the anchor being leaves. Data export is one JSON file.

Built in two steps: logins (sessions, providers, local accounts, email codes, replacing the name-only login), then accounts (2FA, linking, profile, deletion, export and the security review).

1. Logins
	- [ ] `sessions` table and session cookie; `onAuth` checks the session and rejects joins without one
	- [ ] Google and Discord login through OAuth, recommended on the login and register pages
	- [ ] Local accounts: email-based logins, Argon2id, the HaveIBeenPwned check, and the email code rules from `STRUCTURE-OVERVIEW.md` as pure functions with tests
	- [ ] Email through `nodemailer`, Mailpit in `docker-compose.yml`; register, forgot password and change email flows, with notification emails in the recipient's language
	- [ ] Handles and display names; drop the name-only login and its data
	- [ ] Rate-limit login, signup and reset routes; use generic error messages that don't reveal whether an account exists
	- [ ] Log auth events to `auth_events`, deleting them after 90 days
	- [ ] Tests for expired and logged-out sessions, sessions of deleted users, another user's resource IDs and replayed codes
2. Accounts
	- [ ] Optional 2FA (TOTP and recovery codes)
	- [ ] Account linking
	- [ ] Profile edit and view, with character visibility and the player's language (used ahead of the browser's settings)
	- [ ] Account deletion and data export
	- [✅] Privacy policy page (`privacy.html`, linked from the footer), drafted; check it against what was built, and set its date, before players use the site
	- [ ] Review against sections 1-3 and 5 of `SECURITY-PRACTICES.md`

**Done when:** only authenticated players can join, their identity maps to a DB row, and local accounts can register and reset passwords by email.

## Phase 15: Universe management

- [ ] Editors tab: creators, builders, beta testers and translators (with their languages), with permissions checked on the server
- [ ] Stages: who can play in each (`in the beginning`: creators and builders; `prologue`: beta testers; `end of time`: view only) and which are listed on Home
- [ ] Disabling things players are using: the warnings and options for races, classes, areas, items and group size
- [ ] Universe languages: a source language and the languages it's translated into, shown on Home
- [ ] Translations stored in one table (universe, what the text belongs to, field, language, text, and a hash of the source text it was made from) through a repository, with the fallback order from `STRUCTURE-OVERVIEW.md` as a pure function with tests
- [ ] Universe text reaches each client in its own language outside the Schema (which sends the same state to everyone in a room): synced state carries IDs, and the client fetches the universe's text in its language once, cached with an ETag
- [ ] Translations tab: the table of universe text with its filters, editors' notes for translators, and updating or confirming out-of-date translations
- [ ] Universe versions: build a new version while players play the current one, then switch to it. A version includes its translations
- [ ] Server admins: disable universes, and edit universes that have gone dormant
- [ ] Only server admins can see and use the admin page (`admin.html` and `/admin/settings`), which anyone can use until then. The privacy policy reads the character deletion days from `/admin/settings`, so anyone must still be able to read that setting

**Done when:** a team of editors and beta testers takes a universe from `in the beginning` to `let there be light`, and a creator can disable a race without breaking its existing characters. A translator adds French to the universe, and a French player sees it in French.

## Phase 16: Cloud deployment

Neon and Colyseus Cloud cost money, so this waits until the game is worth testing with outside players.
The first deploy tends to surface WebSocket, TLS and environment issues, so leave time for it.

- [ ] Choose the S3-compatible service for uploads, make its bucket (private: the game server serves the files), and set the `STORAGE_*` variables in the Colyseus Cloud dashboard
- [ ] Choose where the production client is hosted (Colyseus Cloud only hosts the game server), and whether QA/staging uses a subdomain or its own domain. The host must serve `<name>.html` for `/<name>` (the pages link to `/edit`, `/license` and so on), and each of `PATH_PAGES` for every address under its path, such as `game.html` for `/game/<slug>`, `universe.html` for `/universe/<slug>` and `edit.html` for `/edit/<universe ID>`; see `client/src/pages.ts`
- [ ] Create Neon project with `dev` and `prod` branches, in the region nearest the planned Colyseus Cloud location. Use Postgres 18 to match `docker-compose.yml`
- [ ] Create the migration and app roles on each Neon branch with the same ownership and grants as the scripts in `docker/postgres/init/`, using `docker/postgres/neon/01-roles.sql` and `02-grants.sql` (roles made in the Neon console join `neon_superuser`); the server gets only the app role's pooled connection string
- [ ] Run migrations against Neon `prod`
- [ ] Deploy server with `npx @colyseus/cloud deploy`; set env vars in the dashboard (pooled Neon URL, `ALLOWED_ORIGINS` = the production client origin)
- [ ] Read the client address from Colyseus Cloud's forwarding header, trusted only from its proxy, so per-network rate limits count clients rather than the proxy
- [ ] Point a production client build at the `wss://` endpoint
- [ ] Set security headers on the client host and test them against the production build:
	- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://<game server>; media-src 'self' data: blob:; connect-src 'self' https://<game server> wss://<game server>; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests` (Phaser needs `data:`/`blob:` for some textures and audio; the game server in `img-src` is for uploaded tilesets)
	- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`
- [ ] Check whether Colyseus Cloud's proxy sends `Strict-Transport-Security` for the game server; add it if not

**Done when:** two players on different networks can join the same room in the cloud.

## Phase 17: Robustness and polish

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

## Phase 18: Images and moderation

Needed before universes are open to the public.

- [✅] Image storage: S3-compatible object storage (`server/src/storage/`), with uploads validated and re-encoded to strip metadata and anything that isn't an image (`server/src/images/`); done for tilesets in Phase 13. The production service is chosen with the deployment (Phase 16)
- [ ] "I have the rights to use this image" on every upload (tilesets have it)
- [ ] Profile photos, universe logos and banners (tilesets are uploaded since Phase 13)
- [ ] Stock graphics for each ruleset
- [ ] Reporting content and players, copyright infringement reports, and a review queue for server admins

**Done when:** universes can use uploaded art, and anything inappropriate can be reported and taken down.

## Phase 19: Messages

- [ ] Private messages with blocking, reporting and rules for who can message whom
- [ ] Group invites sent by private message
- [ ] A way to tell users with the same name apart, which user search depends on

**Done when:** players can message each other and invite each other to groups, and can block anyone who abuses it.

## Later (not yet specified)

- Combat, monsters, NPCs and dialog (their results go in world state), and gaining experience. Mobs' hit points and every chance to hit go through the group's difficulty level (`scaleMobHitPoints()` and `scaleHitChance()` in `server/src/logic/difficulty.ts`), and a character who dies in a group with permadeath is gone for good
- Offline group members: the summoning ring (see Offline group members in `STRUCTURE-OVERVIEW.md`)
- Money changers: NPCs who change a character's coins into the fewest coins of the same worth (`changePf1eMoney`), perhaps for a fee
- One-off event messages for effects (hits, explosions)
- The overworld map and its scale
- Cross-universe play: the portal room, the Connect to the Multiverse tab, "[Name] of [Universe]"
- Character sprites and avatars, and art for each item
- Placed objects for distinctive buildings and lone trees: made once and placed in any number of areas, each with an image, the cells it covers (each with its own walk time and vision cost, read by the server), the part drawn above players, and door cells for area links. Placements are a list per area, not cells in its chunks. An Objects tab and a place tool in the map editor. Building interiors are indoor areas, as now
- Walls as a layer of their own, so a cell holds a ground tile and a wall over it, rather than walls drawn over the area's default tile
- Tall walls with a front face: blob frames 32x64 drawn over the row south of the wall, and over players standing there
- Exporting and importing a universe's translations (JSON or XLIFF), and a translation service such as Weblate for the engine's catalogs

---

## Open decisions

- Whether character names must be unique within a universe (Phase 10)
- How groups are listed in the lobby (Phase 11)
- Auth approach, account linking, the email sending service, and whether to add a CAPTCHA (Phase 14)
- Which S3-compatible service stores uploads in production, and its bucket (Phase 16)
- Telling users with the same name apart (Phase 19)
- Whether a universe can rename engine terms, such as calling gold "crowns" (Phase 15)
- Fonts for map text in scripts the default font doesn't cover (Phase 17)
- Whether to offer machine translation of chat (later)
- Whether to add client-side prediction (after Phase 7, if movement feels laggy)
- Colyseus Cloud deployment location(s) (Phase 16)
- Client host, and a subdomain or separate domain for QA/staging (Phase 16)
