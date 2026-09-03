# Bundle Kaneo through an ORM-agnostic domain model

## What we want to change

Bring project management into the CRM as one domain, not two. Kaneo and the CRM are
both Postgres and both better-auth. We want one physical schema, one migration stream,
and the eve agent reading and writing project data through the same `@crm/db` client it
already uses for contacts, companies and deals.

## Why the current situation is a problem

- Running Kaneo with its own database means two copies of `project` and `task`, and a
  sync bus between them that will be debugged forever.
- Pointing Kaneo's Drizzle schema at our Prisma-owned tables by hand-patching a vendored
  `schema.ts` works once and drifts forever. Every upstream release conflicts with the
  patch.
- Two better-auth plugins over one `user` table creates two membership models that
  silently diverge.

## What we will do instead

- **Fork and bundle Kaneo** (see `vendor/FORK-DELTA.md`). The fork is the trunk; all
  work lands there first. Generic improvements are donated upstream as pull requests.
- **Extract Kaneo's domain model into an ORM-agnostic definition** — a typed TypeScript
  builder DSL that models tables, columns, constraints and relations at the Postgres
  level, in a `packages/domain`-style package. This is the generic piece and is
  upstream pull request number one.
- **Bind the abstract model on each side.** Kaneo's Drizzle schema is generated from it
  (behavior-identical, held by a golden DDL parity test). The CRM generates a Prisma
  schema fragment from it, committed, merged via `prismaSchemaFolder`. The parity test
  is two scratch databases, one `prisma db push` and one `drizzle-kit` push, `pg_dump`
  both, diff must be empty.
- **Prisma owns all migrations.** Kaneo's own migration runner is disabled in the fork.
- **Identity unifies on the existing better-auth organization plugin.** Kaneo's workspace
  plugin is disabled; the one workspace maps to `WORKSPACE_ID`. One membership model.
- **One writer per aggregate.** `task.number` derives from `project.lastTaskNumber` in a
  single transaction; whichever runtime owns a table owns that counter.

## What it breaks

- Kaneo's upstream code must keep producing identical DDL, or the parity test fails.
- The abstract model adds a codegen step and a boundary rule (no `@crm/*` imports in the
  generic packages).
- Upstream may reject the extraction. That is not a failure: the fork carries it, the
  parity test keeps it honest, and nothing blocks on acceptance.

## Status

Accepted. Vendoring is in place; the extraction is next.