# CLAUDE.md

Context and rules for working in this repository. Read this before making changes.
See `PLAN.md` for the build roadmap and current phase.

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
/server          Colyseus server.
  src/index.ts       Colyseus Cloud entry point - never modify it (Colyseus's rule for Cloud deploys)
  src/app.config.ts  define room types, HTTP routes, Express middleware
  src/transport.ts   HTTPS/WSS transport
  src/rooms/         Room classes (lifecycle hooks, message handlers, tick loop)
  src/rooms/schema/  @colyseus/schema state classes
  src/logic/         pure game-simulation functions (no I/O)
  src/db/            Drizzle client, schema, and repository modules
  src/auth/          token verification
  src/http/          REST routes (health, login, leaderboard)
/shared          Code imported by both client and server:
                 message type enums, payload interfaces, constants
docker-compose.yml   local Postgres
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
- Use a standard TCP Postgres driver (`pg` or `postgres.js`) with a connection pool. Do not use Neon's HTTP/serverless driver; the server is a long-running process.
- In production, use Neon's **pooled** connection string.
- Two roles: migrations run as the migration role, which owns the tables; the server runs as the app role, which can read and write rows but not alter tables. Locally, `docker/postgres/init/01-roles.sh` creates them. Never give the server the migration role's credentials.
- `server/src/db/client.ts` throws on import when `DATABASE_URL` is unset. The test suite doesn't set it yet, so tests that boot the server will need a test database once a room imports a repository (Phase 6).

## Configuration

- All environment-specific values come from environment variables. Never hard-code URLs, credentials, or secrets, and never commit `.env` files. The pre-commit hook runs gitleaks on staged changes and blocks commits that contain secrets.
- Root (`docker-compose.yml`): `POSTGRES_PASSWORD`, `KILN_MIGRATOR_PASSWORD`, `KILN_APP_PASSWORD`, `POSTGRES_PORT`.
- Server: `DATABASE_URL` (the app role), `MIGRATION_DATABASE_URL` (the migration role; drizzle-kit only, never the running server), `PORT` (default 2567), `ENABLE_DEV_TOOLS` (playground and `/monitor`, never in production), `SSL_KEY_FILE` / `SSL_CERT_FILE`, `ALLOWED_ORIGINS`, `LOADTEST_ENDPOINT`, auth secret(s).
- Client: `DEV_HOST`, `DEV_PORT`, `DEV_SSL_KEY_FILE` / `DEV_SSL_CERT_FILE`, `VITE_SERVER_URL` (`wss://www.multiversekiln-dev.com:2567` locally, `wss://...` in production).
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

`start.bat` (runs `npm install`, then `npm run dev`) or `npm run dev` at the root builds `shared`, then runs the shared watcher, server, and client together in one terminal.

```bash
docker compose up -d                 # start local Postgres
npm run db:generate -w server        # create a migration after changing server/src/db/schema.ts
npm run db:migrate -w server         # apply Drizzle migrations
npm run dev -w server                # Colyseus on wss://www.multiversekiln-dev.com:2567
npm run dev -w client                # Vite on https://www.multiversekiln-dev.com:5173
```

Run all npm commands from the repository root, using `-w <package>` to target one package (e.g. `npm install <pkg> -w server`).
Test multiplayer by opening two browser tabs. The local Postgres major version should match the Neon project's.

## Coding conventions

- TypeScript `strict` mode everywhere. Avoid `any`; validate untrusted input (client messages, request bodies) at the boundary.
- Prefer small, focused modules. Room classes orchestrate; logic lives elsewhere.
- Write unit tests for `server/src/logic/` and repository modules.
- Code must pass `npm run lint` (ESLint, `eslint.config.js`); a pre-commit hook enforces it. Run it after making changes, and fix problems with Edit rather than `eslint --fix`. The import restrictions for `server/src/logic/` and `server/src/rooms/` enforce the architecture and database rules above - don't disable them.
- Colyseus APIs changed substantially in 0.17 and 0.18, and recall of them is usually out of date. **Use the `colyseus` skill** (`.agents/skills/colyseus/SKILL.md`) before writing or changing any Colyseus code: rooms, Schema state, messages, matchmaking, reconnection, the client SDK (`@colyseus/sdk`) or server config. Read the matching file in its `references/` folder before non-trivial work in that area. Check the installed versions in `server/package.json` and `client/package.json` first; the skill is written for `colyseus` 0.18 and `@colyseus/schema` 5.
- Phaser 4 also changed substantially from Phaser 3, which most recall is based on. **Use the Phaser skills** (official, from `phaserjs/phaser`: one per engine area in `.agents/skills/<area>/SKILL.md`, e.g. `scenes`, `sprites-and-images`, `loading-assets`, `input-keyboard-mouse-touch`, `tweens`, `tilemaps`) before writing or changing client code that uses Phaser. When unsure whether an API still exists, check `v4-new-features` and `v3-to-v4-migration` first. Check the installed version in `client/package.json`; the skills are written for Phaser 4.
- **Never use Phaser physics (`physics-arcade`, `physics-matter`) for gameplay.** Movement, collisions and every other game rule run on the server (architecture rules 1, 4 and 6); the client only renders and interpolates. Phaser physics is acceptable only for purely cosmetic effects that never feed back into game state. If client-side prediction is added later, it reuses the server's pure functions from `server/src/logic/` (moved to `/shared` if needed), not Phaser physics.
- Skill examples show library APIs, not this project's conventions. Where they differ, this file and the global code style win: rooms reach the database only through repositories and only at lifecycle boundaries (the Colyseus skill's example queries a database from a message handler), the client connects to `VITE_SERVER_URL` rather than `http://localhost:2567`, client code is TypeScript (the Phaser skills' examples are JavaScript), and code follows the house style (single quotes, Allman braces).
- When unsure about an architectural choice, follow the rules above and ask rather than inventing a new pattern.

## Deployment (later phases)

- Game server: `npx @colyseus/cloud deploy` from `/server`. Production env vars are set in the Colyseus Cloud dashboard.
- Database: Neon, with separate `dev` and `prod` branches. Run migrations against the target branch as a deploy step, before rolling out new server code.
- Put the Neon project in the region closest to the Colyseus Cloud deployment.
- Disable or lengthen Neon autosuspend on the production branch to avoid cold starts on player login.
