# PLAN.md

Phased roadmap for building the game locally, then deploying to Colyseus Cloud + Neon.
Each phase ends with a "Done when" check. Tick boxes as work completes and keep the
**Current phase** line updated so each new session knows where to pick up.

**Current phase:** 2

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

- [ ] Message type enum and payload interfaces in `/shared`
- [ ] Schema classes: `GameState` containing a `MapSchema<Player>`
- [ ] `GameRoom` with `onCreate`, `onJoin`, `onLeave`, `onDispose`; set `maxMessagesPerSecond` (Colyseus defaults it to `Infinity`)
- [ ] Input message handler that queues inputs per player; validate payloads against the `/shared` types (no `any`) and don't log raw client input
- [ ] Simulation loop (~30 Hz) calling pure logic in `server/src/logic/`: `setTimestep`, or `setFixedTimestep` if we add client-side prediction (see the `colyseus` skill)
- [ ] Health-check HTTP route; remove the template's `/api/hello` and `/hi` routes (or serve them only with dev tools on)
- [ ] Unit tests for the movement logic

**Done when:** the Colyseus dev tools can join the room and show player state changing.

## Phase 3: Client connection

- [ ] Connect via `@colyseus/sdk` (formerly colyseus.js) using `VITE_SERVER_URL`
- [ ] Phaser scene creates and removes sprites from state `onAdd` / `onRemove`
- [ ] Send keyboard input as messages; never send positions
- [ ] Interpolate rendered positions between server patches
- [ ] Add a "Source" link to the client UI (repository URL, copyright line, AGPL notice). The AGPL (section 13) requires anyone running a modified version to offer players its source; having the link already in place means forks carry it with them

**Done when:** two browser tabs show two players moving smoothly and seeing each other.

## Phase 4: Early cloud smoke test

Do this before the game gets big, to surface WebSocket, TLS, and env issues early.

- [ ] Create Neon project with `dev` and `prod` branches, in the region nearest the planned Colyseus Cloud location. Use Postgres 18 to match `docker-compose.yml`
- [ ] Create the migration and app roles on each Neon branch with the same ownership and grants as `docker/postgres/init/01-roles.sh`; the server gets only the app role's pooled connection string
- [ ] Run migrations against Neon `prod`
- [ ] Deploy server with `npx @colyseus/cloud deploy`; set env vars in the dashboard (pooled Neon URL, `ALLOWED_ORIGINS` = the production client origin)
- [ ] Point a production client build at the `wss://` endpoint
- [ ] Choose where the production client is hosted (Colyseus Cloud only hosts the game server)
- [ ] Move the inline `<style>` in `client/index.html` to a CSS file so the CSP doesn't need `'unsafe-inline'`
- [ ] Set security headers on the client host and test them against the production build:
	- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' https://<game server> wss://<game server>; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests` (Phaser needs `data:`/`blob:` for some textures and audio)
	- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`
- [ ] Check whether Colyseus Cloud's proxy sends `Strict-Transport-Security` for the game server; add it if not
- [ ] In the GitHub repository's Settings > Advanced Security, turn on Dependabot alerts, Dependabot security updates and secret scanning with push protection (`.github/dependabot.yml` already configures version updates, and gitleaks runs in the pre-commit hook)
- [ ] Add `github-actions` (once there are workflows) and `docker-compose` entries to `.github/dependabot.yml`
- [ ] Review `npm audit`: the known low/moderate findings come from `@colyseus/auth` (bundled with `colyseus`, unused) and the old `esbuild` under `drizzle-kit` (dev-only; the advisory concerns esbuild's dev server, which drizzle-kit doesn't run); don't run `npm audit fix --force`, which downgrades Colyseus

**Done when:** two players on different networks can join the same room in the cloud.

## Phase 5: Gameplay loop

- [ ] Define the core game rules (to be specified) as pure functions with tests
- [ ] Server-side input validation (rate limits, bounds checks)
- [ ] Match start/end flow; lock rooms when full or in progress
- [ ] One-off event messages for effects (hits, explosions)

**Done when:** a full match can be played start to finish.

## Phase 6: Persistence

- [ ] `playerRepo` with `load` / `save` functions
- [ ] Load profile in `onJoin`; save in `onLeave` / `onDispose`
- [ ] Match history table and save on match end
- [ ] Verify no DB calls occur inside the simulation tick

**Done when:** player progress survives a server restart.

## Phase 7: Authentication

- [ ] Choose an approach (own JWT login route vs. a hosted auth provider); prefer OAuth or a provider so the server never stores passwords. If choosing `@colyseus/auth`, check its `npm audit` findings first
- [ ] Verify tokens in `onAuth`; reject unauthenticated joins. Tokens are short-lived with a pinned algorithm, and `exp`, `iss` and `aud` are checked
- [ ] Client login flow passing the token in join options
- [ ] Rate-limit login, signup and reset routes; use generic error messages that don't reveal whether an account exists
- [ ] Log auth events (logins, failures, resets) without passwords or tokens
- [ ] Tests for expired tokens, tokens for deleted users, another user's resource IDs and replayed reset links
- [ ] Account deletion, data export and a privacy policy
- [ ] Review against sections 1-3 and 5 of `SECURITY-PRACTICES.md`

**Done when:** only authenticated players can join, and their identity maps to a DB row.

## Phase 8: Robustness and polish

- [ ] Reconnection with `allowReconnection` for unexpected disconnects
- [ ] Graceful handling of server restarts during deploys
- [ ] Basic logging and error reporting
- [ ] Neon production autosuspend disabled or lengthened
- [ ] Confirm Neon's point-in-time restore retention and test a restore
- [ ] Alerts for spikes in failed logins and server errors
- [ ] Load test with simulated clients to size the Colyseus Cloud plan

**Done when:** players survive brief network drops and a redeploy without data loss.

---

## Open decisions

- Core game design and rules (Phase 5)
- Auth approach (Phase 7)
- Whether to add client-side prediction (after Phase 5, if movement feels laggy)
- Colyseus Cloud deployment location(s)
