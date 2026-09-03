# Kaneo fork delta

The fork is the trunk. Upstream is a drain. All work lands here first, and generic
improvements are donated upstream as separate pull requests so that upstream merges
shrink this delta instead of growing it. Nothing waits on upstream.

## Source

Kaneo is a git **submodule** at `vendor/kaneo`, pointing at a branch on the fork.
The deltas below live in that branch, not in this repository.

- Fork: https://github.com/romanbsd/kaneo
- Branch: `crm-integration`
- Pinned commit: `b99b332b963f49087247cab29b70d3e03598b2c0`
- Based on upstream: `46539164c68669cec15b1528835c10ad0a66355e`

## Updating the submodule

Rebase the fork branch on upstream main, then bump the pointer here:

```sh
git -C vendor/kaneo fetch origin
git -C vendor/kaneo checkout crm-integration
git -C vendor/kaneo merge origin/main     # resolve deltas, if any
git -C vendor/kaneo push origin crm-integration
git -C vendor/kaneo log --oneline -1
git add vendor/kaneo                     # records the new commit
```

A fresh checkout needs the submodule initialized and kaneo's dependencies
installed before `dev:kaneo` runs:

```sh
git submodule update --init vendor/kaneo
cd vendor/kaneo && bun install
```

## Rules

- `vendor/` is outside the bun workspaces on purpose. The root `turbo.json` and
  `package.json` do not see it, so a broken Kaneo build cannot take down the CRM's.
  When a piece of Kaneo is brought into the CRM build, it is extracted first and wired
  into `packages/*` or `apps/*` on its own.
- Generic packages (the domain model, any binding) never import `@crm/*`, never read a
  constant from the CRM, never assume a single tenant. A change that trips that rule is
  fork-specific and stays here.
- One root `.env`. No per-package `.env`.
- A bundled Kaneo feature is an optional capability: a missing key removes the feature,
  never throws.

## Delta log

A change in this file, with its reason. Generic improvements are tracked as upstream
pull requests; only fork-specific or unmerged changes are listed.

| Change | Reason | Upstream PR |
| --- | --- | --- |
| Removed `apps/web/.env.development` and `.env.production` | One root `.env` rule; per-app env files are placeholders that invite confusion | — |
| Renamed `activity` table to `task_activity` in `apps/api/src/database/schema.ts` | Collides with the CRM's live `activity` timeline table in the one shared schema; the CRM's keeps the name | — |
| Renamed `invitation` table and its indexes to `workspace_invitation*` in `apps/api/src/database/schema.ts` | Collides with the CRM's better-auth org-plugin `invitation` table and its auto-named indexes | — |
| Renamed shared auth table columns (`user`, `session`, `account`, `verification`, `apikey`) to camelCase in `apps/api/src/database/schema.ts` | The CRM owns these tables with camelCase physical names; kaneo's auth reads them | — |
| Gated the startup Drizzle migrations and schema utilities behind `KANEO_SKIP_DRIZZLE_MIGRATIONS` in `apps/api/src/index.ts` | Prisma owns the schema; kaneo's own migrator must not run against the shared database | — |
| Set `advanced.cookiePrefix: "crm"` in `apps/api/src/auth.ts` | Shares the CRM's session cookie; one session token valid at both apps (same secret and session table) | — |