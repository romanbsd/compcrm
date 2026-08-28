# Construction database changes

## Scope and comparison base

This document compares the current construction PR with `origin/master` at `c7fc76ee5074152f691c55a9ce5fb017521fefc4`.

The comparison covers:

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260827210000_gc_os_poc/migration.sql`
- `packages/db/prisma/migrations/20260828203000_remove_unsupported_contact_fields/migration.sql`

The first migration adds the construction data model. The later compatibility migration removes three fields from databases that already applied the first migration. The final schema does not contain those three fields.

The POC has one human role, GC. Secretary and PM are agents. Organization and Member remain inherited access infrastructure, not construction workflow entities.

## Change summary

| Existing model or enum | Construction meaning | Change type |
| --- | --- | --- |
| `DealStage` | Project status | Replaced the inherited status values with the six construction statuses. Existing values are mapped during migration. |
| `AgentRun` | Agent execution | Added an optional Project link, foreign key, and index. |
| `Deal` | Project | Made the customer link physically optional for upstream compatibility, changed its delete action, changed the default status, and added construction fields and relations. |
| `Artifact` | Project file | Added table. |
| `Document` | Estimate or invoice | Added table. |
| `DocumentLineItem` | Estimate or invoice line | Added table. |
| `Activity` | Project or customer history | Existing rows are updated when they contain old Project status values. No Activity field is added. |
| `SavedView` | Saved CRM view | Existing Deal status filters are updated to the new status values. No SavedView field is added. |
| `Contact` | Customer person | `displayName` and `businessName` were temporary migration fields and are removed by the cleanup migration. They are not in the final schema. |
| `DealContact` | Project person link | `isPrimary` and its unique primary index were temporary migration fields and are removed by the cleanup migration. They are not in the final schema. |
| `User` | GC login | No database schema change. The POC uses one User. |
| `Organization` | Inherited access container | No semantic database change. The POC uses one Organization. |
| `Member` | Inherited access membership | No database schema change. The POC uses one Member row with role `owner`. |
| `Company` | Customer | No database schema change. `Company.name` stores the household or business customer name. |
| `XmppAgentTask` | Inherited agent task | No semantic database change. The current schema only aligns field spacing. |

## Modified existing fields and relations

| Model field or relation | `origin/master` | Current schema and migration | Reason |
| --- | --- | --- | --- |
| `Deal.companyId` | Required `String`. | Optional `String?`. The migration drops `NOT NULL`. | The database keeps upstream compatibility for an unassigned row. The construction application still requires a customer when it creates a Project. |
| `Deal.company` | Required relation with `ON DELETE CASCADE`. | Optional relation with `ON DELETE SET NULL`. | Deleting a Company must not delete a Project. |
| `Deal.stage` | Default `DEMO_BOOKED`. | Default `LEAD`. The enum and old stored values are migrated. | `LEAD` is the first construction status. |
| `AgentRun.dealId` | No field or relation. | Optional `String` field with an optional `Deal` relation and `ON DELETE SET NULL`. | An agent execution can carry Project context. |
| `Deal.agentRuns` | No relation field. | `AgentRun[]` relation. | Supports the reverse Project-to-agent lookup. |
| `Deal.artifacts` | No relation field. | `Artifact[]` relation. | Connects Project files to a Project. |
| `Deal.documents` | No relation field. | `Document[]` relation. | Connects estimates and invoices to a Project. |
| `Document.lineItems` | No relation because `Document` did not exist. | `DocumentLineItem[]` relation. | Connects invoice or estimate lines to a Document. |
| `Document.updatedAt` | No field because `Document` did not exist. | Required `DateTime` with Prisma `@updatedAt`. | Tracks changes to a document. |

## Added fields in existing models

The construction migration adds these nullable Project fields to `Deal`:

| Field | Type | Meaning |
| --- | --- | --- |
| `leadSource` | `String?` | Where the opportunity came from. |
| `projectType` | `String?` | Construction work category. |
| `addressLine1` | `String?` | Job-site address line one. |
| `addressLine2` | `String?` | Job-site address line two. |
| `city` | `String?` | Job-site city. |
| `state` | `String?` | Job-site state or region. |
| `postalCode` | `String?` | Job-site postal code. |

The migration also adds `AgentRun.dealId`, described above. It is nullable and has no backfill.

## New tables and all fields

### `Artifact`

| Field | Definition |
| --- | --- |
| `id` | `String`, primary key, CUID default. |
| `dealId` | Required `String`, foreign key to `Deal.id`. |
| `deal` | Required Prisma relation to `Deal`. |
| `type` | Required `String`. |
| `fileName` | Required `String`. |
| `storageKey` | Required `String`. |
| `createdAt` | `DateTime`, current timestamp default. |

### `Document`

| Field | Definition |
| --- | --- |
| `id` | `String`, primary key, CUID default. |
| `dealId` | Required `String`, foreign key to `Deal.id`. |
| `deal` | Required Prisma relation to `Deal`. |
| `type` | Required `String`. |
| `number` | Required `String`. |
| `status` | Required `String`. |
| `currency` | Required `String`, default `USD`. |
| `issuedAt` | Optional `DateTime`. |
| `dueAt` | Optional `DateTime`. |
| `recipientSnapshot` | Required `Json`. |
| `contractorSnapshot` | Required `Json`. |
| `projectSnapshot` | Required `Json`. |
| `subtotal` | Required `Decimal(14,2)`. |
| `tax` | Required `Decimal(14,2)`. |
| `total` | Required `Decimal(14,2)`. |
| `lineItems` | `DocumentLineItem[]` Prisma relation. |
| `createdAt` | `DateTime`, current timestamp default. |
| `updatedAt` | Required `DateTime`, Prisma `@updatedAt`. |

### `DocumentLineItem`

| Field | Definition |
| --- | --- |
| `id` | `String`, primary key, CUID default. |
| `documentId` | Required `String`, foreign key to `Document.id`. |
| `document` | Required Prisma relation to `Document`. |
| `description` | Required `String`. |
| `quantity` | Required `Decimal(14,2)`. |
| `unitPrice` | Required `Decimal(14,2)`. |
| `total` | Required `Decimal(14,2)`. |
| `position` | Required `Int`. |

## Removed or rejected fields

These fields were added by the original construction migration, then rejected and removed by `20260828203000_remove_unsupported_contact_fields`:

| Field | Original migration behavior | Final behavior |
| --- | --- | --- |
| `Contact.displayName` | Added as required `TEXT` with an empty-string default. It was backfilled from `firstName` and `lastName`. | Dropped if present. It is not in the final schema. |
| `Contact.businessName` | Added as optional `TEXT`. | Dropped if present. It is not in the final schema. |
| `DealContact.isPrimary` | Added as required `BOOLEAN` with a default of `false`. | Dropped if present. It is not in the final schema. |

The final contact label is derived from `firstName` and optional `lastName`. `Company.primaryContactId` remains the only persisted primary-contact concept.

## Enum changes

`DealStage` changes from these inherited values:

`DEMO_BOOKED`, `QUALIFIED_TO_BUY`, `UNQUALIFIED_TO_BUY`, `DECISION_MAKER_BOUGHT_IN`, `CONTRACT_SENT`, `CLOSED_WON`, `CLOSED_LOST`

to these construction values:

`LEAD`, `ESTIMATING`, `CONTRACTED`, `IN_PROGRESS`, `COMPLETE`, `LOST`

The migration maps stored values as follows:

| Old value | New value |
| --- | --- |
| `DEMO_BOOKED` | `LEAD` |
| `QUALIFIED_TO_BUY` | `ESTIMATING` |
| `UNQUALIFIED_TO_BUY` | `LOST` |
| `DECISION_MAKER_BOUGHT_IN` | `ESTIMATING` |
| `CONTRACT_SENT` | `CONTRACTED` |
| `CLOSED_WON` | `COMPLETE` |
| `CLOSED_LOST` | `LOST` |

No other enum changes are in the compared schema.

## Indexes, foreign keys, and delete behavior

The migrations make these database changes:

| Object | Change |
| --- | --- |
| `deal_companyId_fkey` | Replaced after `Deal.companyId` becomes nullable. It references `company.id` with `ON DELETE SET NULL` and `ON UPDATE CASCADE`. |
| `agentRun_dealId_createdAt_idx` | Added on `AgentRun(dealId, createdAt)`. |
| `agentRun_dealId_fkey` | Added from `AgentRun.dealId` to `Deal.id` with `ON DELETE SET NULL` and `ON UPDATE CASCADE`. |
| `artifact_dealId_createdAt_idx` | Added on `Artifact(dealId, createdAt)`. |
| `artifact_dealId_fkey` | Added from `Artifact.dealId` to `Deal.id` with `ON DELETE CASCADE` and `ON UPDATE CASCADE`. |
| `document_dealId_createdAt_idx` | Added on `Document(dealId, createdAt)`. |
| `document_dealId_fkey` | Added from `Document.dealId` to `Deal.id` with `ON DELETE CASCADE` and `ON UPDATE CASCADE`. |
| `documentLineItem_documentId_position_idx` | Added on `DocumentLineItem(documentId, position)`. |
| `documentLineItem_documentId_fkey` | Added from `DocumentLineItem.documentId` to `Document.id` with `ON DELETE CASCADE` and `ON UPDATE CASCADE`. |
| `dealContact_one_primary_per_deal_key` | Added temporarily for `DealContact.isPrimary`, then removed by the compatibility migration. It is not in the final schema. |

Existing `DealContact` primary key `(dealId, contactId)` and index on `contactId` remain unchanged.

## Data migration behavior

Both migrations use one transaction.

`20260827210000_gc_os_poc`:

- Replaces the `DealStage` PostgreSQL enum and maps stored `Deal.stage` values.
- Updates old `from` and `to` values in `Activity.meta` for stage-change records.
- Renames stage-change subjects from `Stage changed` to `Status changed`.
- Updates old status values in Deal `SavedView` filters and keeps their order.
- Backfills the temporary `Contact.displayName` from the first and last names. The later cleanup migration removes that temporary column, so it is not retained.
- Adds nullable Project fields and the nullable `AgentRun.dealId` without backfilling them.
- Creates the three new tables. They start empty.

`20260828203000_remove_unsupported_contact_fields`:

- Drops `contact.displayName` if it exists.
- Drops `contact.businessName` if it exists.
- Drops `dealContact.isPrimary` if it exists.
- Makes no other data or schema changes.

## Unchanged construction and access models

### `User`

There is no schema change. The POC has one User record for the GC login. The User remains the owner of customer, contact, and Project records where the existing schema provides those relations.

### `Organization` and `Member`

There is no semantic schema change. They are inherited access infrastructure. The POC has one Organization, one User, and one Member row with role `owner`. They are not construction workflow entities.

### `Company`

There is no schema change. Company remains the customer record. `Company.name` stores the household display name or business customer name. `Company.primaryContactId` remains unique, points to one Contact, and uses `ON DELETE SET NULL`.

No household or business discriminator was added.

### `Contact`

There is no final schema change compared with `origin/master`. Contact represents a homeowner or spouse. The final schema has first and last name fields, but no `displayName` or `businessName`.

### `DealContact`

There is no final schema change compared with `origin/master`. It remains the many-to-many link with required `dealId` and `contactId`, optional `role`, composite primary key `(dealId, contactId)`, and cascading foreign keys. It has no primary-contact flag or primary index.

## Application rule and physical database rule for `Deal.companyId`

The physical database keeps `Deal.companyId` nullable and uses `ON DELETE SET NULL` so upstream data can contain an unassigned Project and deleting a Company does not delete its Projects.

The construction application has the stricter rule. Project creation requires `companyId`, and the construction interface does not provide an unassigned customer path. Therefore, a normal construction Project has one Company customer even though the physical column remains nullable for compatibility.
