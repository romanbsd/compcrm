# Kaneo integration

How Kaneo's project management is bundled into the CRM: one database, kaneo's own
controllers and web UI served as-is, one session, and the agent calling kaneo's
controller functions directly.

Read `vendor/FORK-DELTA.md` for the fork changes that make this work, and
`docs/api.md` for the CRM's own rules. The strategy decision is in
`adrs/kaneo.md`.

## The kaneo source

Kaneo lives at `vendor/kaneo` as a git submodule pointing at the
`crm-integration` branch of the `romanbsd/kaneo` fork. The CRM-specific
deltas (column names, renames, cookie prefix, migration gate) are committed
in that branch, not copied into this repository. Updating kaneo means
rebasing the fork branch on upstream and bumping the submodule pointer — see
`vendor/FORK-DELTA.md`.

A fresh checkout must initialize the submodule and install kaneo's
dependencies before `dev:kaneo` runs:

```sh
git submodule update --init vendor/kaneo
cd vendor/kaneo && bun install
```

## The one database

Kaneo and the CRM share one Postgres schema, owned by Prisma in
`packages/db/prisma/schema.prisma`. Prisma runs every migration; kaneo's own
migrator is disabled (`KANEO_SKIP_DRIZZLE_MIGRATIONS`, fork delta).

- The 32 kaneo tables are generated from the abstract model in
  `packages/kaneo-domain` (`bun run generate:prisma` regenerates
  `kaneo.prisma`, appended into `schema.prisma`). The Drizzle binding and the
  parity test in that package prove the generated schema matches what kaneo's
  code expects.
- **Kaneo tables keep snake_case physical columns** (`project_id`, `created_at`),
  matching kaneo's Drizzle schema. The Prisma fragment emits a column `@map`
  for each.
- **The shared auth tables keep the CRM's camelCase physical columns**
  (`emailVerified`, `createdAt`). Kaneo's `schema.ts` is patched to read those
  names, so both ORMs see the same rows.
- Two physical renames avoid collisions with the CRM's live tables:
  `activity` → `task_activity`, `invitation` → `workspace_invitation`.
- Migrations: `kaneo_domain` (the 32 tables), `kaneo_auth_columns` (kaneo's
  nullable user/session columns), `kaneo_comment_user_nullable` (agent-authored
  comments without a user).

## The mount

`bun run dev:kaneo` serves the whole stack:

1. Builds the `@kaneo/*` workspace packages if their `dist` is missing.
2. Boots kaneo's own Hono API (`vendor/kaneo/apps/api`) against the shared
   database, with the migration gate on.
3. Serves kaneo's built web SPA (`vendor/kaneo/apps/web/dist`) at root,
   proxies `/api/*` to the API, and bridges `/ws` websockets.

`tools/kaneo-dev.ts` is the dev server. Production hosting is not wired yet:
kaneo's websockets and scheduler need a long-lived process, so Vercel serverless
cannot host the API; the API runs as its own service.

## Authentication

One session cookie, one identity.

- Both apps run Better Auth over the same `user`/`session`/`account`/
  `verification` tables and the same secret (`BETTER_AUTH_SECRET` mapped to
  kaneo's `AUTH_SECRET`).
- Kaneo's Better Auth uses `cookiePrefix: "crm"` (fork delta), so
  `crm.session_token` is valid at both apps. Both use the same cookie cache
  format.
- The CRM owns sign-in. Its `ensureWorkspaceMembership` hook (packages/auth)
  also mirrors the single workspace and each signing-in user into kaneo's
  `workspace`/`workspace_member` tables, mapping CRM roles onto kaneo's
  (`owner`/`admin` → `admin`, `member` → `member`). The sync degrades
  independently: a kaneo-table failure never blocks sign-in.
- Kaneo's boot seeds its default `workspace_role` rows (viewer/member/admin)
  against the shared workspace.

## The agent surface

The eve agent reads projects and tasks through Prisma and writes through
kaneo's own controller functions.

- **Reads (native Prisma, free):** `project_list`, `task_list`, `task_read`
  (`apps/agent/agent/lib/kaneo.ts`). No kaneo runtime needed for reads.
- **Writes (kaneo's controllers, direct):** `task_create`, `task_update`,
  `task_comment` call kaneo's extracted controller functions in-process
  (`apps/agent/agent/lib/kaneo-writes.ts`), with no HTTP, no MCP, no Hono
  context. This reuses kaneo's exact behavior: status validation against the
  project's columns, atomic task numbering, assignable-user checks, and
  comment rows in the activity feed (`task_activity`, type `comment`) that
  kaneo's UI actually renders.
- **The principal:** a dispatched agent has no user, but kaneo's controllers
  require `currentUserId`. The agent acts as the workspace owner (the first
  `owner` member of the workspace). Decide once; this is the whole permission
  model for agent writes.

Why not MCP: kaneo's MCP server is a thin HTTP client over kaneo's REST API,
and it is user-OAuth-scoped. Eve can consume MCP natively, but the agent has no
user principal for dispatched runs, and an HTTP hop adds a runtime dependency
for the same tables. The direct-controller path removes the transport entirely.

## Open decisions

- **Production hosting:** kaneo's API needs a long-lived process (websockets,
  scheduler). Not wired.
- **`/api/auth` co-serving:** both apps serve auth at `/api/auth`; fine on
  separate ports in dev, one must move when co-served under one origin.
- **Inline routes:** a minority of kaneo's routes are inline Hono handlers, not
  extracted controllers; those stay HTTP-only.
- **Activity events:** kaneo's controllers publish events; the agent process
  registers no event listeners, so event-driven side effects (notifications)
  do not fire for agent writes.