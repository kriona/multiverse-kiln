# Server

The Colyseus game server. See the [root README](../README.md) for machine setup and running the project, and [Colyseus documentation](https://docs.colyseus.io/) for the framework.

Run all commands from the repository root with `-w server`, e.g. `npm run dev -w server`.

## Structure

- `src/index.ts`: entry point. Leave it alone so the server can deploy to Colyseus Cloud
- `src/app.config.ts`: server configuration: rooms, HTTP routes, Express middleware
- `src/transport.ts`: HTTPS/WSS transport; refuses to start without a certificate (except on Colyseus Cloud and in tests)
- `src/rooms/`: room handlers
- `src/rooms/schema/`: state synchronized to every client in a room
- `test/`: mocha tests that boot the real server and connect real clients; `test/setup.ts` runs first
- `loadtest/example.ts`: scriptable client for `npm run loadtest`
- `ecosystem.config.cjs`: pm2 configuration used by Colyseus Cloud

## Scripts

- `npm run dev -w server`: run the server with auto-restart (`tsx watch`). Usually started for you by `npm run dev` at the root
- `npm test -w server`: run the mocha test suite
- `npm run build -w server`: compile to `build/`
- `npm run start -w server`: run the compiled build
- `npm run loadtest -w server`: connect simulated clients to `LOADTEST_ENDPOINT` with [`@colyseus/loadtest`](https://github.com/colyseus/colyseus-loadtest/). Start the server first

With `ENABLE_DEV_TOOLS=true` in `server/.env`, the playground is at `https://www.multiversekiln-dev.com:2567` and the monitor at `/monitor`.
