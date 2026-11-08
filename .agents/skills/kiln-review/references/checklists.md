# Checklists

One per pass. These are starting points: read the area for anything else that is wrong. Grade each finding with the severities in `SKILL.md`, and check the findings already open (the workflow lists them) so none is reported twice.

Before reviewing, read `CLAUDE.md`, and the parts of `STRUCTURE-OVERVIEW.md` that describe the code under review. For the bugs pass in `server/src/rooms/` or client code that uses Phaser, read the `colyseus` skill (`.agents/skills/colyseus/SKILL.md`, and the matching file in its `references/`) or the Phaser skills (`.agents/skills/<area>/SKILL.md`, and `v3-to-v4-migration` when unsure an API still exists) first. Recall of both libraries is usually out of date.

## Bugs (B)

- Colyseus 0.18 and `@colyseus/schema` 5 API misuse, and Phaser 4 API misuse.
- Game state changed anywhere but the server, or the client deciding an outcome (architecture rules 1 and 6).
- Phaser physics used for gameplay.
- An editor control that changes the universe without going through Save (Unsaved changes in `STRUCTURE-OVERVIEW.md`).
- A form or dialog without a `ChangeTracker`, or work not yet saved that doesn't use `watchUnsavedWork()`.
- Races between rooms, sessions and saves: a player leaving mid-save, two editors saving at once, a room disposed while loading, a session ended while its windows are connected.
- Errors that are swallowed, or that leave state half changed outside a transaction.
- Edge cases in what changed: empty lists, the first and last item, a deleted thing still referred to, limits reached exactly.
- A change whose tests don't cover the case it was made for.

## Security (S)

- Client messages and request bodies not checked at the boundary (zod schemas in routes, message validation in rooms).
- Missing universe role checks: a player reaching another universe's data by ID, a role doing what `shared/src/universes.ts` doesn't allow it (`canEditWorld()`, `canManageEditors()` and the rest).
- Session and cookie handling, server admin checks and 2FA (`requireTwoFactor`, admins without 2FA).
- A database role used beyond what it should: anything but `server/src/http/admin.ts` using the admin role, the app role given rights to the audit tables.
- New routes or rooms without the origin check (`refuseWritesFromOtherOrigins()`, `createOriginCheck`), or without coverage in `server/test/http.test.ts`.
- Uploads not checked and re-encoded (`server/src/images/`).
- Text players or creators wrote reaching `innerHTML` or an attribute unescaped.
- Rate limits missing or bypassable, enumeration of accounts or universes (answers or timing that differ for ones that exist).
- Secrets or internal details in responses or logs: tokens, hashes, email addresses of other players, stack traces, SQL.

## Performance (P)

- The database touched in the tick, directly or through anything the tick calls.
- N+1 queries, queries per item inside a lock or transaction, missing indexes (`scratchpad/unindexedForeignKeys.mjs` lists foreign keys without one).
- Synced state that doesn't need syncing, `broadcast()` used for state.
- Work repeated every frame on the client, or redrawing what didn't change.
- Work that grows with the square of its input.
- Blocking the event loop the rooms share: synchronous hashing, parsing or compression of large data.
- Each finding says whether it was measured or suspected. Measured numbers are only for comparing before and after on the same machine, since the dev server and the agents share it.

## Rules (R)

The repository's own conventions, from `CLAUDE.md` and the global code style it adds to:

- English sent from the server instead of a `LocalizedMessage` through `sendError()`.
- Text players read that isn't a message, sentences built by joining pieces, a message that should reuse an existing ID, or a description that doesn't say where the message appears.
- `SITE_NAME` written into a message or page; a tab title not set with `setPageTitle()`.
- Screens or dialogs without keyboard shortcuts (`data-shortcut`, the letter in the English text, never Alt+D, Alt+E or Alt+F, no shortcut for deleting), `announce()` for changes the player didn't make, `reportFieldError()`, or `document.title`.
- Something shown by color alone, or drawn on a canvas without a keyboard way to reach it.
- Icons not from Phosphor or game-icons.net, or new third-party code or assets not credited on `client/license.html`.
- Rooms reaching the database other than through repositories, or outside lifecycle boundaries; game logic in `server/src/logic/` that isn't pure.
- Message types written as string literals instead of the enums in `/shared`.
- A schema change without a migration, a migration without a descriptive name, data every database needs in the seed script instead of a migration.
- Environment variables missing from the `.env.example` files or from `CLAUDE.md`'s Configuration list.
- New functions without docblocks; comments that narrate history instead of describing the code.
- House style that lint doesn't catch: full-word names, Allman braces, `return(value);`, one property per line, American spelling, `->` and `...` rather than their single characters.
- `STRUCTURE-OVERVIEW.md` or `CLAUDE.md` not updated for a design decision the change makes.
