# Server

The Colyseus game server. See the [root README](../README.md) for machine setup and running the project, and [Colyseus documentation](https://docs.colyseus.io/) for the framework.

Run all commands from the repository root with `-w server`, e.g. `npm run dev -w server`.

## Structure

- `src/index.ts`: entry point. Leave it alone so the server can deploy to Colyseus Cloud
- `src/app.config.ts`: server configuration: rooms, HTTP routes, Express middleware
- `src/transport.ts`: HTTPS/WSS transport; refuses to start without a certificate (except on Colyseus Cloud and in tests)
- `src/rooms/LobbyRoom.ts`: the one lobby every window joins: login by name, chat, who's online, and creating and joining groups
- `src/rooms/GameRoom.ts`: a group's game room: joins and leaves, input handling and the 30 Hz simulation loop
- `src/rooms/payloads.ts`: zod validators for client message payloads, each matching an interface in `/shared`
- `src/rooms/inputQueue.ts`: per-player queues of inputs received between ticks (server-only, not synced)
- `src/players/onlinePlayers.ts`: the logged-in players (by browser ID) and the group each is in, shared by the lobby and the game rooms. In memory only, so it needs a single server process
- `src/logic/`: game rules as pure functions (no Colyseus, database or I/O), unit-tested in `test/logic/`
- `src/http/health.ts`: `GET /health`, the health-check route
- `src/db/schema.ts`: Drizzle schema, the source of truth for the database tables
- `src/db/client.ts`: connection pool for `DATABASE_URL`; only repository modules in `src/db/` use it
- `drizzle/`: generated SQL migrations. Create them with `npm run db:generate -w server`; don't edit them by hand
- `drizzle.config.ts`: drizzle-kit configuration; migrations connect with `MIGRATION_DATABASE_URL`
- `test/`: mocha tests that boot the real server and connect real clients; `test/setup.ts` runs first
- `loadtest/example.ts`: scriptable client for `npm run loadtest`
- `ecosystem.config.cjs`: pm2 configuration used by Colyseus Cloud

## Scripts

- `npm run dev -w server`: run the server with auto-restart (`tsx watch`). Usually started for you by `npm run dev` at the root
- `npm test -w server`: run the mocha test suite
- `npm run build -w server`: compile to `build/`
- `npm run start -w server`: run the compiled build
- `npm run db:generate -w server`: create a migration in `drizzle/` from changes to `src/db/schema.ts`
- `npm run db:migrate -w server`: apply pending migrations to `MIGRATION_DATABASE_URL`. Start Postgres first (`docker compose up -d`)
- `npm run loadtest -w server`: connect simulated clients to `LOADTEST_ENDPOINT` with [`@colyseus/loadtest`](https://github.com/colyseus/colyseus-loadtest/). Start the server first

With `ENABLE_DEV_TOOLS=true` in `server/.env`, the playground is at `https://www.multiversekiln-dev.com:2567` and the monitor at `/monitor`.
