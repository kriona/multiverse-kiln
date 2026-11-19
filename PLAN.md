# PLAN.md

Phased roadmap for building the game locally, then deploying to Colyseus Cloud + Neon.
Each phase ends with a "Done when" check. Tick boxes as work completes and keep the
`STRUCTURE-OVERVIEW.md` describes the pages, editors and game rules these phases build.

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

- [✅] Move the inline `<style>` in `client/index.html` to a CSS file so the CSP doesn't need `'unsafe-inline'`
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

## Phase 7: Universes and areas

The game runs on real universe data. Content comes from a seed script until the editor exists (Phase 8).

Built in three steps: data and logic, then rooms, then the client.

- [✅] Tables: `universes` (name, descriptions, stage, ruleset, passage of time, lobby and starting areas), `areas` (universe, parent, name, enabled, indoors, default tile, bounds, loops, passage of time), `tiles` (ruleset defaults plus each universe's own tiles), `area_chunks` and `area_links`. Edited copies of default tiles come with the tile editor (Phase 8)
- [✅] Store area cells in chunks of 32 x 32, saving only chunks that differ from the area's default tile: an area can be 50,000 tiles in each direction
- [✅] PF1E default tiles (Grass, Forest, Desert, Mountains, Water, Wood Floor), added by a migration
- [✅] Seed script for a sample universe (`npm run db:seed -w server`): a town square lobby with a cottage and a cellar, and a crossroads for groups that loops east-west. Run by hand like migrations, never on startup
- [✅] Pure logic with tests: walk time per tile (twice the default = half speed, 0 = impassable), area bounds around 0,0, no cutting past impassable corners, wrapping in areas that loop, stopping on automatic links, finding a free cell to arrive in
- [✅] Rename today's global `LobbyRoom` to `SessionRoom` (login, account, group membership), and add a `LobbyRoom` per universe (`filterBy` the universe ID) with the area, chat, who's here and Create game. Groups belong to a universe and start in its starting area
- [✅] A room holds every area its players are in; each player has an area, and each client only sees the players in its own area (`StateView`, one per client for now)
- [✅] Rooms load areas at lifecycle boundaries, and load the next area before a player moves into it, never inside the tick
- [✅] `GET /universes` lists the universes Home shows, a page at a time
- [✅] Client draws tiles by color from the area data (graphics come in Phase 13), drawing only the chunks near the camera. The server still sends the whole area (see Phase 8)
- [✅] Looping areas wrap seamlessly: near an edge the client draws the far side's chunks beyond it, players on the far side appear across the edge, and stepping over the edge doesn't jump the camera or the player
- [✅] Area links: automatic links move you, manual links offer a prompt (press E)
- [✅] The lobby screen shows the lobby's area next to chat and who's here, so players can walk around it
- [✅] Home page: universes in `let there be light` (paginated from the start), the universe overview, and Enter Universe -> that universe's lobby. Leaving the lobby goes back to Home; the long description is shown as plain text until Markdown rendering (Phase 8)

**Done when:** a player picks a universe on Home, walks around its lobby (blocked by mountains and water, slowed by forest) and walks through a door into a house.

## Phase 8: World editor

Built in four steps: the server API, the editor pages, the area editor's cells, then loading chunks as players approach them.

- [✅] Editor API as REST routes in `server/src/http/` backed by repositories (editing isn't real-time, so it doesn't need a room). Every request checks the user may edit that universe, and validates against the same limits as the UI. Who may edit is stored in `universe_editors` (creator, builder, beta tester; Phase 15 adds the Editors tab), and until logins exist (Phase 14) a request's player is the one its browser ID cookie is logged in as
- [✅] Create Universe modal (name, 1-sentence description, ruleset), up to 5 per user. Creates a lobby area and a default area as every race's starting area, and makes the user its creator. Home lists the universes the user has a role in, which opens them in the editor
- [✅] Edit Universe page: name, descriptions (markdown rendered sanitized with `marked` and DOMPurify, also on Home's overview), stage, ruleset, passage of time. Logo and banner wait for image storage (Phase 23). A Lobby tab opens the lobby's area until the rest of the tab arrives (Phase 12)
- [✅] Tilesets tab (filters for name, passable, custom and edited; pagination) and tile editor (name, indoors, color, vision cost, walk time)
- [✅] Areas tab with the single-area drill-down, and the area editor's settings. Its cells are the next item
- [✅] Area cells editor: grid centered on 0,0, expand buttons, edit-size dialog with its warning, draw tool (a tile or Void; size 1-100; circle or square), undo/redo with a drag counted as one step. It loads chunks as the view reaches them, pans with the right or middle mouse button and zooms with the wheel. Undo covers painting; resizing to a smaller area clears the undo history
- [✅] Area link layer: automatic or manual, "requires the whole group", select destination coordinates with an optional return link (placed in the target area, leading back to the link's cell)
- [✅] Edits apply immediately (universe versions come in Phase 15): the editor routes tell open rooms in this process about changed cells, areas, links and tiles (`areaChanges`), and the rooms update the areas they have loaded and their clients. Players a smaller area leaves out move to the nearest free cell inside it; players in a deleted area go to the lobby area (lobby) or starting area (group)
- [✅] Rooms load an area's chunks as players come near them and drop chunks nobody is near, instead of loading the whole area (`loadArea` reads only the area's settings, links and tiles), since the editor can make areas up to 50,000 cells per side. Loading stays outside the tick, on a 250 ms interval: a player waits at the edge of a chunk that hasn't arrived yet. Clients are likewise sent only the chunks near their player (`AreaPayload`, then `ChunksPayload` as they move)

**Done when:** a universe can be built from scratch in the browser (tiles, painted areas and links) and played in its lobby.

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
	- [✅] Time of day as pure functions in `/shared` with tests: fixed times, flowing time from a clock, real time from the Unix epoch, faerie time from the position in the area, daylight, and each area's passage of time resolved through `inherit`
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
- The engine ships default graphics as files in the client (`client/src/assets/tilesets/`), and a universe's editors can upload their own tilesets: PNG Dual-Grid sheets 128x128, each with a name and a draw order. Uploads go to S3-compatible object storage (SeaweedFS locally, any S3-compatible service in production), which pulls image storage forward from Phase 23. Uploading and deleting tilesets wait for the Tilesets tab's Save like every editor change. The server checks and re-encodes each upload, the uploader confirms they have the rights to use it, and the game server serves it to anyone at `/tile-graphics/<ID>.png`, cached for good since an upload never changes.

- [✅] Cells are 32 world units; a step takes 0.16 seconds
- [✅] A sample Dual-Grid grass sheet (`client/src/assets/tilesets/grass.png`)
- [✅] Blob graphics (the 47-Tile Blob Set) drawn in a walls layer over the ground, each cell's frame picked from its 8 neighbors, with a sample hedge sheet (`client/src/assets/tilesets/hedge.png`) used by the sample universe's Hedge, and a wood wall blob sheet (`woodWall.png`) used by its Wood Wall, for the cottage's and cellar's walls; its Stone Wall, the cottage's outside, uses a Dual-Grid sheet of a wall top (`stoneWall.png`)
- [✅] Uploading blob tilesets: the upload dialog chooses the layout (matched to the image's size), each upload stores its format, and the server checks the image against that format's size; a blob sheet has no draw order
- [✅] `AreaRenderer` draws a tile's Dual-Grid graphic, falling back to its color: frames picked from each corner's 4 cells, wrapping on areas that loop, with void, unseen and out-of-bounds cells counting as another tile
- [✅] Several tiles meeting: each graphic has a draw order in `TILE_GRAPHICS` (which graphic's edges overlap which; tiles drawn in their colors go below every graphic), and one frame is drawn for each combination of 4 corner tiles as it appears, cached in an atlas, so each piece stays one layer
- [✅] A piece is redrawn when a chunk next to it changes, since its edge cells depend on it; painting a cell redraws the 4 frames touching it
- [✅] Grid lines drawn as an overlay, not baked into each tile
- [✅] A tile's graphic chosen from sheets that ship with the engine or the universe's uploaded tilesets, shown in the tile editor with its day and night preview
- [✅] Uploading tilesets from the tile editor, staged until the Tilesets tab is saved: object storage, checking and re-encoding, the rights confirmation, and drawing areas with them once they load (tiles show their colors until then)
- [✅] Deleting an uploaded tileset from the tile editor, after asking, staged until the tab is saved; tiles drawn with it go back to their colors
- [✅] Removing a universe's uploads from storage when the universe is deleted (deleting an account deletes the universes it chose to, `server/src/http/accountDeletion.ts`)
- [✅] The editor's Save saves every tab's changes together, all or nothing, as `STRUCTURE-OVERVIEW.md` describes: one request (POST `/:universeId/changes`, `server/src/http/editorChanges.ts`) saves them in one transaction, in place of a route for each change, and a change can name what an earlier one in the same save makes
- [✅] The areas the Areas tab draws show the Tilesets tab's staged changes: changed colors and graphics, new tiles, staged uploads (from the page's own copy), and tiles staged for deletion drawn as their chosen replacements, including as an area's default tile. The draw tool and the default tile choices offer new tiles and stop offering tiles staged for deletion, and painting staged on the Areas tab with such a tile is saved as its replacement
- [✅] The area previews in the link and starting area dialogs draw the Tilesets tab's staged changes too
- [✅] Graphics for the ruleset's default tiles (grass, and PF1E's forest and mountains, so far)
- [✅] Check the new screens in the pseudo-language, update Pirate, and add screen reader text

**Done when:** an outdoor area painted with grass, dirt and forest shows smooth edges where they meet, the forest's treetops rise over the cells north of it, and painting in the area editor updates the edges as it paints.

## Phase 14: Authentication and accounts

Decided:
- Built in-house, not with a hosted provider or `@colyseus/auth`: the email code rules in `STRUCTURE-OVERVIEW.md` are more specific than a provider offers. A small OAuth library (such as `arctic`) handles Google and Discord, and passwords are hashed with Argon2id.
- Sessions live on the server (a `sessions` table) and reach the browser as an HttpOnly `__Host-` cookie, in place of today's browser ID cookie; there are no JWTs. `onAuth` looks the session up, a lifecycle boundary. Logging out, or changing the password, deletes sessions on the server, so a password change signs the account out everywhere. Production therefore needs the client and game server on the same site (e.g. `play.<domain>` and `api.<domain>`), which Phase 21's hosting choice has to keep.
- Session lifetimes (see Login in `STRUCTURE-OVERVIEW.md`): 1 hour idle and 24 hours in all without "Remember me"; with it, 30 days idle and 90 days in all. An open connection to a room counts as activity.
- An account can be logged in from several browsers at once, each with its own session; every window of the player, in any browser, acts as that player.
- Sessions arrive with the first real login (local accounts, then Google and Discord), so the name-only login never starts one.
- Every account has a unique username, for finding users and invites, and a display name that needn't be unique. The name-only login's data is dropped rather than carried over, and the seed script's `--creator` names a username.
- Linking: a provider login whose email matches a local account is never linked automatically. The player proves they own the local account (its password, or an email code) to link them; providers can also be linked from the profile.
- Email is sent over SMTP with `nodemailer`, so the service is configuration (chosen in Phase 21), and caught by Mailpit in `docker-compose.yml` locally. Emails are HTML, with a plain text part, in the recipient's language.
- Rate limits and the email code counters are Postgres rows updated atomically, so they hold across several server processes. The client's network comes from one function, which reads the connection's address, or behind a proxy the one forwarding header configured as trusted (`CLIENT_ADDRESS_HEADER`, `TRUSTED_PROXY_HOPS`); Phase 21 sets them for the host.
- Passwords are 15 to 256 characters (NIST SP 800-63B rev. 4's minimum for a password that is the only factor, which it is without 2FA; the same for every account, so turning 2FA off never leaves a shorter one), with no composition rules, and are checked against HaveIBeenPwned's k-anonymity API (only the first 5 characters of the password's SHA-1 hash leave the server).
- Password hashes are stored as self-describing strings (`$argon2id$v=19$m=...,p=...,t=...$<salt>$<hash>`), and one module (`server/src/auth/passwords.ts`) holds the current algorithm and settings, starting at OWASP's Argon2id minimum (19 MiB, 2 iterations, 1 thread). After a correct password, a hash made with older settings or an older algorithm is replaced with a current one, and the replacement is logged without ending the account's sessions. `verifyPassword()` picks the checker by the hash's prefix, so old hashes keep working when the algorithm changes. If an old algorithm is ever found weak, hashes of accounts that don't log in can be wrapped in the new one (`newAlgorithm(oldHash)`, marked by its prefix). Tests: a hash with old settings still verifies, and is replaced at login.
- 2FA is TOTP with recovery codes, for local accounts only; provider logins rely on the provider's 2FA. Passkeys can come later. No CAPTCHA for now; Phase 17 adds bot checks for suspicious logins.
- With 2FA on, resetting a forgotten password asks for an authenticator or recovery code as well as the email code, so someone who gets into the player's email still can't take the account. TOTP secrets are stored encrypted (AES-256-GCM) with a key from a server setting, apart from the database.
- Profiles store the player's usernames on social sites rather than addresses, so a link always goes to the site it names.
- Home, universe pages and the license and privacy pages are public; the lobby, game, editor, Create Character and profiles (editing your own, and viewing anyone's) need a login.
- Auth events (logins, failures, logouts, resets, email and password changes, 2FA changes, linking) go in an `auth_events` table: the account if known, the kind, the time, and the network as a keyed hash, never passwords, codes or session IDs. They are kept 90 days, and deleted with the account.
- Deleting an account asks first about each universe the player is the only creator of: hand it to another of its editors as creator, or delete it. Groups the player anchors disband, as when the anchor being leaves. Data export is one JSON file.

Built in two steps: logins (sessions, providers, local accounts, email codes, replacing the name-only login), then accounts (2FA, linking, profile, deletion, export and the security review).

1. Logins
	- [✅] `sessions` table and session cookie; `onAuth` checks the session and rejects joins without one, and a session's windows are turned away when it ends
	- [✅] Google and Discord login through OAuth, recommended on the login and register pages
	- [✅] Local accounts: email-based logins, Argon2id, the HaveIBeenPwned check, and the email code rules from `STRUCTURE-OVERVIEW.md` as pure functions with tests
	- [✅] Email through `nodemailer`, Mailpit in `docker-compose.yml`; register, forgot password and change email flows (the routes in `server/src/http/auth.ts`), with notification emails in the recipient's language
	- [✅] Usernames and display names; drop the name-only login's data and its server side
	- [✅] Rate-limit login, signup and reset routes; use generic error messages that don't reveal whether an account exists
	- [✅] Log auth events to `auth_events`, deleting them after 90 days
	- [✅] Tests for expired and logged-out sessions, sessions of deleted users, another user's resource IDs and replayed codes
	- [✅] The login page (`/login`: log in, create an account, forgot password), replacing the name-only login form on every page and what only it used; Home is public, with Log in and Log out in its toolbar
	- [✅] Links back to the site in the emails, which needs the client's address as a server setting
2. Accounts (the profile first, since 2FA, linking and deletion are done from it)
	- [✅] Profile edit and view, with character visibility and the player's language (used ahead of the browser's settings), changing the email address (the routes exist) and logging out from any page
	- [✅] Optional 2FA (TOTP and recovery codes), with trusted browsers that skip the code for 30 days
	- [✅] Account linking
	- [✅] Account deletion and data export
	- [✅] Privacy policy page (`privacy.html`, linked from the footer), drafted; check it against what was built, and set its date, before players use the site
	- [✅] Review against sections 1-3 and 5 of `SECURITY-PRACTICES.md`

**Done when:** only authenticated players can join, their identity maps to a DB row, and local accounts can register and reset passwords by email.

## Phase 15: Universe management

Already in place: the `creator`, `builder` and `beta_tester` roles in `universe_editors`, who may play in each stage (`canPlayUniverse()` in `shared/src/universes.ts`, checked by Create Character and the rooms), Home and the universe page showing only `let there be light`, and removing a universe's uploads from storage when deleting an account deletes it.

Decided (see `STRUCTURE-OVERVIEW.md`):
- Every change made in the editor, the Editors and Translations tabs included, is staged until Save, and saved through `POST /:universeId/changes` in one transaction like the other tabs.
- Universe text is the universe's name and descriptions and the names of its areas, tiles, items, races, classes, themes and difficulty levels. A ruleset default the universe hasn't renamed stays engine text. Character, group and player names and chat are never translated.
- A translation is found in the player's language, then that language without its region, then the source text. Each translation keeps a hash of the source text it was made from; when the source changes it is still shown, marked out of date on the Translations tab.
- Server admins are site-wide and separate from universe roles. Who is one is stored in the database; a script run by hand makes the first, and admins add and remove other admins on the admin page. Admins must have 2FA on.
- `prologue` universes aren't listed on Home for everyone: a player with a role in any sees them in a section of Home of their own.
- `end of time`: the universe page can be reached and says the universe is locked, only creators can edit it, the lobby can't be entered, and groups can be opened read-only, with group chat still working.
- The only engine text a universe can rename is its ruleset's coins, each coin's name and abbreviation ("bronze kits" and "bk" for copper pieces), which are then universe text, translated like the rest. Other engine terms (race, class, group and the like) stay the engine's.
- A universe has a live version and at most one draft, a copy of the live content in the same tables with IDs of its own, each row remembering the live row it came from. The editor edits whichever is chosen in its bar; only the live version is played. Only creators start, apply and discard the draft. Applying can't be undone: it writes the draft back under the live IDs (so characters, items and groups never change their references), treats what the draft deletes while it's in use as disabled, with the step 4 warnings, and removes the draft.

- Every editor window joins its universe's editor room, which says who has the editor open and where, carries the editors' chat, and tells each editor what the others save. Changes stay staged until Save: nothing is edited together live, keystroke by keystroke, since that would blur who is saving what.
- Chats that are kept (the editors' and each group's) keep their newest 200 messages. Lobby chat is in memory only.
- A save sends only the fields it changed, each with the value the editor loaded. Changes to different fields of the same thing both save; only one field changed by two editors is a conflict, which the second to save resolves. The live version and the draft are separate rows, so an edit to one never conflicts with the other.
- An area open in the area editor is claimed softly: others opening it are told who is editing it, but can still edit it.

Built in ten steps: roles, stages, server admins, disabling things in use, then translations (storage, delivery, the tab), versions, editing together, and finishing. Regions follow in Phase 16.

1. Editors tab and roles
	- [✅] A `translator` role, and the languages each translator may translate into (`universe_editors.languages`)
	- [✅] What each role may do as pure functions in `/shared`, beside `canEditWorld()`: managing editors (creators), the universe's settings (creators), the world (creators and builders), translating (creators, and translators in their languages), and playing (by stage, as now). The editor routes check them through `requireRole()`, and each `EditorChange` kind names the check it needs (`EDITOR_CHANGE_CHECKS`)
	- [✅] Editors tab: lists each editor's username, display name, role and languages; adds a player with a role, found by searching names and usernames (`@` for usernames only) with the reusable `PlayerSearch` control; changes a role; removes an editor. Staged until Save, as `EditorChange` kinds. A universe always keeps at least one creator, and the server refuses a save that leaves none
	- [✅] Leaving a universe: any editor can remove themself, except its last creator (Leave Universe on the Editors tab, staged like the rest)
	- [✅] The editor shows only the tabs a role may use (beta testers and translators see the Editors tab and read-only settings; the Translations tab comes in step 7), and refuses changes it may not make, server-side as well
	- [✅] Losing a role takes effect at once: an open editor's next save is refused, and a player who may no longer play the universe in its stage is turned out of its lobby and groups (published through `server/src/players/universeAccess.ts`, like a session ending), with a message saying why. The rooms also check that a joining player may play
	- [✅] Tests: each role's checks, the last creator, adding a username that doesn't exist, a translator saving a world change (saving another language waits for translations, step 5; `canTranslate()` is tested)
2. Stages
	- [✅] Home's section for universes in `prologue`, shown only to players with a role in one, and the universe page for those players
	- [✅] Changing the stage takes effect at once in open rooms: players who may no longer play are turned out with a message, as when losing a role
	- [✅] `end of time`: the universe page says the universe is locked; the editor refuses saves from anyone but creators; the lobby refuses players, and Enter Universe without a group says why; groups open read-only (moving, links and every other input refused on the server, the client saying it's locked) while group chat still works. Create Character, Create Group and invites are refused
	- [✅] Moving out of `in the beginning` warns that new areas will start disabled (the area editor's rule)
	- [✅] Tests for each stage's listing and play rules, and for players turned out when the stage changes
3. Server admins
	- [✅] Who is a server admin, stored in the database (a migration), and a script that makes a player one by username (`npm run admin:add -w server -- <username>`), run by hand like the seed script
	- [✅] Only server admins with 2FA on can see and use the admin pages (`/admin`, linking to the tools in `client/admin/`, the settings at `/admin/settings`), and only they see its link in the toolbar (Site admin in the account menu); an admin without 2FA is told to turn it on. Anyone can still read the character deletion days, social sites and privacy contact, which the footer and privacy policy show, through a public route of their own (`PUBLIC_SITE_SETTINGS_PATH`)
	- [✅] Admin pages listing the login sessions still going (`/admin/sessions`) and every player account (`/admin/players`), each searchable, filtered and paged
	- [✅] Admins add other admins by username and remove them on the admin page (`/admin/admins`); the last admin can't be removed. Turning 2FA off asks an admin to confirm they'll lose the admin page until it's back on
	- [✅] Disabling a universe: a list of universes on the admin page (`/admin/universes`, searchable and paged, since there may be thousands) with Disable and Enable and a reason. A disabled universe isn't listed or playable, its editors see why and can't save, and its open rooms turn their players out
	- [✅] Admins open any universe's editor from the Universes admin page (its name links there), with the site admin role (`ADMIN_ROLE`, never stored) whenever it allows more than their own: everything a creator can do, saving even while the universe is disabled
	- [✅] Admin actions (adding and removing admins, disabling and enabling universes) are logged in `admin_events`, like auth events
	- [✅] Every save in the world editor, the site admin role's included, is recorded in `universe_edits` (who, which role, each thing changed by name with the value given each setting changed, when), kept 90 days, and listed on the editor's Audit tab for creators and site admins
	- [✅] Tests: the admin routes refuse other players and admins without 2FA, the last admin can't be removed, the public setting stays readable, a disabled universe can't be joined or saved
4. Disabling things players are using
	- [✅] Counting what a change affects, for the editor's warnings: characters of a race or class, characters holding an item, characters (playing or saved) in an area, groups larger than a new group size. A route the editor asks before Save, through repositories (`POST /:universeId/changes/impact`, `server/src/http/editorImpact.ts`; the rooms list where their characters are through `server/src/world/areaOccupants.ts`), and one dialog on Save (`ImpactDialog`)
	- [✅] Races and classes: "only for new characters" or "prevent them from playing", stored with the race or class (`keepPlaying`). The lobby, groups and character choice refuse characters who can't play, saying why (`characterBar()`, `CharacterSummary.barredBy`), and those playing are turned out (published as `universeAccessChanges.publishBarred()`)
	- [✅] Areas: "move everyone to the parent area" or "move everyone back to their start area", for players in open rooms and the saved positions of groups no one is playing. The parent is the nearest enabled area holding it, arriving on a link back in; the start is the lobby's area, or the group's starting area
	- [✅] Items: "keep using it, no new copies" or "remove it from characters, re-added when re-enabled": removed items are hidden rather than deleted (`character_items.hidden`), so re-enabling brings them back
	- [✅] Group size: "keep those groups", "disband larger groups" or "remove members, most recently joined first" (`group_members.joined_at`); never the anchor being
	- [✅] Each warning's choice travels with its `EditorChange` and is applied in the save's transaction, then published to the rooms. Who moves, leaves or is hidden is worked out by pure functions in `server/src/logic/` (`disabling.ts`), with tests
5. Universe languages and translation storage
	- [✅] A source language (the creator's language when the universe is made) and the languages it's translated into, on the Translations tab, staged like everything else (saved as a `universe` change, `sourceLanguage` and `translationLanguages`)
	- [✅] Home and the universe page show the source language and the translations
	- [✅] `universe_translations`: universe, what the text belongs to (kind and ID), field, language, text, and the hash of the source text it was made from, through a repository (`server/src/db/universeTextRepo.ts`). Deleting what a translation belongs to (or restoring one of the ruleset's defaults) deletes its translations in the same transaction, and deleting a language deletes its translations, after asking
	- [✅] Notes for translators, one per piece of universe text, in a table beside it (`universe_translator_notes`)
	- [✅] Finding the translation (the fallback order) and whether one is out of date as pure functions in `/shared` (`shared/src/universeText.ts`), with tests. The hash is SHA-256, which Postgres can work out too, for step 7's "is out of date" filter
6. Universe text in the player's language
	- [✅] The server finds a request's language (the profile's, then what the client sends as Accept-Language; `server/src/http/requestLanguages.ts`), and Home, the universe page, Create Character, the character sheet, the character lists, profiles, Create Group's difficulty levels and invites show universe text in it (`UniverseTextTranslator`)
	- [✅] In the rooms, synced state carries IDs rather than universe text, since the Schema sends the same state to everyone. The client fetches the universe's text in its language once (`GET UNIVERSES_PATH/:key/text`, cached with an ETag that changes when the text does) and looks names up by ID; a change saved in the editor tells clients to fetch again (`ServerMessageType.UniverseText`). Area payloads keep the source names, as the editor's previews use them and the game falls back to them
	- [✅] The editor always shows the source text (its routes never translate); the Translations tab shows the translation being made with its table (step 7)
	- [✅] Tests: the fallback through the route, the ETag changing with the text and the translations
7. Translations tab
	- [✅] The table of universe text for a chosen language: where it comes from ("Area: Waterdeep, name"), the source text, the note and the translation, paged on the server with search, "is missing" and "is out of date" filters, and sortable like other tables (`server/src/http/editorTranslations.ts`, `client/src/ui/editor/TranslationTable.ts`)
	- [✅] Editing translations and notes, staged until Save (`saveTranslation` and `saveTranslatorNote`, saved after every other tab's changes); updating an out-of-date translation, or confirming it's still correct (which stores the current source hash). Notes are written by creators and builders
	- [✅] Long descriptions translated as markdown, with a preview sanitized like the source's
	- [✅] Marking text as needing no translation (such as a proper name), by creators, builders and translators, for every language; players see it as written, and its translations are kept
	- [✅] Exporting and importing translation files as Gettext PO, XLIFF 2.0, CSV or JSON (`shared/src/translationFiles.ts`), imports staged until Save
	- [✅] Translators see only their languages; creators see every language
	- [✅] Coin names and abbreviations of the universe's own, in the Ruleset tab's Coins table (`coinNames` and `coinAbbreviations`, staged until Save), shown in money fields and on the character sheet, and translated on the Translations tab as universe text (`coin`); a coin given back the engine's name or abbreviation loses its translations
8. Universe versions
	- [✅] Write the design into `STRUCTURE-OVERVIEW.md` (Universe versions), and close its open question: a live version and at most one draft, applied once and for good
	- [✅] Schema: a `draft` flag and the live row it was copied from (`origin`) on every content table (tiles and tile graphics, items, races, classes, themes, difficulty levels, areas, and the ruleset settings, starting items, translations and translator notes), in the unique keys that name the universe; tables hanging off a row (ruleset rows, starting items of a race or class, class race areas, area chunks, links) follow their row. `universe_drafts` holds the draft's own copy of the settings `universes` holds for the live version
	- [✅] Every repository reads and writes either the live version or the draft (`UniverseVersion`, `server/src/db/universeVersions.ts`): the rooms, Home, the universe page, Create Character and the other player-facing routes the live one, the editor's routes the one it sends
	- [✅] Starting a draft copies the live content (`server/src/db/universeDraftRepo.ts`, in the save's transaction), mapping every reference inside it, area cells included, to the copies; discarding deletes it and the files of tilesets only it used
	- [✅] The editor's choice of live or draft beside the role in its toolbar, asking first over unsaved changes, and `?version=draft` in its address; every request names the version (`EDITOR_VERSION_PARAM`), saves to the draft tell no room anything, a notice says which is open and warns while the live version is open with a draft, and the Audit tab marks draft saves and lists starting, applying and discarding
	- [✅] Start Draft, Apply Draft and Discard Draft in the toolbar, each asking first and saving at once: Start Draft's dialog explains drafts and saves any unsaved changes with it (`client/src/ui/editor/StartDraftDialog.ts`), while applying and discarding wait until nothing else is unsaved; starting for creators and builders (`canStartDraft()`), applying and discarding for creators (`canManageVersions()`), as `EditorChange` kinds saved after every other change (`client/src/ui/editor/DraftSection.ts`)
	- [✅] Applying asks the step 4 warnings, comparing the draft with the live version (`draftImpacts()` in `server/src/http/editorImpact.ts`), with what the draft deletes while in use kept disabled. It writes the draft back under the live IDs in the save's transaction (`server/src/http/editorDrafts.ts`); once committed, open rooms load the new world and clients fetch the text
	- [✅] Tests: starting a draft copies everything and leaves the live version alone, saving to the draft changes nothing players see, applying keeps live IDs and characters' references, an apply that is refused changes nothing, discarding removes the draft and its uploads (`server/test/db/universeDraftRepo.test.ts`, `server/test/editorDrafts.test.ts`)
9. Editing together
	- [✅] Write the design into `STRUCTURE-OVERVIEW.md` (Editing together, and group chat under Create Group)
	- [✅] An `EditorRoom` per universe (`filterBy` the universe ID), joined by each editor window once the editor has loaded. onAuth finds the player from the session cookie and refuses anyone without a role in the universe (server admins join with the site admin role). Its synced state lists who has the editor open: each player once, with their role and, for each of their windows, the version, tab and area it has open. Losing a role, the universe being disabled and the stage changing reach open editors through it at once, rather than on their next save (`server/src/world/editorUpdates.ts` and the stage changes; the editor loads the universe again, or says to once its changes are saved)
	- [✅] Kept chats in the database: one table for every chat that is kept (`chat_messages`, through a repository), holding the newest 200 messages of each (`MAX_KEPT_CHAT_MESSAGES`), with older ones deleted as new ones are written. A room keeps new messages in memory and writes them as a periodic checkpoint every few seconds and as it closes, never inside a tick. A chat is deleted with its universe or group; deleting an account empties the author of its messages, shown as "[deleted user]". The data download includes the player's kept messages, and the privacy policy says what is kept and for how long
	- [✅] The editors' chat, in a panel of the editor opened with the toolbar's Chat button (Alt+H, `client/src/ui/editor/EditorChat.ts`): out of character, as the player (display name and @username), rate-limited like the lobby's, with a list above it naming who has the editor open
	- [✅] Group chat on the group screen, kept the same way (`server/src/rooms/keptChat.ts`, shared with the editor room): as the character the window plays, working while the universe is locked, with a line naming the members who are here (`client/src/ui/ChatLog.ts`, shared by every chat)
	- [✅] Save notices: once a save commits, the change route publishes the audit's details (`editorUpdates`, kind `saved`) to the universe's editor room, which tells every other editor window (`EditorServerMessageType.Saved`; the saving window names itself with `windowId`): everything to windows on the same version, and only the editors, stage and draft to windows on the other (`server/src/logic/saveNotices.ts`), with no details when the save changed nothing else, so their Audit tab still lists it again. A toast says who saved what ("Bea saved: Changed race Dwarf, Painted 40 cells in Cave"), read out by screen readers (`client/src/ui/editor/saveNotices.ts`). Each thing's changed fields, by ID, for keeping views current, come with the next item
	- [✅] Keeping views current: the editor fetches what a save changed, and updates whatever it has no unsaved changes to (lists, an open dialog, the area editor's cells). Something it does have unsaved changes to gets a note inline ("Bea changed Name and Speed since you opened this"), and the toast stays until dismissed, naming the tab
		- [✅] Each detail a save notice carries names the ID of what it changed (`SavedEditDetail`), and each tab follows the save (`FollowsOtherSaves`, `client/src/ui/editor/otherSaves.ts`): the lists of races, classes, themes, difficulty levels, items, tiles and editors load again keeping their staged changes, marking each row both changed (`ChangedSinceNotes`); the settings forms (Universe, Lobby, Characters, Coins, Translations and Ruleset) load again when they have no unsaved changes, and otherwise say at their top who changed which settings (`FormFollower`); the Areas tab loads its list, and the area open when it has no unsaved changes, or says what changed above its settings; the translation table loads again keeping its changes. Starting, applying or discarding the draft loads the universe again, or says to reload. The toast names the tabs with unsaved changes the save touched and stays until clicked away
		- [✅] An open dialog (race, class, theme, difficulty level, item, tile, editor) showing something a save changed shows it afresh, keeping the focus, while neither it nor its tab has unsaved changes to it, and closes when the save deleted it; otherwise it says under its title what changed (`FollowedDialog` and `DialogFollower`). An item or tile on another page than the list shows gets the note. A link dialog with changes not yet applied keeps the area open from loading again under it; one without them closes as the area loads
	- [✅] Saving only what changed: changes to the universe's and the ruleset's settings, items, races, classes, themes, difficulty levels, tiles, areas, editors and translations carry only the fields changed, each with the value the editor loaded. A list (starting equipment, a class's races) is one field. The server compares each with what is saved, and when another editor changed the same field since, refuses with 409 and a `SaveRefusedPayload` naming the thing, the field, its saved value and who saved it. The editor then asks, for each: keep mine, or take theirs. Painting: each cell takes the latest save, and the area editor marks cells another editor painted while it was open
		- [✅] Settings: each change to settings (`MERGED_CHANGE_KINDS`) carries `loaded`, the settings as the editor loaded them (as the change before it left them, for a second change to the same thing in one save), beside the settings it sends. The server merges them a setting at a time, as the Audit tab groups them (`mergeSettings()` in `shared/src/fieldMerge.ts`, `server/src/http/editorSaveMerge.ts`): what the change changed is saved, the rest keeps what is saved, and a setting another editor changed since to something else is refused with 409 and `SaveRefusedPayload.conflicts`, naming the thing, the setting, both values as the Audit tab shows them and who saved it last (`findLastSavers()`, for every conflict at once, from the IDs `universe_edits` records with each detail). The save bar asks Keep Mine or Take Theirs for each (`ConflictDialog`), settles the changes (`settleConflict()`) and sends the save again. After a save, the forms with no unsaved changes load again, showing what the merge kept
		- [✅] Translations: `saveTranslation` and `saveTranslatorNote` carry `loaded`, the translation or note as the Translations tab listed it, and conflict as a whole when another editor saved a different one since (`SaveMerge.mergeText()`), naming the text, both versions and who saved it (`universe_translations.saved_by`, `universe_translator_notes.note_saved_by`). One that saves what is saved is skipped, so taking theirs (`settleTextConflict()`) saves nothing
		- [✅] Painting: the save notice's cells details name the chunks each area's painting touched (`SavedEditDetail.chunks`, left out of `universe_edits`). The area editor loads those it has loaded again (`ChunkLoader.reload()`) and takes in each changed cell, keeping cells painted here and not yet saved, with the undo history following the saved values (`EditHistory.rebase()`), and outlines them with the cell text naming who painted them (`AreaEditor.followPainting()`), unsaved changes or not. Cells painted here since the area opened, saved or not, are outlined in orange, and the save notice waits for the painting to say how many, as a warning kept until clicked away (`AreasTab.followPainting()`); clicking the toast away takes that save's marks off (`FollowedPainting.unmark()`). A save changing the open area's settings with no unsaved changes here shows them again keeping the cells, rather than loading the area afresh
	- [✅] Soft claims on areas: opening an area in the area editor claims it for that window, in the room's state, until the window closes it or disconnects. Another editor opening it sees "Bea is editing this area" above the area's cells, without being locked out, and the Areas tab tags the area with who is editing it. The claim is each window's `EditorWindow.areaId`, kept while the window shows another tab; the editor reads other players' claims on its version from the room's state (`areaClaims()`, `client/src/ui/editor/areaClaims.ts`), says above the area's cells who else is editing the area open, read out when that changes, and tags the areas in the lists (`AreasTab.setClaims()`)
	- [✅] Tests: the room refuses players without a role and turns out one who loses theirs; a chat keeps its newest 200 messages, through the room closing; saves to different fields of one race both land; a save to a field changed since is refused naming who changed it; edits to a race in the draft and in the live version don't conflict; a claim ends when its window leaves (`server/test/EditorRoom.test.ts`, `server/test/db/chatRepo.test.ts`, `server/test/editorMerge.test.ts`, `server/test/shared/fieldMerge.test.ts`)
10. Deleting a universe
	- [✅] Delete Universe under the Universe tab's settings, for creators and the site admin role, in two dialogs like deleting an account: what it deletes (`GET /:universeId/deletion`), then the password and 2FA code, or the username and an emailed code (purpose `deleteUniverse`). Done at once, the exception to staging, then goes to Home (`client/src/ui/editor/UniverseDeleteSection.ts`)
	- [✅] The deletion shared with deleting an account (`server/src/http/universeDeletion.ts`): the role checked again once the universe is locked, its uploads deleted from storage, its rooms told, and its other editors emailed. A creator is refused while the admins keep its creators from deleting it; a server admin deleting it as an admin goes through `POST /admin/universes/:universeId/deletion`, recorded as an admin event that keeps the universe's name
	- [✅] Tests (`server/test/universeDeletion.test.ts`)
11. Exporting a universe
	- [✅] Export Universe left of Delete Universe, for every role but beta tester, opening a dialog that says what the export holds and whose Export Universe downloads a zip file of what the role can change in the version open (`client/src/ui/editor/UniverseExportSection.ts`)
	- [✅] The format (`shared/src/universeExport.ts`): `universe.json` with a section for each kind of thing the role can change, the races and classes in `races.json` and `classes.json`, the uploaded tilesets and tiles in `tilesets.json`, the items in `items.json`, the notes for translators, needs-no-translation marks and translations in `translations.json`, each area with its settings, links and cells in a file of its own in `areas/` (which `areas.json` lists), the live rows a draft's things were copied from in `liveIds.json`, and uploaded tilesets' images in `tilesets/`, named by the version's IDs, with the ruleset's defaults listed by key
	- [✅] `GET /:universeId/export` (`server/src/http/universeExport.ts`), read in one read-only snapshot, one export at a time per player; zip archives written and read with Node's zlib (`server/src/archives/zip.ts`)
	- [✅] Tests (`server/test/universeExport.test.ts`, `server/test/archives/zip.test.ts`)
12. Importing a universe
	- [✅] Import Universe beside Export Universe, for every role but beta tester, into the draft only: while the live version is open, a dialog that opens the draft or starts one (creators), then the import dialog, which previews the file (`POST /:universeId/import/preview`), asks for the rights to tilesets it uploads, and imports it at once, as Apply Draft saves, waiting until nothing else is unsaved (`client/src/ui/editor/UniverseImportSection.ts`)
	- [✅] Reading and checking the file (`server/src/http/universeImportFile.ts`) and planning it as editor changes (`server/src/http/universeImportPlan.ts`): each part the role can change replaces the draft's, defaults matched by key, and the same universe's things matched by their live rows (`liveIds` in a draft's export) so they keep their place once applied
	- [✅] Saved as one save through `saveChanges()`, which takes changes made once the changes before them are saved (`PendingChange`), for settings naming things the same save makes (`server/src/http/universeImport.ts`)
	- [✅] Tests (`server/test/universeImport.test.ts`)
13. Finishing
	- [✅] Check the new screens in the pseudo-language, update Pirate, and add keyboard shortcuts and screen reader text for the new tabs and dialogs
	- [✅] Update `STRUCTURE-OVERVIEW.md` where the decisions above changed it (stages, admins, versions)
	- [✅] Review the new routes against `SECURITY-PRACTICES.md`, and cover them in `server/test/http.test.ts`

**Done when:** a team of editors and beta testers takes a universe from `in the beginning` to `let there be light`, and a creator can disable a race without breaking its existing characters. A translator adds French to the universe, and a French player sees it in French.

## Phase 16: Regions and area editing

Decided (see Regions in `STRUCTURE-OVERVIEW.md`):
- Regions group areas without cells of their own. A region's parents are any number of regions (none for a top-level region), so a creator can make "Bea's regions", put other regions in it and assign Bea to it; nothing is ever inside itself. An area's parents are one or more regions and areas, all alike, at most one of them an area. Every area is in at least one region, directly or through an area it is inside. Regions and areas nest at most 10 levels deep along their longest path. Region names are unique within a version, and only seen in the editor, so they aren't universe text.
- Regions and areas have the same settings, each of which can be `inherit` (shown as "Not set" for a top-level region): enabled, indoors or outdoors, light level, default tile and passage of time. A region can set none of them, such as one that only groups a builder's areas. The universe's passage of time goes; the Lobby tab keeps its own.
- An area's `inherit` settings are found among its parents a level at a time, each region or area counted once; enabled is a gate, disabled when anything above is along any path, with `on` working as `inherit`. Every save that changes areas, regions, an area's parents or a tile's kinds works the settings out for every area of the version and stores them on the areas, and refuses the save when an area has two different values at one level (two `faerie` mornings included), or none at all. Outdoor areas ignore light level, and the lobby's area its passage of time, which the Lobby tab sets. The editor runs the same check as changes are made. Nothing is ever saved wrong, so there is no Errors tab (see Later).
- Creators assign builders to regions, for the universe rather than a version. A builder edits only what is below their assignments, nothing without one, and tiles, items and mobs only with the permissions given on the Editors tab. They rename the regions they are assigned to and change their settings, but only creators change their parents or delete them, and a move, a parent or a link needs both ends within the builder's assignments, as does deleting a link or an area that areas outside them link into. Only builders are assigned.

1. Regions
	- [✅] Schema: `regions` (universe, draft and origin, name, unique within the version not counting case, and the settings, null for `inherit`) and `region_parents` for the regions each is inside, with when each was added; an area's parents as its `parent_area_id` (or none) and `area_regions` for the regions it is in, with when each was added, at least one of them; the area's own settings nullable for `inherit`, beside the settings worked out for it (the worked-out light level null exactly when the area is outdoors, kept so by a check constraint); `region_assignments` (region by its live ID, builder); the builder permissions `can_edit_tiles`, `can_edit_items` and `can_edit_mobs` on `universe_editors`. The migration deletes every universe's areas (no universe holds real data yet), with everything pointing at them (starting areas, the lobby's area, saved positions, groups' saved state), and drops the universe's passage of time; the seed rebuilds the sample universe
	- [✅] Working out an area's settings as a pure function in `/shared` (`resolveAreaSettings()` or similar): each setting's value and where it came from, or the conflict (the regions and their values) or missing value, with a default tile not for the area's kind passed over and `faerie` refused for a looping area. Tests for each rule: one level, a conflict between parents whatever their order, the same value twice, blank regions passed over, a region reached twice counted once (through regions with several parents too), going up past a parent area, enabled as a gate along every path, missing values at the top, light level ignored outdoors, two `faerie` mornings conflicting, the lobby's area without a passage of time
	- [✅] Saving: every save that changes areas, regions, an area's parents or a tile's kinds works out the settings of every area of the version in the save's transaction, stores them, and refuses with a payload naming each area, setting and region (shown on the Areas tab, linking to the area). The rooms, the game and the previews read the stored settings. Applying the draft and importing into it are checked the same way. Deleting an area gives the areas inside it its parents, checking first and naming the areas that would be left with a conflict or a missing value
	- [✅] The Areas tab as a tree of regions and areas (a region or area with several parents under each, collapsed after the first) or a table, with a Tree / Table switch and a search narrowing both, Add Region beside Add Area, and the region editor (`STRUCTURE-OVERVIEW.md`, Editor: Region): name, parents, settings, assignments and what is in it. The area and region editors' parents, with Add Parent searching regions (and areas, for an area), never offering one that would put something inside itself or nest it more than 10 levels deep. Each setting shows what it inherits and from where, and the problems a change makes as it is made; a region's own conflicting inheritance is a warning, since only areas are checked. Staged until Save, as `EditorChange` kinds, and listed on the Audit tab
	- [✅] Deleting a region: the dialog moving or deleting the regions and areas whose only parent it is (deleting asking twice, like deleting a character, then the warnings for areas with characters in them), and adding another parent region to the regions and areas with other parents or leaving them with those, each region select offering the deleted region's parents first, checking first that what is left has a value for every setting
	- [✅] Assignments: creators assign builders in the region editor; an assignment covers everything below the region. Builders rename and change the settings of the regions they are assigned to, but don't change their parents or delete them, and add, change, move and delete what is below them, with both ends of a move, a parent or a link within their assignments (deleting a link out of them, or an area linked into from outside them, is left to creators), and a translator note on an area's name only for an area within them; with no assignment they edit no area or region. Existing builders start with no assignments or permissions. The permissions on the Editors tab (can edit tiles, items and mobs, the last stored for later) decide the rest. The server checks every change (`EDITOR_CHANGE_CHECKS`), and the editor opens what a builder can't edit read-only
	- [✅] Disabling: an area's parent area for "move everyone to the parent area" is the nearest enabled area above it, past regions, and disabling a region asks for every area below it with characters in it, as does any change that disables an area through what is above it (a new parent, a move, deleting a region). In the draft none of it asks or moves anyone; applying the draft asks about the live areas it disables or deletes, judged by their worked-out enabled
	- [✅] Tiles: deleting a tile or unchecking a kind ("used in") while it is the worked-out default tile of areas opens one dialog for both (`STRUCTURE-OVERVIEW.md`, Replacing a default tile), listing the areas under the places that give them the tile: every place setting it when deleting; when unchecking, a place giving it only to areas of that kind, or else each of those areas, the place keeping it for the other kind. Each place chooses Inherit (offered only when clearing it leaves every area it served a default tile from its parents, with no conflict, showing what each gets) or a tile, with Replace All With for every place at once, and a count of the places chosen out of all of them ("1 / 20 chosen"). A tile not for the kind of every area it would become the default tile of shows a warning naming them and can't be used; the dialog checks the result for conflicts and missing values, and names places outside a builder's assignments. The server refuses a save leaving an area's default tile not for its kind
	- [✅] Drafts copy regions like areas; exporting and importing include regions with the world, and assignments and permissions with the editors
	- [✅] Seed world, rebuilt from scratch:
		- "Lobby" region (outdoors), holding the "Lobby" area (a city), the lobby's area, with grass as its default tile, whose passage of time is the Lobby tab's (real time, the default)
		- "Planet" region (flows normally, outdoors, lit, grass), holding the "Kingdom" area, outdoors and the starting area, and the "Capitol City" region
		- "Capitol City" without fog of war, so its areas show everything near their players; "Market District", in Capitol City; "Shop", inside Market District, indoors with Wood Floor; "Cellar", inside Shop, dark (indoors and Wood Floor from Shop)
		- one Desert cell in Kingdom with an automatic link into Market District, and a 2-wide exit from Market District back out to Kingdom beside it; Shop linked from Market District, and Cellar from Shop, both ways
	- [✅] Tests: refusing a conflict and a missing value, a blank region causing neither, the stored settings following a change to a region above, a builder refused outside their assignments (a move, a parent or a link with one end outside), without a permission, and moving or deleting a region they are assigned to, a tile's kind change refused while an area needs it as its default tile, replacing it when unchecking a kind (on the region setting it, and on the areas below a region that also serves the other kind), clearing it to inherit when deleting or unchecking, deleting a tile replacing it as regions' and areas' default tile and refusing a replacement of the wrong kind, deleting a region each way, deleting or disabling a region in the draft moving nobody until the draft is applied, deleting an area refused when it leaves an area inside it with a conflict, a duplicate region name refused, a region put inside itself (directly or further down) or nested more than 10 levels on its longest path refused, a builder assigned to a region holding another region editing what is in that one, a builder refused deleting a link out of their assignments or an area linked into from outside them
	- [✅] Once the rest is built: a benchmark in `scratchpad/` of working out every area's settings on a save, with thousands of areas (`scratchpad/regionsBenchmark.ts`: about 6 µs an area, linear)
2. Area editor

	Decided (see Lobby, Settings, Editor: Area, Editor: Area Cells and Neighboring areas in `STRUCTURE-OVERVIEW.md`):
	- Fog of war is a sixth setting regions and areas share: `inherit`, on or off, worked out like the others, so nothing above an area setting it is a missing value. Off, the area's players see everything within the chunks loaded around them (all the screen shows and more, but never the whole of a large area) and everyone there, at any time of day, whatever the light or the tiles' vision costs; no fog is drawn, and a group's room records none of it as explored. It replaces the Lobby tab's "no vision cost in the lobby". A new universe's "World" region sets it on
	- Edit Size shows a side whose field differs from the area's size in a changed color, with the old value under it ("was 10"), which screen readers read with the field
	- The fill tool paints the clicked cell and every cell joined to it north, east, south or west with the same tile, within the area: not across its looping edges or into its neighbors. A fill is one undo step, and one of more than 1,000 cells asks first in a dialog
	- Middle click on a cell, or P on the keyboard's cursor, picks its tile for painting without changing the tool. A tile the Tile list doesn't offer (disabled, or not for the area's kind) isn't picked, and the status line says why
	- Any area at least 32 x 32 cells (a chunk, so few areas are ever near a player) can have a neighbor to the north, east, south and west, always both ways, each area storing all four of its sides. Neighbors form a consistent grid (north then west reaches the same area as west then north, or the save is refused), and a ring is allowed, as is joining two grids. Touching sides are always the same length, so every area in a row shares its height and every area in a column its width: Edit Size resizes the areas along the row or column with it, staged and warned about together, as one undo step in the editor it was made in that undoes every area's size. Edit Size keeps an area with neighbors at least 32 x 32
	- An area with neighbors can still loop: walking west off the west end of a chain whose west end loops east-west reaches the east end of the chain. Only the ends' loop checkboxes matter, and none do in a ring. A chain loops only when both its ends are checked: with one, it doesn't, and both ends' editors warn beside the checkbox, naming the other end
	- Walking over a seam enters the neighbor like walking within an area: nothing to press, no whole-group rule. Near a seam the neighbor's cells load, are drawn and are seen as if part of the area, with the players in it; each cell is drawn, lit, timed and fogged by its own area's settings, and cells seen over a seam are the group's exploration of that area. A disabled neighbor is an edge with nothing drawn past it, and a diagonal step into a missing corner area is blocked like an edge
	- The Lobby tab chooses a lobby region instead of a lobby area, and a starting square in an area below it. The lobby areas are the areas below the lobby region at any depth, whatever other regions they are in too, and the lobby region can be inside other regions. Each is tagged "lobby" on the Areas tab (the region too), takes the Lobby tab's passage of time, and is walked in the lobby. The lobby areas are never connected to the game world, whatever the role: the server refuses every save (applying the draft and importing included) leaving a link or neighbor between a lobby area and an area outside the lobby region, either way, or a starting area (the universe's, a race's or a class's) below it, and the rooms hold to it too: a group's room treats a lobby area as an edge, and a lobby never moves anyone out of them. A save that puts an area holding group characters below the lobby region warns about them in Save's dialog and moves them back to their start area; lobby players in an area that leaves it go back to the lobby's starting square. A new universe starts with a "Lobby" region (its lobby region, fog off) holding its Lobby area, beside "World" holding its Starting Area
	- No data is migrated: there is no real data yet, so the migrations change only the schema, and the local database is deleted and reseeded
	- The area editor gets a Neighbors section: a row per side with the neighbor's name linking to its editor, Choose (only areas that fit every side of that place in the grid), Add Neighbor, Remove and See Overall Map. Add Neighbor asks for a name, then stages an area with the same parents and own settings, painted with the default tile only, joined to every area next to its place in the grid, and as tall as its row and as wide as its column, taking this area's size where no other area sets it; the editor stays on the current area. The cells show 16 cells of each neighbor and corner area, and of the far end of a looping chain past its end, dimmed and read-only, with this window's unsaved changes to them; clicking one opens its editor, and the keyboard's cursor moves onto them, where P picks a tile and Space or Enter opens the area's editor. A button on each edge with a neighbor opens its editor. See Overall Map draws the whole grid zoomed out: each area's preview at scale with its name, this one highlighted, with this window's unsaved changes, and a ring's areas once each, laid out from this area with the seam back marked; clicking an area, or Enter on it, opens its editor, the arrow keys move between areas, and screen readers hear each name and its place in the grid. Deleting an area leaves its neighbors with an edge. Builders set and remove neighbors, and resize across them, only with every area involved within their assignments

	- [✅] Fog of war: the setting on regions and areas (own value nullable for `inherit`, and the worked-out value on the area) in the schema, `resolveAreaSettings()`, the area and region editors, the tile replacement and region deletion checks, the Audit tab, drafts, export and import. The rooms treat everything within the chunks loaded around a player in an area without it as in sight, players included, and record nothing of it as explored; the client draws no fog there. `lobby_no_vision_cost` goes, and the Lobby tab loses its checkbox. The seed's "Lobby" region sets it off
	- [✅] Edit Size: changed fields in a changed color with the old value under it
	- [✅] Fill tool (Fill beside Draw and Links, Alt+I), with the dialog above 1,000 cells
	- [✅] Picking a tile with middle click and P, listed in the keyboard help
	- [✅] Lobby region: `lobbyRegionId` on the universe (and its draft), with `lobbyAreaId`, `lobbyColumn` and `lobbyRow` as the starting square below it; the Lobby tab's region select (leaving out regions with a starting area below them, or with links or neighbors leading out) and starting square; the "lobby" tags, and the lobby region's name and tree line in yellow, not the other regions' orange; the Lobby tab's passage of time for every lobby area (`resolveAreaSettings()`, and the area editor saying so); the notices and Back to Lobby in the area and region editors; the link dialog's Goes to, Add Parent and the starting area choices leaving out what would cross the lobby region's edge; deleting the lobby region; saving refusing a link across the edge, a starting area below it, or a change of parents or of the lobby region leaving either; Save's warning moving group characters out of an area put below it, and lobby players out of one leaving it; the rooms (an edge in a group's room, walked in the lobby); a new universe's Lobby and World regions; Audit, drafts, export and import. The seed's "Lobby" region is its lobby region. Tests: a link across the edge refused either way, a starting area below the lobby region refused, moving an area with a link out of the lobby under another parent refused, choosing a lobby region with a starting area below it refused, a group's characters moved out of an area put below it, lobby players moved out of an area leaving it, and a lobby area as an edge in a group's room
	- [✅] Neighbors
		- [✅] Schema: an area's neighbor on each of its four sides (both ways, kept so by the save), copied with drafts
		- [✅] Pure functions in `/shared` for the grid: checking it is consistent, the chain's ends along a row or column (or a ring) and whether it loops, the areas a resize carries along, the areas that fit a place, the size Add Neighbor gives a place, where a step over a seam lands (looping across a chain included), and the overall map's layout
		- [✅] Saving: refuse an inconsistent grid, mismatched touching sides, an area with neighbors under 32 x 32, a neighbor across the lobby region's edge, and a builder's change with an area outside their assignments; deleting an area removes its neighbors' side; Audit, export and import
		- [✅] The area editor: the Neighbors section with Choose, Add Neighbor (its name dialog), Remove and See Overall Map, Edit Size carrying the row or column along as one undo step, the dimmed 16-cell previews (the far end of a looping chain included) with the keyboard's cursor on them, and the edge buttons, the loop checkboxes disabled (saying why) where they don't matter, and the warning on a chain with one end looping
		- [✅] The rooms: loading neighbors' chunks near a seam, movement and occupancy across seams and corners, vision and who sees whom across seams, exploration recorded per area, a disabled neighbor as an edge, and the lobby spanning the lobby areas' neighbors
		- [✅] The client: drawing several areas side by side, each by its own settings, with fog across seams and the player's area changing as they cross, read out to screen readers
		- [✅] Seed: a 2 x 2 grid: Kingdom, made 32 rows tall, and three ordinary outdoor areas of its size in Planet, both rows looping east-west as Kingdom does now
		- [✅] Tests: an inconsistent grid and mismatched sides refused, a resize carrying its row along (and undoing it), a ring, walking west off a looping chain's west end, a chain with one end looping not looping, a missing corner blocking a diagonal step, a disabled neighbor as an edge, vision and players seen across a seam, an area under 32 x 32 refused a neighbor, a neighbor across the lobby region's edge refused, a builder refused a neighbor outside their assignments, deleting an area leaving an edge
3. Site fonts and text sizes
	Decided, and already done in the static placeholder site (`C:\dev\multiverse-kiln-html`: `css/fonts.css`, `css/shared.css`), which can be copied from:
	- Nunito for body text and every control; Alegreya (calligraphic serif) for headings (`h1` to `h6`) and the site's name. If Alegreya looks too jagged at small heading sizes, Alegreya Sans is the fallback, then Texturina. Both are under the SIL Open Font License
	- Both are hosted with the site, never loaded from Google's servers (which would send every visitor's address to Google, a service the privacy policy doesn't list)
	- Text sizes are in `rem`, so they follow the base size a player sets in their browser; no `px` or `pt` font sizes. Body text is `1rem`, and each heading size ~1.3 times the one below
	- [✅] The font files: Google Fonts' variable woff2 files for weights 400 to 700, upright and italic, split by character set (Nunito: Latin, Latin Extended, Cyrillic, Cyrillic Extended, Vietnamese; Alegreya: the same and Greek), with one `@font-face` per file and its `unicode-range`, so a browser downloads only the sets a page's text uses. Kept in the client's public folder (e.g. `client/public/fonts/<font>/`), each with its `OFL.txt`
	- [✅] In `client/src/_shared.scss`: the fonts as `--font-body: 'Nunito', sans-serif` and `--font-heading: 'Alegreya', serif`, and the size scale as variables: `--font-size-small` `0.875rem` (14px at the default: hints, field errors, the footer and every other 12px text), `--font-size-h3` `1.3rem`, `--font-size-h2` `1.7rem`, `--font-size-h1` `2.2rem`
	- [✅] Headings: `line-height: 1.25`, margins in `em` so the space grows with the heading. A page's `h1` (its title in the toolbar) and the site's name are `--font-size-h2`; rendered markdown's `h1` to `h3` follow the scale, `h4` `1.125rem`, `h5` `1rem`, `h6` small. Big page headings, like Home's, can shrink on phones with `clamp()` between the `h2` and `h1` sizes
	- [✅] Replace every `px` and `pt` font size in the client's styles with the scale or a `rem` value
	- [✅] Nunito's regular weight is light on the dark background: check small text, and use weight 500 where it looks faint (every small text, through the `small-text` mixin)
	- [✅] 2FA code fields and other monospace text keep their current font (Consolas, Menlo, monospace)
	- [✅] Phaser draws canvas text with the font it has when the text is made, and doesn't redraw it when the font arrives: wait for the fonts (`document.fonts.load()`) before the area scenes create text, and change `AreaScene`'s `fontFamily: 'sans-serif'` to the body font
	- [✅] Credit Nunito (copyright 2014 The Nunito Project Authors) and Alegreya (copyright 2011 The Alegreya Project Authors) in a Fonts section of `client/license.html`, linking to each font's `OFL.txt`
	- [✅] Check the pages in the pseudo-language (`?locale=en-XA`), whose accented letters use the Latin Extended files, and with the browser's base text size raised (the pseudo-language's accents are all in the Latin file; Latin Extended text loads its file when shown)

**Done when:** a creator groups areas into a region and gives it to a builder, who fills a field with grass in one click and picks a tile off the area with the middle button. A player walks from Kingdom into the area beside it without a link, seeing it before crossing. Every page shows Nunito and Alegreya from the site's own server, and its text grows with the browser's base text size.

## Phase 17: Bot checks

The login and email code limits (Phase 14) stop guessing, but their only answer is "no": anyone who knows an address can use up its login tries, or make 15 wrong code guesses and block its codes for a day, and a botnet spread over many networks never reaches a network's limits. A bot check asks a browser that looks suspicious to show it isn't a bot, rather than refusing it, and lets a browser that passes keep trying past others' guesses. See Bot checks in `STRUCTURE-OVERVIEW.md`.

Decided:
- Cloudflare Turnstile, not reCAPTCHA: it has no image puzzles, so it works with a keyboard and a screen reader (Cloudflare states WCAG 2.1 AA), it is free without a monthly limit, and it doesn't send players to Google. It is a widget and one server-side check, so it doesn't need the site behind Cloudflare's proxy.
- Not Cloudflare's proxy (Bot Fight Mode, its firewall rules) for this: it can't see what makes a login suspicious (failed tries for an address, a browser that hasn't logged in to the account), its free bot blocking is blunt and can block WebSocket and API clients, and adjustable bot scores are a paid plan. Whether to put the site behind it for DDoS protection is a separate decision, with the hosting (Phase 21); it would change `CLIENT_ADDRESS_HEADER`.
- What a check promises: a request past the soft limit goes through only once a check has been passed, so every guess costs something. It doesn't promise to stop every bot: services that solve checks for money exist, so the limits stay the real defense, and a check only slows guessing and makes it cost more.
- Only suspicious requests are checked: past a soft limit, below the hard limit that refuses them today. Most players never see one, and their browser never contacts Cloudflare: the page loads Turnstile's script only when the server asks for a check.
- Which requests: logging in with a password, the wrong passwords typed while logged in that count against the same limits (a logged-in player is asked too, once someone else's guesses have passed the address's soft limit), and sending an email code (registering, resetting a password, changing an email address, linking a login). Google and Discord logins aren't checked: the provider checks them. A dormant account's code isn't checked on its own: only someone who has just given the right password gets one, in a login that was checked if it needed to be, and "send another code" sends the password again, so it is a login try.
- A browser that has logged in to the account (the known browser cookie) is never asked for a check, past either the address's or the network's soft limit, so players on a campus or mobile network that others share aren't asked. Its tries still count against the network's hard limit.
- A request refused because it needs a check counts against the network's limit, which bounds how often anyone can send one, but not against the address's. A soft limit counts only requests that went through (a password checked, a code sent), so a bot that can't pass checks stops at the address's soft limit and never uses up the real player's tries.
- A check never loosens today's limits for a browser that hasn't passed one. Each limit a passed check extends has a count of its own for the requests made past it, each with a passed check, and a hard limit of its own; these are kept per address and never raise a network's limits:
	- logins: 10 more tries an hour past the address's 10
	- sending codes: 5 more an hour past the address's 5, still at most one every 60 seconds
	- once 15 wrong guesses in a day block an address's codes: up to 3 more codes that day. A code ends after 5 wrong guesses, so this allows at most 15 more, 30 in all
- When a check is needed must not depend on whether an account exists for the address, as the rest of the login pages don't: the counts it reads are kept for every address.
- If checks aren't configured, or Cloudflare is down, nothing is checked: below the hard limits requests go through as they do today, and past them they are refused as today. An outage only takes away the extra tries. The server can't tell whether a browser can reach Cloudflare, and a browser's own report that Turnstile wouldn't load can't be trusted, since a bot would always send it, so the server only judges whether it can reach Cloudflare itself: from its own siteverify calls timing out or failing with server errors, and, since during an outage no browser gets a token to send, by sending siteverify a token that can't be valid before asking for a check when it hasn't reached Cloudflare in the last few minutes (a quick refusal means it is up). Cloudflare is then treated as down for a few minutes before trying again. The widget and siteverify are both on `challenges.cloudflare.com`, so an outage usually shows in both.
- A browser that can't load Turnstile while Cloudflare is up (an ad blocker, a firewall) stays at the soft limit: the page says Turnstile couldn't load and suggests another browser or network. Browsers that have logged in to the account aren't affected.
- The server verifies any token a request sends with Turnstile's siteverify API before opening the transaction that counts the attempt (a network call never holds a database transaction open), then decides in the transaction, under the same locks as the counts, whether a check was needed. A token that fails counts as no token: below the soft limit the request still goes through, and past it the server asks for a check again. Tokens work once and for 5 minutes, so the client resets the widget after every answer and each try gets a token of its own.
- Each kind of request has its own Turnstile action (`login`, `password` for the dialogs asking a logged-in player's password, `email-code`); the "check needed" answer names it, and the server checks the response's action and hostname (the host of `SITE_URL`).
- The site key reaches the browser in the server's "check needed" answer, so the client needs no setting of its own; the server has `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Both unset turns checks off, as an unconfigured Google or Discord login is left out; the server refuses to start with only one set. Locally and in `.env.example`, Cloudflare's published test keys (one pair always passes, one always fails, one always asks the player to interact).
- Cloudflare's test secret keys accept any test token, so the server refuses to start with one unless dev tools are on (`server/src/devTools.ts`) or `NODE_ENV=test`, so one copied to production can't let every check pass. With a test secret key the action and hostname checks are skipped, since a test token wasn't made on this site.
- The widget is shown in the player's language when Turnstile supports it, and otherwise picks its own (`auto`); the pseudo-language and Pirate fall back.
- The admin setting that checks every login and code request doesn't cover browsers that have logged in to the account or logged-in players' password dialogs, which are trusted; those are still checked past the soft limits. While checks aren't configured, the admin page shows the setting turned off and can't be changed, with a note saying why.
- A check asked for, passed or failed is an auth event, with the account only when the address has one, as failed logins are, so whether an account exists still doesn't show.

Steps:
- [✅] Settle the soft and hard limits and update Bot checks in `STRUCTURE-OVERVIEW.md` to match: the starting point that was in Open decisions (a check from an address's 5th login try in an hour or a network's 15th; codes from a network's 5th request or an address's 3rd; 10 more login tries, 5 more codes an hour and 3 more codes a day while blocked, each with a check)
- [✅] When a check is needed, as pure functions in `server/src/logic/` beside the email code decisions, given the attempt counts, whether the browser has logged in to the account, whether a check passed, and whether checks are on (configured, Cloudflare reachable) and the admin setting. Unit tests for each limit, its edges, refusals not counting against the address, and checks being off
- [✅] Counting requests made past an address's limit with a passed check against hard limits of their own (`server/src/auth/rateLimits.ts`, new `RateLimitKind`s for checked login tries and checked code sends in an hour, and checked codes after the wrong-guess block in a day, which the auth sweep keeps for their windows), atomically through `takeAttempt()` like the other limits, with repository tests
- [✅] Verifying a token (`server/src/auth/turnstile.ts`): POST to siteverify with the secret key, a timeout of a few seconds, checking `success`, `action` and `hostname` (both skipped with a test secret key). It remembers whether Cloudflare was reachable, and tests it with a token that can't be valid when it hasn't heard from it for a few minutes. The routes take the verifier as a parameter so tests stub it; tests never call Cloudflare
- [✅] Refusing to start with only one of the keys set, or with a test secret key unless dev tools are on or `NODE_ENV=test`, with tests
- [✅] The routes (`server/src/http/auth.ts`, `authCommon.ts`'s password limits and the routes sending email codes): read an optional `botCheckToken` from the body, and refuse a request needing a check without one that passed with a "check needed" error through `sendError()`, carrying the site key and the action. The payload, the error ID and the actions live in `/shared`
- [✅] `auth_events` kinds for a check asked for, passed and failed, with the network's keyed hash; included in the player's data download like the other auth events
- [✅] The client (`client/src/ui/botCheck.ts`): on "check needed", load Turnstile's script once (`render=explicit`), show the widget above the form's submit button in the player's language and the site's dark theme, and send the request again with the token once it arrives, resetting the widget after each answer. A line says what is happening, read out with `announce()`; when the widget needs the player, focus moves to it. A failed or expired check shows its problem with `reportFieldError()` and a button to try again, and a script that won't load says so and suggests another browser or network. Works on the login, register, forgot password and profile pages, and in the dialogs that ask for a password or send a code
- [✅] An admin setting (Settings in the admin pages, `site_settings`) to check every login and code request while the site is under attack, recorded in `admin_events`, and shown turned off with a note while checks aren't configured
- [✅] Privacy policy: Cloudflare Turnstile under the services the site uses, saying it is loaded only when the site asks a browser to show it isn't a bot, and what Cloudflare learns then
- [✅] Add `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to `server/.env.example` (with the test keys, commented out, since the server takes them only with dev tools on) and to CLAUDE.md's Configuration
- [✅] Check the pages with only a keyboard, with a screen reader, in the pseudo-language (`?locale=en-XA`), with the test keys that fail and that ask the player to interact, and with Turnstile's script blocked

**Done when:** a browser that guesses wrong passwords for an address is asked to show it isn't a bot, and once it does can keep trying a little longer while the account's own browsers log in as before; a bot that doesn't pass checks can't use up the address's tries; a player whose address was used up by someone else's guesses still gets a code after passing a check, unless the guesser keeps passing checks too; and a player who logs in normally never loads anything from Cloudflare.

## Phase 18: Rulebooks

A ruleset's races, classes and items come from its books. A universe chooses which books it uses on the Ruleset tab. The core rulebook is always on, and the others start off. What a book brings shows on the Characters and Items tabs only while the book is on, and acts as disabled while it is off. Later, books will bring more than races, classes and items. See Rulebooks in `STRUCTURE-OVERVIEW.md`.

Decided:
- PF1E's books are the Core Rulebook, the Advanced Player's Guide, the Advanced Race Guide and the Advanced Class Guide. SF1E has only the Starfinder Core Rulebook for now. Its other books come later.
- Which book each race and class is from:
	- Core Rulebook: dwarf, elf, gnome, half-elf, half-orc, halfling and human; barbarian, bard, cleric, druid, fighter, monk, paladin, ranger, rogue, sorcerer and wizard
	- Advanced Player's Guide: alchemist, cavalier, inquisitor, oracle, summoner and witch. It has no races
	- Advanced Race Guide: all of its featured and uncommon races. Catfolk, drow, goblin, hobgoblin and ratfolk are in the engine already. This phase adds aasimar, dhampir, fetchling, ifrit, kobold, orc, oread, sylph, tengu, tiefling and undine (featured), and changeling, duergar, gillman, grippli, kitsune, merfolk, nagaji, samsaran, strix, suli, svirfneblin, vanara, vishkanya and wayang (uncommon). Only what the race editor models comes over: ability modifiers, floating bonus, darkvision, light sensitivity and size. Flying, swimming and the like wait until movement has them
	- Advanced Class Guide: arcanist, bloodrager, brawler, hunter, investigator, shaman, skald, slayer, swashbuckler and warpriest, all added in this phase, each with a primary ability, magic tradition and spellcasting style
	- every SF1E race, class and theme is from the Starfinder Core Rulebook
- Every default item names its book too. Today's items are all from the core rulebooks.
- Each optional PF1E book adds a few items from its equipment, checked on Archives of Nethys (`scratchpad/rulebooks-rules.md`):
	- Advanced Player's Guide: the cestus and sword cane (weapons), and wooden armor and quilted cloth (armor)
	- Advanced Race Guide: the kobold's long lash and spiked tail attachments and the ratfolk tailblade (weapons)
	- Advanced Class Guide: it has no mundane weapons or armor, so some of its gear: a book of puzzles, a book of war prayers, a footprints cast, light fire ink and a tome of epics. Its class kits aren't items, since each is a list of other gear
- An item has a category and any number of that category's types, or none. PF1E weapons' types are the fighter's weapon groups from the Core Rulebook's Weapon Training (a dagger is light blades and thrown), and armor's are light, medium and heavy armor and shields. A weapon in no group, such as a tail attachment, ammunition and other gear have no type. Every type so far is the Core Rulebook's, so the types don't depend on the books that are on.
- Races, classes, themes and items a universe adds belong to no book. They always show.
- A race, class or item is usable only while its book is on and its own Enabled box is checked. The two are separate. Turning a book on shows its races and classes as they were left, enabled unless an editor disabled them. Turning it off keeps their edits (starting money, equipment and areas) for when it comes back.
- While a book is off, what it brings is hidden from the Characters tab's tables, the Items tab, item selection, Create Character and a class's starting areas by race. It still shows where it is already in use, as a disabled race, class or item does: characters keep their race and class on the character sheet and in the lobby, the Character List's filters list them, and starting equipment shows the book's items marked as disabled.
- Turning off a book players are using asks on Save once for the whole book. The dialog lists the races and classes characters are and the items characters have, and offers the choices for disabling them one at a time: keep playing or prevent playing for races and classes, keep using or remove for items. The answers are kept with the book while it is off.
- The rule that a universe needs at least one enabled race and class counts books. A save that turns off the Advanced Player's Guide while the witch is the only enabled class is refused.
- Only the core rulebook is on in a new universe, and in every universe that exists when the migration runs. A universe export names its books. An export made before this phase imports with only the core rulebook. The seed's sample universe turns on the Advanced Player's Guide.
- A universe's books are saved with the ruleset's settings (`rulebooks`). They are staged like the rest of the editor and sent with Save, only creators can change them, and they reach players when the draft is applied.
- Every race, class, theme and item gets a description, edited in the race, class, theme and item editors. A default's description is a message written for the engine: a sentence or two, with no Golarion names. An edited or added one is universe text, translated on the Translations tab. Emptying an edited default's description gives back the engine's. Create Character shows the chosen race's, class's and theme's description, and so does the book's Contents dialog. Item selection and the character sheet show items' descriptions.
- Book names are messages. Their descriptions ask translators to use the official title of the book's translated edition where there is one, such as the German "Grundregelwerk".
- The Advanced Class Guide's copyright notice goes on the license page with the other books'.

Steps:
- [✅] Each ruleset's books in `/shared` (`shared/src/rulesets/<ruleset>/rulebooks.ts`): a key, a name message and whether it is always on, and the book of each default race, class, theme and item beside their data
- [✅] The Advanced Race Guide's 25 races and the Advanced Class Guide's 10 classes in `/shared`, with names and summaries, each checked against the books on Archives of Nethys, and a custom migration adding their default rows
- [✅] A `rulebook` column on the default races, classes, themes and items (null on what a universe adds), set by the migrations that add them, so the server can filter by it in SQL: the Items tab pages and filters on the server
- [✅] The optional books' items in `/shared`, with names, and a custom migration adding their default rows
- [✅] Items get a category and a list of types (migrations 0125 and 0126 convert each item's one type, and an import converts an older export's): weapon groups and armor categories for PF1E, checkboxes in the item editor, and the Type filter matching any of an item's types
- [✅] Descriptions: a column on races, classes, themes and items (null keeps the default's), the defaults' descriptions as messages in `/shared`, a field with a length limit in the race, class, theme and item editors, Create Character, item selection and the character sheet, the Translations tab, the audit, export and import
- [✅] `rulebooks` in each ruleset's settings: the optional books turned on, and the answers kept for each book turned off. The server checks it (known keys, the core rulebook always on), with tests
- [✅] What is usable as one pure function, given a race's, class's or item's own state and its book's, used by Create Character, the lobby, starting equipment, starting areas and the check that refuses a save leaving no enabled race or class. Unit tests
- [✅] Hiding the races, classes and items of books that are off from the Characters tab, the Items tab, item selection, Create Character and a class's starting areas by race, while the Character List's filters and character sheets keep them
- [✅] The Rulebooks card on the Ruleset tab, after the settings card: a table of the ruleset's books, each with its name, an on/off switch (Always on for the core rulebook) and a Contents button
- [✅] The Contents dialog: a table each for the book's races, classes and themes (not its items, which can be too many), with their default names, summaries, descriptions and whether each is enabled in this universe
- [✅] Turning off a book in use: one dialog for the book on Save, through the same check that asks about disabled races, classes and items
- [✅] The audit ("Rulebooks" under "Changed the ruleset"), export and import of the books
- [✅] The seed's sample universe turns on the Advanced Player's Guide
- [✅] License page: the Advanced Class Guide's copyright notice
- [✅] Pirate translation of the new messages
- [✅] Check the card, the dialogs and Create Character with only a keyboard, with a screen reader and in the pseudo-language (`?locale=en-XA`)

**Done when:** a new universe offers only the core races and classes; turning on the Advanced Player's Guide and saving adds the witch and the guide's other classes to the Classes table and Create Character, where each can be disabled on its own, and its items to the Items tab; turning the guide off again asks once what happens to the players using it; and each book's Contents dialog shows its races and classes.

## Phase 19: Equipment

Characters equip items to the slots their ruleset has, give items to other characters in their group, and inspect an item's details. Every book the engine supports gets its basic items. See Equipment in `STRUCTURE-OVERVIEW.md`.

Decided:
- Each ruleset lists its slots in `/shared` (`shared/src/rulesets/<ruleset>/equipment.ts`): a key and a name message for each, in the order the character sheet shows them.
	- PF1E: the Core Rulebook's item slots (head, headband, eyes, shoulders, neck, chest, body, armor, belt, wrists, hands, two rings and feet), a tail for the tail weapons, the off arm for a buckler, and the main hand and off hand. Magic items will use the same slots.
	- Only a character whose race has a tail has the tail slot. PF1E races get a "Has a tail" checkbox in the race editor, on for the default catfolk, kitsune, kobold, ratfolk, tiefling and vanara. Equipping a tail item to a character without a tail is refused. A save turning a race's tail off unequips its characters' tail items once it reaches the live version.
	- SF1E: armor, clothing, and the main hand and off hand. Worn magic items, armor upgrades and augmentations add slots later.
- Each item has where it equips: nowhere, one of the ruleset's worn slots, one hand or two hands. This is a setting of its own, apart from the item's kind. A dwarven boulder helmet is a weapon worn on the head. Gauntlets are weapons worn on the hands. A torch is gear held in a hand. The default items get it from `/shared`, and the item editor sets it.
- Hands:
	- The main hand and the off hand each hold one item. A one-handed item goes in either hand. A one-handed weapon can also go in both, like a longsword held in two hands. Other one-handed items, such as shields and torches, don't offer Both hands. A two-handed item takes both hands.
	- Dual-wielding is a one-handed item in each hand. A double weapon, such as a quarterstaff, is one two-handed item. Combat will let it attack as two weapons.
	- A shield takes a hand. A character holds one shield at most. An item is a shield by its types (PF1E's `shields`).
	- PF1E's buckler is worn in the off arm slot and takes no hand. It goes with a two-handed weapon, or with a weapon in each hand. It counts as the character's one shield, so equipping it unequips a shield in a hand, and the other way round.
- Equipping an item into a slot or hand in use unequips what was there. It doesn't ask, since equipping it again is easy. A two-handed item unequips both hands. A one-handed item unequips a two-handed one.
- A ring goes in the first free ring slot, with one Equip in its menu. When both ring slots are full, the menu offers Equip as left ring and Equip as right ring instead, which replace what is there.
- The menu offers equipping only where it changes something. It leaves out a hand or ring slot that already holds the item the same way, and Equip for a worn item whose slot already holds it.
- An equipped item is one of the items the character carries. A character with 3 daggers and one in each hand has 3 daggers, 2 of them equipped. Discarding or giving more than the unequipped ones unequips the rest: the off hand first, then the main hand, then worn slots. The dialog says which. An item hidden because it was disabled with remove is unequipped too.
- Disabled items, and items of books that are off, can still be equipped, unequipped and given. Characters keep using them, as they do now.
- Equipment is a table of its own, `character_equipment` (character, slot, item). Its rows reference the character's carried items, so discarding the last of an item deletes its rows. A two-handed item is one row, in the main hand.
- A save that changes where an item equips, or whether it is a shield or a weapon, unequips it from every character, once it reaches the live version. It doesn't warn: players equip it again.
- Equipping changes no rules yet. Combat, armor class and the like come later and read the equipment. Equipping, unequipping and giving are HTTP routes, like Discard, used from the character sheet in the lobby, the game, the universe page and the player's profile. Each change to a character's items or equipment, Discard's included, is published to the player's windows through the session room, so an open sheet shows it wherever it is.
- Giving: a character gives items to another character in their group, including the player's own characters there. It works whether the other character is online or not, and wherever they are. The items arrive at once. The receiving player's open windows show a toast saying who gave them what, and a line in the group's chat records it, so a player who was offline sees it there.
- Inspect shows what an item has now: its name, kind, types, book, where it equips and description. Rules details such as weight and damage come in a later phase, and Inspect shows them once items have them.
- Create Character equips the starting items: the class's, then the race's, then the universe's, each list by name. Each worn item goes in its slot while the slot is free. Only the first weapon is equipped, in the main hand (both hands for a two-handed one), so no character starts out dual-wielding. A shield goes in the off hand while it is free, and a buckler in the off arm. Other held items, such as torches, stay unequipped.
- The universe's creators change a character's sheet from the Character List as the player can: the same item menu, with Equip, Unequip, Give, Inspect and Discard. Items creators give with Give Items arrive unequipped.
- The default items are the basic (non-magic) items of each supported book, reviewed in `scratchpad/equipment-items.md`. Items with no use, such as an iron pot, are left out. Special materials are left out. They will be a property of an item later. Masterwork is never an item of its own: it will be a flag on an item, so there is no masterwork longsword, thieves' tools or instrument. A generic item is listed as the things it stands for: the Core Rulebook's "musical instrument" is a lute, a mandolin, a flute and the other instruments its Perform skill names. Meals, ale and wine are left out of both rulesets until it is decided whether characters must eat (Open decisions); SF1E's rations stay.
- The Core Rulebook's adventuring gear (backpacks, rope, torches, tents, trail rations and the like) is left out. Each piece is added once the code supports what it does (Later, below). PF1E's alchemical items (acid, alchemist's fire, sunrods and the like) are left out for the time being too.
- Types: PF1E gear gets new types (alchemical, clothing, food and drink, light source, poison, tool), and its torch type becomes light source. Both rulesets get an ammunition weapon type. SF1E's types, which are each one item now, become its weapon categories, ammunition, light and heavy armor, and the same gear types, plus drug and medicinal.
- SF1E's items with tiers are one item per tier, named with the tier first, in the engine's lowercase style: "tactical longsword", "frag grenade I".
- Later, not in this phase (Phase 20): a second set of slots for appearance only, and hiding an equipped item from the avatar. This phase keeps the way open:
	- Slot keys belong to the ruleset, not to a set of slots, so the appearance slots reuse them (all but the hands).
	- `character_equipment` is keyed by character and slot. A `layer` column (stats or appearance) and a `hidden` flag can join it later without moving rows.
	- Whether an item fits a slot is one pure function in `/shared`. The appearance slots reuse it. The rules for hands and shields are separate, and only the stats slots use them.
	- Rules read only the stats slots. Nothing in this phase draws equipment.

Steps (the equipment first, then the default items in their own commits):
- [✅] Slots and where items equip in `/shared` for each ruleset, with names as messages, and pure functions with unit tests: whether an item fits a slot, the hands, ring and shield rules, what equipping something unequips, and which equipped ones discarding or giving unequips
- [✅] Where an item equips: a column on items, set from `/shared` for the default items by the migration, a field in the item editor, the Items tab's summary, the audit, export and import. A save changing it, or whether the item is a shield, unequips the item from characters
- [✅] "Has a tail" on PF1E races: a column set for the default races by the migration, a checkbox in the race editor, the audit, export and import. A save turning it off unequips the race's characters' tail items
- [✅] `character_equipment` and its repository, with tests against the test database: equipping, unequipping, and discarding or hiding items that are equipped
- [✅] Routes to equip, unequip and give items, for the character's player and the universe's creators, checking the rules on the server. Each change to a character's items, Discard's included, is published through the session room. Create Character equips the starting items
- [✅] The character sheet's Equipment section: each slot with what is in it. Each item's menu gets Equip (Main hand, Off hand or Both hands for a one-handed weapon), Unequip, Give, Inspect and Discard. An open sheet updates when the character's items change, on every page that shows it
- [✅] The Give dialog: which character in the group, and how many. The receiving player gets a toast, and the group's chat a line
- [✅] The Inspect dialog, from the item menu and from item selection
- [✅] The Character List's sheet: equipment, with the same item menu as the player's
- [✅] The default items from the reviewed list: names, descriptions, kinds, types, books and where each equips in `/shared`, and custom migrations adding their rows. The new gear and ammunition types, a migration converting PF1E's torch type and SF1E's types (and an import converting an older export's)
- [✅] Pirate translation of the new messages
- [✅] Check the sheet and the dialogs with only a keyboard, with a screen reader and in the pseudo-language (`?locale=en-XA`)

**Done when:** a PF1E fighter equips a longsword and a heavy steel shield, then a greatsword, which unequips both. A rogue holds a short sword in each hand. An SF1E soldier wears armor and holds a laser rifle. The fighter gives a dagger to another character in the group, and that character's player sees it arrive. Inspecting the greatsword shows that it is a two-handed heavy blade from the Core Rulebook.

## Phase 20: Avatars

Each character gets an avatar: a picture of their race and body type, wearing what they have equipped, over a background they choose. The art is drawn by hand in more than one art type, the stick figure and Lucia, and ships with the engine. Characters also get social slots, for items worn only for how they look, and can hide a slot from the avatar. See Avatars and Social slots in `STRUCTURE-OVERVIEW.md`.

Decided:
- Art
	- All art is drawn by a person. None of it is AI generated, and no code or agent draws placeholder art. This phase ships the code and the manifest. Bases and item drawings are added as they are drawn. Tests use solid-color rectangles they make in code.
	- The engine ships the art, like the default tilesets: files in `shared/assets/avatars/<art type>/`, which the server reads to compose avatars and the client imports through Vite. Universes uploading their own avatar art comes later.
	- A manifest in `/shared` (`shared/src/avatars/`) lists the art types, bases, item drawings and backgrounds.
	- Art types: `stickFigure` and `lucia`. "Stick figure" is a message. "Lucia" is the artist's name, so it isn't a message: the manifest holds it as plain text, and the pages show it with `translate="no"`. Some races have only stick figures while the rest is drawn.
	- Lucia Pan's credit on the license page (`license.artworkCredit`) names the avatar art too.
- Bases and body types
	- A base is a race and body type drawn in one art type: a PNG 200 pixels wide and 300 tall.
	- Each default race, in both rulesets, has one list of body types in its ruleset's races data in `/shared`, the same for every art type. Every race starts with femme thicc, femme thin, masc thicc and masc thin, and the lists change as the art is drawn. Create Character starts on a race's first body type. Body type names are messages.
	- An art type may not have drawn every base yet.
- Item drawings
	- An item drawing is a PNG cropped to the item. Each art type maps a default item's key to its drawings.
	- A drawing lists the races it is for, and can narrow to some of their body types and to some slots. The most specific match wins. A longsword can be one drawing for humans and elves and another for halflings. Leather armor can have one per body type.
	- A drawing can have several parts, each an image with its own layer, such as a cloak's front over the base and its back behind it. Several items or drawings can use the same image file.
	- Each part has an x/y offset for each base the drawing is used on.
	- The off hand and the right ring draw the main hand's and the left ring's drawing flipped horizontally, so they need no second file. They have an x/y of their own for each base, set by hand: nothing is worked out from a mirror. A drawing with no off hand offset for a base draws nothing in the off hand on that base.
	- Holding an item in both hands has drawings of its own, since a two-handed grip looks different.
	- An item with no drawing for the art type, race and body type draws nothing.
	- Layers follow the slot draw order, a list in each ruleset's `equipment.ts`. A part can set its own layer, behind the base included.
	- A positioning tool, `client/avatar-positions.html`, works only with dev tools on (`ENABLE_DEV_TOOLS`). It chooses an art type, an item drawing, a race and a body type, and moves each part on the base by dragging or with the arrow keys, the off hand and right ring included. It shows each x/y, lists the bases a drawing still has no offsets for, and copies the drawing's offsets as TypeScript to paste into the manifest. It doesn't write files.
- Backgrounds: dark green and dark red, 200x300 PNGs drawn by hand like the rest of the art. Only the drawn ones are offered, and the choice is left out until one is. Their names are messages.
- Universe-added races and items
	- A race the universe added has "Looks like" (`races.avatar_race_id`), a default race of the same ruleset, in the race editor. Its characters use that race's body types and art. A race with no "Looks like" has no avatar.
	- An item the universe added has "Looks like" too (`items.avatar_item_id`), a default item of the same ruleset, in the item editor. An item with none draws nothing.
	- Default races and items, and their edited copies, use their own art and don't have "Looks like".
	- Both are staged until Save like the rest of the editor, and go into the audit, export and import. An export made before this phase imports with neither set.
- A character's look
	- `characters` gets `body_type`, `art_type` and `background` columns. Existing characters get femme thicc, the stick figure and the dark green background.
	- Create Character gets an Appearance step after the race step: body type, art type and background, with a preview. It is saved in the character draft like the other steps.
	- The player chooses the body type only in Create Character. The universe's creators can change it afterward from the Character List's sheet. The server refuses the change from anyone else.
	- The art type and background can be changed afterward in the character sheet's Appearance dialog, by the player and by creators from the Character List.
	- Only art types with a base for the character's race and body type are offered. A race with no art in any art type skips the art type choice.
	- An art type that no longer has a base for the character falls back to the stick figure, and to no avatar when that has none either. A body type the race's list doesn't have, such as after its "Looks like" changes, is drawn as the list's first.
- Social slots
	- Social slots are for items worn only for how they look. They give nothing. Each slot draws its social item in place of its stats item.
	- They are each ruleset's worn slots except the main hand, off hand, off arm and tail: decorative gloves (PF1E's hands slot), but no decorative weapons. A weapon or shield can't go in a social slot, even one worn elsewhere, such as the dwarven boulder helmet.
	- A social slot holds an item the character carries, checked by the same fit function as the stats slots (Phase 19). The hands and shield rules apply only to the stats slots.
	- A social item doesn't count as equipped. A character can have Cloak A in the stats shoulders slot for its bonuses and Cloak B in the social one. A character carrying one cloak can have it in both. Giving or discarding never unequips a social item until the last of the item goes, which takes it out of its social slots too. An item removed from characters (disabled with remove) leaves its social slots as well.
	- `character_equipment` gets a `layer` column (`stats` or `social`) in its primary key. Rules read only the stats layer.
	- In the sheet's Equipment and Social sections, each slot's name is a button that opens a picker of the carried items that fit it, with Empty to take the item out. The item menu gets Wear socially for an item that fits a social slot. The Character List's sheet does the same for creators.
- Hiding
	- A slot can be hidden from the avatar. A hidden slot draws nothing, neither its social item nor its stats item, and stays hidden when the items in it change.
	- Hidden slots are a table, `character_hidden_slots` (character, slot). Each slot on the sheet has a Hide toggle.
- Drawing and caching
	- What an avatar draws is one pure function in `/shared`: given the manifest and the character's race, body type, art type, background, equipment and hidden slots, it returns the layers (the background, the parts behind the base, the base, then the items' parts in layer order) and their hash.
	- The server composes the avatar with sharp and stores one PNG per character in object storage (`avatars/<character ID>.png`), overwritten when the look changes. No versions are kept.
	- `characters.avatar_hash` is the hash of the layers the stored PNG was made from. The server sends each character's current hash with their data, and pages load `/avatars/<character ID>.png?look=<hash>`, cached for good. When the hash asked for isn't the stored one, the server composes the PNG again first. Equipment changes, universe saves that unequip items or change "Looks like", and new art all show this way, without each having to compose the avatar.
	- The lobby's and group's lists of who's there get each character's ID in the room's state, but not their hash: those avatars are loaded without one, and the browser asks each time whether they changed (their ETag is the hash), so the rooms don't read the database outside their lifecycle hooks.
	- Create Character's preview is the base and the background, without items. The server composes one file for each art type, ruleset, race, body type and background, shared by every player who chooses it (`avatars/previews/<art type>/<ruleset>/<race key>-<body type>-<background>.png`, served at `/avatar-previews/<art type>/<ruleset>/`; race keys such as human are in both rulesets), and composes it again when the hash of its files changes (kept in the object's metadata). Its ETag is the hash. A universe's own race uses its "Looks like" race's key. Nothing is saved to a character until it is made. The browser composes nothing, apart from the positioning tool.
	- Avatars and previews are served to anyone with the address, like `/tile-graphics/`. Character IDs are random UUIDs, and an avatar shows only what is drawn.
	- Deleting a character, an account or a universe deletes its characters' avatars.
- Where avatars show
	- The character sheet, full size, wherever it opens: the lobby, the game, the universe page, the profile and the Character List. A character with no avatar shows "No avatar yet".
	- Create Character's Appearance step and review.
	- A head-and-shoulders crop (CSS) beside each character in the lobby's list of who's here, the player's characters and the group's members.
	- A thumbnail beside each character on the profile and the universe page.
	- The alt text is the character's name with their race and class, "Mara (Dwarf Fighter)". It comes from one function, `characterLabel()`, beside `characterDescription()` in `client/src/ui/raceAndClassNames.ts`, and the Give dialog uses it too in place of its own message. Nothing else builds a character's description. The crops and thumbnails sit beside the character's name, inside the same button, so their alt text is empty and screen readers don't read the name twice.
- Later, not in this phase: sprites in the game's areas, universes uploading avatar art, avatar art in cross-universe play, and more backgrounds.

Steps:
- [✅] The manifest in `/shared`: art types, the body types of each default race, bases, item drawings (races, body types, slots, parts, layers, offsets, and the off hand and right ring offsets) and backgrounds, with names as messages. The slot draw order in each ruleset's `equipment.ts`
- [✅] The pure function returning an avatar's layers and their hash, with unit tests: matching drawings, the off hand and right ring flipped with their own offsets, parts behind the base, social items over stats items, hidden slots, missing art, and the art type and body type fallbacks
- [✅] The background script and the two background PNGs
- [✅] `body_type`, `art_type`, `background` and `avatar_hash` on `characters`, `layer` on `character_equipment` and the `character_hidden_slots` table, with their migration and repository tests against the test database
- [✅] "Looks like" on universe races and items: the columns, the race and item editors, the audit, export and import
- [✅] Composing avatars and previews with sharp, storing them in object storage, and the `/avatars/` and `/avatar-previews/` routes, which compose again when the hash changes. Deleting avatars with characters, accounts and universes. Cover the routes in `server/test/http.test.ts`
- [✅] Routes to wear and remove social items, hide and show slots, and change the art type, background and body type (creators only), for the player and the universe's creators, checking the rules on the server. Each change is published through the session room, like equipment changes
- [✅] Create Character's Appearance step, with the preview
- [✅] The character sheet: the avatar, the Social section, slot names as buttons opening the item picker, Hide toggles, Wear socially in the item menu, and the Appearance dialog (the body type only for creators)
- [✅] Avatars in the lobby's and group's lists, on the profile and on the universe page. `characterLabel()` for their alt text and the Give dialog
- [✅] The positioning tool
- [✅] The license page's credit
- [✅] Pirate translation of the new messages
- [ ] Draw the art: the dark green and dark red backgrounds, and human bases and a few item drawings in the Lucia art type and stick figures, added as `shared/assets/avatars/README.md` describes
- [ ] Check the new step, the sheet, the dialogs and the positioning tool with only a keyboard, with a screen reader and in the pseudo-language (`?locale=en-XA`)

**Done when:** with human bases and a few item drawings in place, a player makes a femme thin human with the Lucia art type and the dark red background, seeing the preview as they choose. Her sheet shows her avatar in her equipped leather armor, holding a short sword in each hand, the off hand's flipped. Wearing a cloak socially draws it over her armor. Hiding the shoulders slot leaves the cloak off. Switching to the stick figure redraws her. Another player sees her avatar beside her name in the lobby, and only a creator can change her body type.

## Phase 21: Cloud deployment

Neon and Colyseus Cloud cost money, so this waits until the game is worth testing with outside players.
The first deploy tends to surface WebSocket, TLS and environment issues, so leave time for it.

- [ ] Choose the S3-compatible service for uploads, make its bucket (private: the game server serves the files), and set the `STORAGE_*` variables in the Colyseus Cloud dashboard
- [ ] Choose the email service, set up its sending domain (SPF, DKIM and DMARC), and set `SMTP_URL` (over TLS) and `EMAIL_FROM` in the Colyseus Cloud dashboard, with an `AUTH_HMAC_KEY` of its own
- [ ] Check the deploy includes `shared/locales/` and `shared/assets/avatars/`: the server reads the translations from the first to write emails in each player's language, and composes avatars from the second
- [ ] Choose where the production client is hosted (Colyseus Cloud only hosts the game server), and whether QA/staging uses a subdomain or its own domain. The host must serve `<name>.html` for `/<name>` (the pages link to `/edit`, `/license` and so on), and each of `PATH_PAGES` for every address under its path, such as `game.html` for `/game/<slug>`, `universe.html` for `/universe/<slug>` and `edit.html` for `/edit/<universe ID>`; see `client/src/pages.ts`
- [ ] Create Neon project with `dev` and `prod` branches, in the region nearest the planned Colyseus Cloud location. Use Postgres 18 to match `docker-compose.yml`
- [ ] Create the migration, app and admin roles on each Neon branch with the same ownership and grants as the scripts in `docker/postgres/init/`, using `docker/postgres/neon/01-roles.sql` and `02-grants.sql` (roles made in the Neon console join `neon_superuser`); the server gets only the app role's and the admin role's pooled connection strings (`DATABASE_URL`, `ADMIN_DATABASE_URL`)
- [ ] Run migrations against Neon `prod`
- [ ] Deploy server with `npx @colyseus/cloud deploy`; set env vars in the dashboard (pooled Neon URL, `ALLOWED_ORIGINS` = the production client origin)
- [ ] Set `CLIENT_ADDRESS_HEADER` (and `TRUSTED_PROXY_HOPS` for X-Forwarded-For) for the game server's host, then check it once deployed (see TODO at the end of this file)
- [ ] Before running more than one game server process: Redis presence and driver, and the in-memory publishers (`server/src/players/`, `server/src/world/`) carried over it, so the rooms and routes of one universe (editor rooms, lobbies, groups and the change routes) reach each other across processes
- [ ] Point a production client build at the `wss://` endpoint
- [ ] Set security headers on the client host and test them against the production build:
	- `Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: blob: https://<game server>; media-src 'self' data: blob:; connect-src 'self' https://<game server> wss://<game server>; frame-src https://challenges.cloudflare.com; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests` (Phaser needs `data:`/`blob:` for some textures and audio; the game server in `img-src` is for uploaded tilesets and avatars; `challenges.cloudflare.com` is Turnstile's script and widget, Phase 17)
	- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`
- [ ] Check whether Colyseus Cloud's proxy sends `Strict-Transport-Security` for the game server; add it if not

**Done when:** two players on different networks can join the same room in the cloud.

## Phase 22: Robustness and polish

- [ ] Reconnection with `allowReconnection` for unexpected disconnects
- [ ] Graceful handling of server restarts during deploys
- [ ] Basic logging and error reporting
- [ ] Neon production autosuspend disabled or lengthened
- [ ] Confirm Neon's point-in-time restore retention and test a restore
- [ ] Alerts for spikes in failed logins, failed bot checks and server errors
- [ ] Load test with simulated clients to size the Colyseus Cloud plan
- [ ] Load test the lobby to set its `maxClients`, and open another lobby instance when one is full
- [ ] Right-to-left languages: `dir` on the page, CSS logical properties (`margin-inline-start`) in the SCSS, and Phaser's `rtl` text style

**Done when:** players survive brief network drops and a redeploy without data loss.

## Phase 23: Images and moderation

Needed before universes are open to the public.

- [✅] Image storage: S3-compatible object storage (`server/src/storage/`), with uploads validated and re-encoded to strip metadata and anything that isn't an image (`server/src/images/`); done for tilesets in Phase 13. The production service is chosen with the deployment (Phase 21)
- [ ] "I have the rights to use this image" on every upload (tilesets have it)
- [ ] Profile photos, universe logos and banners (tilesets are uploaded since Phase 13)
- [ ] Stock graphics for each ruleset
- [ ] Reporting content and players, copyright infringement reports, and a review queue for server admins

**Done when:** universes can use uploaded art, and anything inappropriate can be reported and taken down.

## Phase 24: Messages

- [ ] Private messages with blocking, reporting and rules for who can message whom
- [ ] Group invites sent by private message
- [ ] A way to tell users with the same name apart, which user search depends on
- [ ] Emoji reactions
- [ ] @messages

**Done when:** players can message each other and invite each other to groups, and can block anyone who abuses it.

## Later (not yet specified)

- Combat, monsters, NPCs and dialog (their results go in world state), and gaining experience. Mobs' hit points and every chance to hit go through the group's difficulty level (`scaleMobHitPoints()` and `scaleHitChance()` in `server/src/logic/difficulty.ts`), and a character who dies in a group with permadeath is gone for good
- Offline group members: the summoning ring (see Offline group members in `STRUCTURE-OVERVIEW.md`)
- Money changers: NPCs who change a character's coins into the fewest coins of the same worth (`changePf1eMoney`), perhaps for a fee
- One-off event messages for effects (hits, explosions)
- The overworld map and its scale
- Cross-universe play: the portal room, the Connect to the Multiverse tab, "[Name] of [Universe]"
- Character sprites in the game's areas
- Avatar art a universe uploads for its own races and items, or in place of the engine's (Phase 20 ships the engine's), and more backgrounds
- PF1E's adventuring gear, added case by case as the code supports each piece: tents, bedrolls and blankets with the sleep setting, torches, candles and lanterns once they light an area, rope and grappling hooks with climbing, manacles with capturing, and so on (`scratchpad/equipment-items.md` lists them)
- PF1E's alchemical items from the Core Rulebook, the Advanced Player's Guide and the Advanced Race Guide (`scratchpad/equipment-items.md` lists them)
- Items' rules details (price, weight, damage, armor), for the default items from their books and in the item editor for every item, shown by Inspect, with combat. Special materials (mithral, adamantine) as a property of an item, and masterwork as a flag on an item
- Placed objects for distinctive buildings and lone trees: made once and placed in any number of areas, each with an image, the cells it covers (each with its own walk time and vision cost, read by the server), the part drawn above players, and door cells for area links. Placements are a list per area, not cells in its chunks. An Objects tab and a place tool in the area editor. Building interiors are indoor areas, as now
- Walls as a layer of their own, so a cell holds a ground tile and a wall over it, rather than walls drawn over the area's default tile
- Tall walls with a front face: blob frames 32x64 drawn over the row south of the wall, and over players standing there
- Exporting and importing a universe's translations (JSON or XLIFF), and a translation service such as Weblate for the engine's catalogs
- Right-to-left languages (Arabic, Hebrew, Persian, Urdu), before the first such translation ships. Text in them already displays and saves; the pages' layout doesn't follow them yet:
	- `startLocalization()` (`client/src/localization.ts`) sets `<html lang>` but not `dir`: set `dir="rtl"` from the locale's direction (`Intl.Locale`'s text info, with a list of right-to-left scripts where browsers lack it), and in `public/remembered-language.js` too, so a page hidden while it's translated doesn't flip once shown
	- About 50 rules in the SCSS use physical left and right (`margin-left`, `padding-right`, `left:`, `text-align: left`, `border-left`, four-value `margin` and `padding`, `background-position`, `to right` gradients): change them to logical properties (`margin-inline-start`, `inset-inline-start`, `text-align: start` and so on). The editor's chat, save bar and tab fades in `edit.scss` are the largest part
	- `client/src/ui/scrollingTabs.ts` works out its arrows from `scrollLeft`, which is 0 at the start and negative toward the end in a right-to-left page
	- The editor's tab list (`EditorScreen.ts`) moves to the next tab with the Right arrow; in a right-to-left page it is the Left arrow. The area editor's arrow keys move over the map, which doesn't mirror, so they stay
	- Icons that point the way text reads (`ph:arrow-left`, `ph:arrow-right`, `ph:caret-left`, `ph:caret-right`, `ph:paper-plane-right`, `ph:arrow-u-up-left`) mirror in a right-to-left page, perhaps by a class the icons plugin in `client/vite.config.ts` adds to them
	- Text players write (names, chat) shown in a page of the other direction, with `dir="auto"` or `unicode-bidi: plaintext`, so punctuation and numbers at its ends sit on the right side
	- A right-to-left pseudo-language (`ar-XB`, as browsers have, beside `en-XA`) to check every page with
	- Whether to allow the left-to-right, right-to-left and Arabic letter marks (U+200E, U+200F, U+061C) in `DISALLOWED_TEXT_CHARACTERS`, which writers use to place punctuation in mixed text; only the overrides and isolates can make text read in a misleading order
- Playing a universe's draft, so creators, builders and beta testers can test it before it is applied: choosing it, and which characters play it without changing their progress in the live version
- An Errors tab before Audit, for problems found during play that a save can't check for in advance, for creators and builders, each version separately. Each error has a code (`area-<area ID>-<setting>` and the like, which the tab turns into a link to what it names), its universe, a message (a message ID and its values, shown in each editor's language), when it first and last happened, and how many times; logging a code the universe already has updates its row. The tab's header counts the errors (not in red, and 0 standing out less), from an index so it is quick, and errors are cleared one at a time or all at once, staged until Save. Errors a later check can prove fixed are deleted by it

---

## Open decisions

- Whether character names must be unique within a universe (Phase 10)
- How groups are listed in the lobby (Phase 11)
- How the lobby shows who is online, when it may hold many more players than a group or a universe's editors
- Auth approach, account linking and the email sending service (Phase 14)
- Which S3-compatible service stores uploads in production, and its bucket (Phase 21)
- Telling users with the same name apart (Phase 24)
- Whether a universe can rename engine terms, such as calling gold "crowns" (Phase 15)
- Fonts for text drawn in the game's areas in scripts the default font doesn't cover (Phase 22)
- Whether to offer machine translation of chat (later)
- Whether characters must eat and drink, and so whether meals, ale, wine and the like become items (Phase 19 has only SF1E's rations)
- Whether to add client-side prediction (after Phase 7, if movement feels laggy)
- Whether players are shown the name of the area they are in (on screen, or when they go into another area or cross a seam into a neighbor); it is only read out to screen readers so far
- Game server host (Colyseus Cloud or another), and its deployment location(s) (Phase 21). The host's proxies decide which forwarding header the server trusts for clients' addresses
- Client host, and a subdomain or separate domain for QA/staging (Phase 21)

---

## TODO

- [ ] Confirm the client address header on the game server's host (Phase 21; finding 4 in `SECURITY-FINDINGS.md`). The code trusts only the header `CLIENT_ADDRESS_HEADER` names, but which one is safe depends on the host's proxies, which aren't chosen yet:
	- Find out which header the host's proxy sets, and whether it overwrites X-Real-IP or only adds to X-Forwarded-For. Prefer X-Forwarded-For unless the proxy is known to overwrite X-Real-IP
	- Count the proxies that add to X-Forwarded-For (a load balancer or CDN in front of the host's proxy is a second one) and set `TRUSTED_PROXY_HOPS`
	- Once deployed, log in from one network twice: once plainly, and once with a forged `X-Real-IP` and a padded `X-Forwarded-For` (`X-Forwarded-For: 203.0.113.9, 198.51.100.8`). Both auth events should have the same network hash; a different one means the server trusted the forged header
	- Log in from two different networks: new rows in the auth events should each have a network hash, a different one for each network, and the server log shouldn't show "A request's client address could not be read"
