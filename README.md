# Multiverse Kiln

An engine for making multiplayer browser-based role-playing games.

See `PLAN.md` for the roadmap and current phase, and `CLAUDE.md` for architecture and coding rules.

## Technology overview

| Area | Technology |
|---|---|
| Client | TypeScript + [Phaser](https://phaser.io/) rendering to a WebGL canvas, served by [Vite](https://vite.dev/) |
| Server | Node.js + TypeScript running [Colyseus](https://docs.colyseus.io/) (rooms, state sync over WebSockets) |
| Shared | A TypeScript package imported by both client and server (message types, payloads, constants) |
| Database | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/): Docker locally, [Neon](https://neon.tech/) in production |
| Hosting | Colyseus Cloud (game server) + Neon (database) |

The server is authoritative: clients send inputs, and the server simulates the game and syncs state back to every client.

## Repository layout

This is an [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) monorepo with three packages:

```
/client     Phaser game (Vite)
/server     Colyseus server
/shared     Code used by both client and server (published locally as @multiverse-kiln/shared)
```

There is a single `node_modules` and `package-lock.json` at the root. `shared` is compiled to `shared/dist`, and client and server import that compiled output.

## Setting up your machine

### 1. Install the tools

- **Node.js 22.22.1 or newer** (LTS recommended). Check with `node -v`. npm comes with it.
- **Git**.
- **gitleaks**, which the pre-commit hook uses to block commits containing secrets (see [Secret scanning](#secret-scanning)). On Windows: `winget install Gitleaks.Gitleaks`; on macOS: `brew install gitleaks`. Open a new terminal (and restart VS Code or your Git client) afterwards so it's on your `PATH`.
- **Docker Desktop**, for the local Postgres database. Not needed yet: the database arrives in Phase 1 of `PLAN.md`, but installing it now saves a step later.
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
cp client/.env.example client/.env
cp server/.env.example server/.env
```

| Variable | File | Purpose |
|---|---|---|
| `DEV_HOST` | `client/.env` | Hostname for the Vite dev server: `www.multiversekiln-dev.com` (must be in your hosts file; see step 3). |
| `DEV_PORT` | `client/.env` | Port for the Vite dev server (default `5173`). |
| `VITE_SERVER_URL` | `client/.env` | WebSocket URL of the Colyseus server: `wss://www.multiversekiln-dev.com:2567`. Use the same hostname as `DEV_HOST` so it matches the certificate. |
| `PORT` | `server/.env` | Port the Colyseus server listens on (default `2567`). |
| `ENABLE_DEV_TOOLS` | `server/.env` | Set to `true` to enable `/monitor` and the playground. Off when unset, and always off when `NODE_ENV=production`. Never set it in production. |
| `SSL_KEY_FILE`, `SSL_CERT_FILE` | `server/.env` | Certificate for HTTPS/WSS (required). The example values point at `certs/` (see step 5). Leave unset on Colyseus Cloud, which handles TLS itself. |
| `ALLOWED_ORIGINS` | `server/.env` | Comma-separated origins allowed to use the server from a browser (CORS and WebSocket connections). Required. Locally: the client and the server itself (for the playground). |
| `LOADTEST_ENDPOINT` | `server/.env` | Server URL that `npm run loadtest -w server` connects to: `wss://www.multiversekiln-dev.com:2567`. |
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

### 6. Run it

From the repository root:

```bash
npm run dev
```

On Windows you can also double-click `start.bat` (or run `.\start.bat`). It runs `npm install` (a quick no-op when nothing changed), then `npm run dev`.

This builds `shared` once, then runs three processes in one terminal with colored prefixes:

| Process | What it does | URL |
|---|---|---|
| `shared` | Recompiles `shared` on change | - |
| `server` | Colyseus server with auto-restart (`tsx watch`) | `https://www.multiversekiln-dev.com:2567` (playground), `/monitor` (both need `ENABLE_DEV_TOOLS=true`) |
| `client` | Vite dev server with hot reload | `https://www.multiversekiln-dev.com:5173` |

Open the game at `https://www.multiversekiln-dev.com:5173`. The server's output includes a line from Colyseus saying `Listening on http://localhost:2567`. Ignore it: Colyseus prints `http://`, and this server only accepts HTTPS. The line just before it (`HTTPS/WSS: open https://...`) gives the real address.

Press `Ctrl+C` to stop all three. If any one exits, the others are stopped too.

To test multiplayer, open the client in two browser tabs.

### 7. Verify

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
| `npm run loadtest -w server` | Connect simulated clients to a running server (`LOADTEST_ENDPOINT`) |
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
- **Project rules:** `any` is a warning. `server/src/logic/` can't import Colyseus, the database, or I/O and network modules (game rules must be pure functions), and `server/src/rooms/` can't import the database client directly (use the repository modules).

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
