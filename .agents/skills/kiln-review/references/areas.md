# Areas

Each changed file belongs to one area, and each area is reviewed by the passes in its row. The workflow (`.claude/workflows/review-passes.js`, `AREA_PASSES`) holds the same table: change both together.

| Area | Paths | Passes |
|---|---|---|
| rooms | `server/src/rooms/`, `server/src/players/`, `server/src/world/` | all |
| http | `server/src/http/` (the editor's save path included) | all |
| auth | `server/src/auth/`, `server/src/email/` | bugs, security, rules |
| db | `server/src/db/`, `server/drizzle/` | bugs, security, performance |
| uploads | `server/src/storage/`, `server/src/images/` | bugs, security, performance |
| logic | `server/src/logic/`, `shared/src/` (rulesets included) | bugs, performance, rules |
| client | `client/` | all |
| other | anything below that serves no area | bugs |

## Files outside those paths

Files outside the table's paths go to the area of the code they serve:

| Files | Area |
|---|---|
| `server/test/db/` | db |
| `server/test/logic/`, `server/test/shared/` | logic |
| `server/test/*Room.test.ts`, `server/test/areaCache.test.ts`, `server/test/joinChanges.test.ts` and other tests of rooms | rooms |
| `server/test/auth/`, `server/test/email/`, `server/test/auth*.test.ts`, `server/test/twoFactor*.test.ts`, `server/test/providerAuth.test.ts` | auth |
| `server/test/editor*.test.ts`, `server/test/http.test.ts` and other tests of routes | http |
| `server/src/app.config.ts`, `server/src/transport.ts`, `server/src/siteUrl.ts`, `server/src/devTools.ts` | http |
| `shared/locales/`, `shared/scripts/` | logic (the rules pass checks the messages) |
| `docker/postgres/`, the cleanup jobs (`server/src/authSweep.ts`, `server/src/characterSweep.ts`, `server/src/universeEditSweep.ts`) | db |
| `server/scripts/`, `server/loadtest/`, root and package config (`package.json`, `eslint.config.js`, `tsconfig*.json`, `docker-compose.yml`, `.env.example` files) | other |

A test belongs with the code it tests: when it's unclear from the name, read its imports.

## Not reviewed

- Markdown files (`*.md`), `.agents/`, `.claude/` and `scratchpad/`.
- Generated files: `server/drizzle/meta/`, `package-lock.json`, `shared/locales/en.json` (the extractor writes it; the rules pass still reads it to look for messages to reuse).
- Binary files (images, fonts, sounds).

Reviewers still read any of these when they explain the code they review, such as `STRUCTURE-OVERVIEW.md` for a design decision.
