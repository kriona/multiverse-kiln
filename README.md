# Multiverse Kiln

An engine for making multiplayer browser-based role-playing games.

See `PLAN.md` for the roadmap and current phase, and `CLAUDE.md` for architecture and coding rules.

## Technology overview

| Area | Technology |
|---|---|
| Client | TypeScript + [Phaser](https://phaser.io/) rendering to a WebGL canvas, served by [Vite](https://vite.dev/) |
| Server | Node.js + TypeScript running [Colyseus](https://docs.colyseus.io/) (rooms, state sync over WebSockets) |
| Shared | A TypeScript package imported by both client and server (message types, payloads, constants, synced state classes) |
| Database | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/): Docker locally, [Neon](https://neon.tech/) in production |
| Hosting | Colyseus Cloud (game server) + Neon (database) |

The server is authoritative: clients send inputs, and the server simulates the game and syncs state back to every client.

## Repository layout

This is an [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) monorepo with three packages:

```
/client     Phaser game (Vite): Home (index.html), the game (game.html) and the world editor (edit.html)
/server     Colyseus server
/shared     Code used by both client and server (published locally as @multiverse-kiln/shared)
```

There is a single `node_modules` and `package-lock.json` at the root. `shared` is compiled to `shared/dist`, and client and server import that compiled output.

## Setting up your machine

### 1. Install the tools

- **Node.js 24.14.0 or newer** (LTS recommended). Check with `node -v`. npm comes with it.
- **Git**.
- **gitleaks**, which the pre-commit hook uses to block commits containing secrets (see [Secret scanning](#secret-scanning)). On Windows: `winget install Gitleaks.Gitleaks`; on macOS: `brew install gitleaks`. Open a new terminal (and restart VS Code or your Git client) afterwards so it's on your `PATH`.
- **Docker Desktop**, for the local Postgres database. On Windows: `winget install Docker.DockerDesktop`, then start Docker Desktop once and let it finish setting up.
- **VS Code** (recommended; see [Working in VS Code](#working-in-vs-code)).

### 2. Clone and install

```bash
git clone <repo-url> multiverse-kiln
cd multiverse-kiln
npm install
```

Always run `npm install` from the **repository root**, never from inside `client`, `server`, or `shared`. The root install sets up all three packages and links `shared` into the others.

If you use Claude Code, also run this once from the repository root:

```bash
npx skills add colyseus/skill
npx skills add phaserjs/phaser
```

These are the official agent skills (documentation written for AI coding agents) for [Colyseus](https://github.com/colyseus/skill) and [Phaser](https://github.com/phaserjs/phaser/tree/master/skills). They're committed in `.agents/skills/`, and `CLAUDE.md` tells Claude to read them. These commands also link them into `.claude/skills/` (git-ignored) so Claude Code loads them automatically.

### 3. Point the dev hostname at your machine

Local development uses a custom hostname - `www.multiversekiln-dev.com`. The rest of this README assumes it. The `.env.example` files and the certificate step below use it too.

Add this line to your hosts file so the hostname resolves to your own machine:

```
127.0.0.1 www.multiversekiln-dev.com
```

- **Windows:** the file is `C:\Windows\System32\drivers\etc\hosts`. Editing it needs administrator rights: run Notepad as administrator, then open the file (choose "All Files" in the open dialog, since it has no extension).
- **macOS / Linux:** run `sudo nano /etc/hosts`.

Check it with `ping www.multiversekiln-dev.com`, which should reply from `127.0.0.1`. Without this entry, the browser looks the name up on the internet instead of reaching your dev server.

### 4. Create your environment files

Each package that needs configuration has a committed `.env.example`. Copy it to `.env` and adjust:

```bash
cp .env.example .env
cp client/.env.example client/.env
cp server/.env.example server/.env
```

The root `.env` holds the local database passwords (used by `docker-compose.yml`). Replace each `replace-me` with a generated password:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Then put the same passwords into the connection strings in `server/.env`: `KILN_APP_PASSWORD` goes in `DATABASE_URL`, and `KILN_MIGRATOR_PASSWORD` in `MIGRATION_DATABASE_URL`. Hex passwords don't need escaping in a URL. Generate the two storage keys the same way, and put the same pair in both `.env` and `server/.env`.

| Variable | File | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | `.env` | Password for the local Postgres superuser. Only the container's setup script uses it. |
| `KILN_MIGRATOR_PASSWORD` | `.env` | Password for `kiln_migrator`, the role migrations run as. |
| `KILN_APP_PASSWORD` | `.env` | Password for `kiln_app`, the role the game server runs as. |
| `POSTGRES_PORT` | `.env` | Host port for Postgres, bound to `127.0.0.1` only (default `5432`). |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | `.env` | Keys for the local object storage's S3 API, which refuses requests without them. The same pair goes in `server/.env`. |
| `STORAGE_PORT` | `.env` | Host port for the local storage's S3 API, bound to `127.0.0.1` only (default `8333`). |
| `MAILPIT_SMTP_PORT`, `MAILPIT_WEB_PORT` | `.env` | Host ports for Mailpit, which catches the server's emails, bound to `127.0.0.1` only: SMTP (default `1025`) and its web inbox (default `8025`). |
| `DEV_HOST` | `client/.env` | Hostname for the Vite dev server: `www.multiversekiln-dev.com` (must be in your hosts file; see step 3). |
| `DEV_PORT` | `client/.env` | Port for the Vite dev server (default `5173`). |
| `VITE_SERVER_URL` | `client/.env` | WebSocket URL of the Colyseus server: `wss://www.multiversekiln-dev.com:2567`. Use the same hostname as `DEV_HOST` so it matches the certificate. |
| `VITE_SOURCE_URL` | `client/.env` | Where players can get the game engine's source code, linked from the page footer (required). The AGPL requires offering the source to players of a modified version, so a fork sets its own repository. |
| `PORT` | `server/.env` | Port the Colyseus server listens on (default `2567`). |
| `ENABLE_DEV_TOOLS` | `server/.env` | Set to `true` to enable `/monitor`, the playground, and the bot login the load test uses (`POST /dev/bot-login`, which makes an account without email and logs it in). Off when unset, and always off when `NODE_ENV=production`. Never set it in production. |
| `SSL_KEY_FILE`, `SSL_CERT_FILE` | `server/.env` | Certificate for HTTPS/WSS (required). The example values point at `certs/` (see step 5). Leave unset on Colyseus Cloud, which handles TLS itself. |
| `ALLOWED_ORIGINS` | `server/.env` | Comma-separated origins allowed to use the server from a browser (CORS and WebSocket connections). Required. Locally: the client and the server itself (for the playground). |
| `DATABASE_URL` | `server/.env` | Postgres connection string for the game server, as `kiln_app`. In production: Neon's pooled connection string. |
| `MIGRATION_DATABASE_URL` | `server/.env` | Postgres connection string for `npm run db:migrate -w server`, as `kiln_migrator`. Never give it to the running server. |
| `TEST_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL` | `server/.env` | The same two connection strings for the `kiln_test` database that `npm test` uses. The tests empty it before every test, so they refuse to run against a database whose name doesn't end in `_test`. |
| `LOADTEST_ENDPOINT` | `server/.env` | Server URL that `npm run loadtest -w server` connects to: `wss://www.multiversekiln-dev.com:2567`. |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE` | `server/.env` | Object storage for uploads such as tilesets: any S3-compatible service. Locally the storage container (`http://127.0.0.1:8333`, path-style, the keys from `.env`); in production Cloudflare R2, AWS S3, Backblaze B2 or similar, with a bucket made in its own tools. |
| `TEST_STORAGE_BUCKET` | `server/.env` | The bucket `npm test` uploads to, on the same storage (`kiln-test`). The tests create it if it doesn't exist. |
| `AUTH_HMAC_KEY` | `server/.env` | Secret key for the keyed hashes stored in place of email addresses waiting on a code, the codes themselves, recovery codes and networks: at least 32 random bytes in base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Use a different key in each environment. |
| `TOTP_ENCRYPTION_KEY` | `server/.env` | Secret key that encrypts the authenticator app secrets of accounts with two-factor authentication: exactly 32 random bytes in base64, made the same way. Keep it outside the database and its backups, and keep it as long as the database: changing it leaves every stored secret unreadable. |
| `SMTP_URL`, `EMAIL_FROM` | `server/.env` | Where the server sends email, and the address it comes from. Locally Mailpit (`smtp://127.0.0.1:1025`); in production a real SMTP service, over TLS (`smtps://user:password@host:465`). |
| `SITE_URL` | `server/.env` | The client's address, `https://` with nothing after the host and port: `https://www.multiversekiln-dev.com:5173` locally. Required: emails link to its pages, and Google and Discord send players back to `<SITE_URL>/login`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | `server/.env` | Logging in with Google and Discord, each offered once both its values are set. Make a Google OAuth client (web application) at https://console.cloud.google.com/apis/credentials and a Discord application at https://discord.com/developers/applications, each with `<SITE_URL>/login` as a redirect URI. Leave them empty to offer only email logins. |
| `DEV_SSL_KEY_FILE`, `DEV_SSL_CERT_FILE` | `client/.env` | Local certificate for the HTTPS dev server (required). The example values point at `certs/` (see step 5). |

`.env` files are git-ignored. Never commit them; when you add a variable, add it to the matching `.env.example` too.

### 5. Create a local HTTPS certificate

Local development always runs over HTTPS and WSS, matching production. Certificates come from [mkcert](https://github.com/FiloSottile/mkcert), which creates a local certificate authority your browser trusts, so there are no certificate warnings.

1. Install mkcert and trust its local CA. This is one time per machine, and Windows shows a security prompt to confirm:

	```bash
	winget install FiloSottile.mkcert
	```

	Open a new terminal after installing so `mkcert` is on your `PATH`.

2. From the repository root, create a certificate covering the dev hostname and localhost:

	```bash
	mkcert -install
	mkdir certs
	mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem www.multiversekiln-dev.com localhost 127.0.0.1
	```

	`certs/` and `*.pem` are git-ignored. Every developer generates their own.

The `.env.example` files already point at these paths, so no further configuration is needed. If you change `DEV_HOST`, regenerate the certificate with the new hostname.

Neither the Vite dev server nor the Colyseus server will start without the certificate. The server never falls back to plain HTTP, with two exceptions:

- **Colyseus Cloud:** the server listens on a local socket behind Cloud's proxy, which serves HTTPS to players.
- **Tests:** the test harness only connects over plain `ws://`, so `server/test/setup.ts` sets `NODE_ENV=test` and clears the certificate settings.

### 6. Start the database

With Docker Desktop running, from the repository root:

```bash
docker compose up -d                 # start Postgres, the object storage and Mailpit in the background
npm run storage:setup -w server      # create the storage bucket, if it doesn't exist yet
npm run db:migrate -w server         # create or update the tables
npm run db:seed -w server            # add the sample universe
```

The object storage is [SeaweedFS](https://github.com/seaweedfs/seaweedfs), which speaks the S3 API, and keeps uploaded files such as tilesets in a Docker volume. `start.bat` starts it and creates the bucket too. It only answers on `127.0.0.1:8333`, over plain HTTP like Postgres, and only to requests signed with the keys in `.env`.

[Mailpit](https://mailpit.axllent.org/) catches every email the server sends, such as login codes, so none reaches a real inbox. Read them in its web inbox at http://127.0.0.1:8025.

The seed script (`server/scripts/seed.ts`) adds Kilnhaven, a sample universe drawn in `server/scripts/sampleUniverse.ts`: a town square lobby with a cottage and cellar to walk into, and a crossroads for groups to start in. Running it again replaces Kilnhaven and leaves everything else alone, so run it after changing the sample maps. It refuses to run with `NODE_ENV=production`.

Nobody can open Kilnhaven in the world editor unless you name its creator: `npm run db:seed -w server -- --creator your_username` makes the account with that username its creator. Register the account first; the script won't create one. Replacing Kilnhaven also removes its editors, so pass `--creator` every time you seed.

Postgres listens on `127.0.0.1:5432` (only reachable from your machine) and keeps its data in a Docker volume, so it survives restarts. It keeps running in the background until you run `docker compose stop`.

The first start runs the scripts in `docker/postgres/init/`, which create two roles and two databases: `kiln` for the game, and `kiln_test` for the test suite.

| Role | Used by | Can |
|---|---|---|
| `kiln_migrator` | `npm run db:migrate -w server` (`MIGRATION_DATABASE_URL`) | Create, alter and drop tables (it owns them) |
| `kiln_app` | The game server (`DATABASE_URL`) | Read and write rows, but not change tables |

`npm test` rebuilds `kiln_test` from the migrations at the start of every run and empties it before every test (keeping the rows migrations insert, such as default tiles), so it never needs migrating by hand.

The setup scripts and the passwords in `.env` only take effect when the data volume is first created. A volume created before `kiln_test` existed can add it without losing data:

```bash
docker compose exec postgres sh /docker-entrypoint-initdb.d/02-databases.sh
```

In Git Bash, put `MSYS_NO_PATHCONV=1` before that command, or it rewrites the container path into a Windows one.

To change a password or start over with an empty database, delete the volume (this deletes all local data) and migrate again:

```bash
docker compose down -v
docker compose up -d
npm run db:migrate -w server
npm run db:seed -w server
```

### 7. Run it

From the repository root:

```bash
npm run dev
```

On Windows you can also double-click `start.bat` (or run `.\start.bat`). It starts Docker Desktop if it isn't running, runs `npm install` (a quick no-op when nothing changed), starts Postgres with `docker compose up -d` and waits until it's ready, then runs `npm run dev`.

This builds `shared` once, then runs three processes in one terminal with colored prefixes:

| Process | What it does | URL |
|---|---|---|
| `shared` | Recompiles `shared` on change | - |
| `server` | Colyseus server with auto-restart (`tsx watch`) | `https://www.multiversekiln-dev.com:2567` (playground), `/monitor` (both need `ENABLE_DEV_TOOLS=true`) |
| `client` | Vite dev server with hot reload | `https://www.multiversekiln-dev.com:5173` |

Open the game at `https://www.multiversekiln-dev.com:5173`. The server's output includes a line from Colyseus saying `Listening on http://localhost:2567`. Ignore it: Colyseus prints `http://`, and this server only accepts HTTPS. The line just before it (`HTTPS/WSS: open https://...`) gives the real address.

Press `Ctrl+C` to stop all three. If any one exits, the others are stopped too.

Type a name to log in, then pick a universe on Home (Kilnhaven, after seeding) and press **Enter Universe** to walk around its lobby. Press **Create game** to start a group and **Share** to copy a join link for other players; the group starts in the universe's starting area. Move with the arrow keys or WASD, and press **E** to go through a doorway that offers to take you somewhere (such as Kilnhaven's cottage trapdoor). Click the map to move again after typing in the chat. Your player is green; other players are blue.

Until there are real logins, a name is the whole login: typing a name you've used before (in any capitals) logs you in as that player again, from any browser, and a new name creates a new player. A player can only be logged in from one browser at a time.

Every tab of one browser is the same player, and closing the last one logs it out, so saving a client file (which makes Vite reload every tab) logs you out. To test with several players, use separate browsers or browser profiles (a private window counts as its own browser), each with its own name.

### 8. Verify

```bash
npm run typecheck    # type-checks shared, server, and client
npm test             # runs the server test suite
npm run lint         # lints everything
```

`npm install` also sets up a Git pre-commit hook (see [Linting](#linting) and [Secret scanning](#secret-scanning)). The hook needs gitleaks from step 1; check it's on your `PATH` with `gitleaks version`.

## Common commands

All commands run from the repository root.

| Command | Purpose |
|---|---|
| `npm run dev` | Run shared watcher, server, and client together |
| `npm run build` | Production build of all three packages |
| `npm run typecheck` | Type-check everything |
| `npm test` | Run server tests (mocha) |
| `npm run lint` | Lint everything |
| `npm run lint:fix` | Lint everything and fix what can be fixed automatically |
| `docker compose up -d` / `docker compose stop` | Start / stop the local Postgres |
| `npm run db:generate -w server` | Create a migration from changes to `server/src/db/schema.ts` |
| `npm run db:migrate -w server` | Apply pending migrations (as `MIGRATION_DATABASE_URL`) |
| `npm run db:seed -w server` | Add or replace the sample universe (as `DATABASE_URL`); add `-- --creator <username>` to make that account its creator |
| `npm run loadtest -w server` | Connect simulated clients to a running server (`LOADTEST_ENDPOINT`), each logging in as a new bot account, which needs `ENABLE_DEV_TOOLS=true` |
| `npm run <script> -w <package>` | Run one package's script, e.g. `npm run dev -w server` |
| `npm install <pkg> -w <package>` | Add a dependency to one package, e.g. `npm install drizzle-orm -w server` |
| `npm install -D <pkg> -w <package>` | Add a dev dependency to one package |

Add dependencies with `-w` from the root rather than `cd`-ing into a package, so the root lockfile stays the only lockfile. Tools used by the whole repo (like `typescript` and `concurrently`) live in the root `package.json`.

After pulling changes that touch any `package.json`, run `npm install` (or just use `start.bat`, which always installs first). `npm run dev` on its own does not install.

## Linting

ESLint checks the TypeScript for bugs, project rules and code style. The configuration is `eslint.config.js` at the root.

It runs automatically in two places:

- **When you commit.** A Git pre-commit hook ([husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged)) lints the files being committed, fixes what it can (such as quotes and brace placement) and adds those fixes to the commit. If errors remain, the commit is blocked and the errors are listed. The hook is set up by `npm install`.
- **While you edit.** The ESLint extension for VS Code (see [Recommended extensions](#recommended-extensions)) underlines problems as you type.

You can also run it yourself with `npm run lint` or `npm run lint:fix`.
 
What it checks:

- **Code style:** Allman braces, single quotes, `===`, tabs, braces on every `if`/`else`/loop.
	- Parentheses around return values and ternaries aren't checked, because no lint rule exists for them.
- **Bugs:** promises that are never awaited or handled (errors from them disappear silently), unused variables and imports.
- **Project rules:** no `any`. `server/src/logic/` can't import Colyseus, the database, or I/O and network modules (game rules must be pure functions), and `server/src/rooms/` can't import the database client directly (use the repository modules).

`server/src/index.ts` and `server/ecosystem.config.cjs` are excluded, because they're Colyseus Cloud files left as Colyseus generated them.

## Secret scanning

Before linting, the pre-commit hook runs [gitleaks](https://github.com/gitleaks/gitleaks) on the staged changes. If it finds something that looks like a secret (an API key, private key, token or password in a connection string), the commit is blocked. The secret itself is redacted from the output, but the file, line and rule are listed.

- **Real secret:** unstage it, move the value into a git-ignored `.env` file, and read it from an environment variable. If the secret was ever committed or pushed, rotate it as well.
- **False positive:** add a `gitleaks:allow` comment on the line, or add an allowlist entry in a `.gitleaks.toml` at the repository root.

If gitleaks isn't installed, the hook blocks the commit and says so. To scan the working tree yourself, run `gitleaks dir . --redact`. That scan includes git-ignored files, so it reports the local mkcert key in `certs/`, which is expected.

## Dependency updates

[Dependabot](https://docs.github.com/en/code-security/dependabot) opens pull requests for npm dependency updates every Monday, configured in `.github/dependabot.yml`. One configuration covers all three workspaces, since they share the root lockfile.

- `colyseus` and the `@colyseus/*` packages are updated together in one PR, because their versions must match.
- Other minor and patch updates are bundled into one PR for production dependencies and one for dev dependencies. Major updates get a PR each, since they may need code changes.
- New releases wait 7 days before Dependabot proposes them, so a broken or compromised publish is likely caught first. Security updates skip this wait.

Before merging, check out the branch, run `npm install`, and make sure `npm run typecheck`, `npm test` and `npm run lint` pass. For a Colyseus update, check the release notes, since its APIs change between versions.

## Working in VS Code

### Open the repository root

Open the **root folder** (`File > Open Folder...` -> `multiverse-kiln`), not `client` or `server` on their own, and not a multi-root workspace.

Each package has its own `tsconfig.json`, and VS Code uses the nearest one to each file, so client files get browser/DOM types and Vite module resolution, while server files get Node types and decorators. Opening the root gives you all three packages, the shared `node_modules`, and the root scripts in one window.

### Use the workspace TypeScript version

The repo pins TypeScript in the root `package.json`. To make the editor use the same version as the build:

1. Open any `.ts` file.
2. Run **TypeScript: Select TypeScript Version** from the Command Palette (`Ctrl+Shift+P`).
3. Choose **Use Workspace Version**.

### Build `shared` before you start editing

Client and server import `@multiverse-kiln/shared` from its compiled output in `shared/dist`. On a fresh clone that folder doesn't exist, so imports from `shared` show as errors until it is built. Either start `npm run dev` or run:

```bash
npm run build -w shared
```

While `npm run dev` is running, `shared` is rebuilt on every save. If the editor still shows stale types for something you just changed in `shared`, run **TypeScript: Restart TS Server** from the Command Palette.

### Running the app from VS Code

- Open the integrated terminal (`` Ctrl+` ``) and run `npm run dev` (or `.\start.bat` in PowerShell).
- Or use the **NPM Scripts** view in the Explorer sidebar (enable it via the `...` menu if hidden). It lists the scripts of every workspace package.

### Editor settings

The repo uses **tabs** for indentation and **CRLF** line endings. `.editorconfig` at the root sets these (plus UTF-8, a final newline, and the exceptions for shell scripts and YAML), and `.gitattributes` enforces the line endings in Git. VS Code applies `.editorconfig` once the EditorConfig extension below is installed, so no personal settings are needed.

`.vscode/` is git-ignored except for `extensions.json`, so personal editor settings stay local.

### Recommended extensions

`.vscode/extensions.json` lists the recommended extensions, and VS Code offers to install them when you first open the repo. You can also find them under **Extensions** -> **Recommended**.

- **ESLint**: shows lint problems as you type (see [Linting](#linting)).
- **EditorConfig**: applies `.editorconfig` (tabs, CRLF, final newline).
- **Container Tools** (Microsoft): manage the local Postgres container once it exists.

## License

Copyright (C) 2026 Kriona Hagen.

- **Code:** the source code is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). You can use, modify and share it, but if you distribute a modified version, or run one on a server that players connect to, you must publish your changes under the same license.
- **Art and other assets:** all rights reserved. Images, audio, fonts, and the game's characters, setting and story are not covered by the AGPL and may not be reused without permission. See [LICENSE-ASSETS.md](LICENSE-ASSETS.md).

Put game assets in `client/public/assets/`, which is the folder `LICENSE-ASSETS.md` covers. Credit any third-party asset, with its license, in a `CREDITS.md` file in the same folder.

Dependencies keep their own licenses (Colyseus, Phaser and Express are MIT), as do the agent skills in `.agents/skills/` (see `.agents/skills/THIRD-PARTY-NOTICES.md`).
