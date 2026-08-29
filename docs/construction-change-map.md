# Construction change map

## Comparison metadata

This document is the change map for PR #2. It compares the current branch with
the fetched `origin/master` base. The comparison is `origin/master...HEAD`.

| Item | Value |
| --- | --- |
| Base branch | `origin/master` |
| Base SHA | `c7fc76ee5074152f691c55a9ce5fb017521fefc4` |
| Reviewed implementation head SHA | `020f36c71065f7dc360f3e2cba3fd84cd8d57bf0` |
| Refresh date | 2026-08-28 |

This SHA is the implementation state audited by the map. The following
documentation-only map correction is intentionally excluded, so the branch
head can differ without changing the mapped implementation behavior.

The map records intentional product, API, agent, database, and necessary
application type or invariant changes. It does not claim a construction web
UI redesign. Physical model and API names stay in the text where they are
useful for implementation. Construction meanings apply to the headless agent
interface.

## Construction vocabulary and boundary

| Existing name | Construction meaning | Boundary |
| --- | --- | --- |
| `Deal` | Project | The physical table and API identifiers remain `Deal` and `deal`. Agent-facing construction language calls this a Project. The web UI retains Deal. |
| `DealStage` and `stage` | Project status | The physical enum and API field remain `DealStage` and `stage`. Agent-facing construction language calls the value a status. The web UI retains Stage. |
| `Company` | Customer | One Company stores either a household customer name or a business customer name. Agent-facing construction language calls this a Customer. The web UI retains Company. |
| `DealContact` | Project contact | The link connects a Contact to a Project and stores one optional `role`. |
| `Activity` with a deal link | Project history | Existing physical fields remain. Stage-change records use the new status values. |
| `Artifact` | Project file | Stores a file reference for a Project. |
| `Document` | Estimate or invoice | Stores financial document data and required snapshot fields. |
| `DocumentLineItem` | Estimate or invoice line | Stores one line in a Document. |

The POC has one human role, GC. Secretary and PM are agents. `User`,
`Organization`, and `Member` are inherited access infrastructure, not
construction workflow entities. The POC uses one User, one Organization, and
one Member row with role `owner`.

## Change summary

| Existing model or product surface | Construction meaning | Change type |
| --- | --- | --- |
| `DealStage` | Project status | Replaced the inherited values and changed the default to `LEAD`. Stored values are mapped in the migration. |
| `AgentRun` | Agent execution | Added an optional Project link and index. |
| `Deal` | Project | Made the physical customer link optional, changed its delete action, added seven Project fields, changed the status default, and added file, document, and agent relations. |
| `Artifact` | Project file | New table. |
| `Document` | Estimate or invoice | New table. |
| `DocumentLineItem` | Estimate or invoice line | New table. |
| `Activity` | Project or customer history | Existing status metadata and status-change subjects are migrated. |
| `SavedView` | Saved Project view | Existing Deal stage filters are migrated to the new values. |
| `Company` | Customer | No final schema change. Purge behavior now protects customers that have Projects. |
| `Contact` | Homeowner or spouse | No final schema change. Contact labels are calculated from name parts. |
| `DealContact` | Project contact | No final schema change. The final link has only `dealId`, `contactId`, and optional `role`. |
| Web UI and landing copy | Upstream interface | Restored to upstream wording and controls. Only the necessary `apps/app` enum, response-type, invariant, and test differences remain. |

## Database changes

The full database field and migration inventory is in
[construction-database-changes.md](construction-database-changes.md). This
section is the complete summary for this map.

### Modified existing fields and relations

| Model field or relation | `origin/master` | Current final schema or behavior |
| --- | --- | --- |
| `Deal.companyId` | Required `String`. | Optional `String?`. The database permits an unassigned row for upstream compatibility. The construction API still requires a customer for Project creation. |
| `Deal.company` | Required relation with `ON DELETE CASCADE`. | Optional relation with `ON DELETE SET NULL`. Deleting a Company does not delete its Projects. |
| `Deal.stage` | Default `DEMO_BOOKED`. | Default `LEAD`. The enum is replaced and stored values are migrated. |
| `AgentRun.dealId` | No field or relation. | Optional `String` with an optional `Deal` relation, `ON DELETE SET NULL`, and an index on `(dealId, createdAt)`. |
| `Deal.agentRuns` | No reverse relation. | `AgentRun[]` reverse relation. |
| `Deal.artifacts` | No reverse relation. | `Artifact[]` reverse relation. |
| `Deal.documents` | No reverse relation. | `Document[]` reverse relation. |
| `Document.lineItems` | No Document model. | `DocumentLineItem[]` reverse relation. |
| `Document.updatedAt` | No Document model. | Required `DateTime` with Prisma `@updatedAt`. |

### Added fields on existing models

The migration adds these nullable fields to the physical `deal` table. They
are Project fields in the product.

| Field | Type | Construction meaning |
| --- | --- | --- |
| `leadSource` | `String?` | Source of the lead. |
| `projectType` | `String?` | Type of construction work. |
| `addressLine1` | `String?` | Job-site street address. |
| `addressLine2` | `String?` | Job-site unit or second address line. |
| `city` | `String?` | Job-site city. |
| `state` | `String?` | Job-site state or region. |
| `postalCode` | `String?` | Job-site postal code. |

`AgentRun.dealId` is also added as an optional field. It has no data backfill.

### New tables and all final fields

#### `Artifact`

| Field | Definition |
| --- | --- |
| `id` | Required `String`, CUID primary key. |
| `dealId` | Required `String`, foreign key to `Deal.id`. |
| `deal` | Required Prisma relation to `Deal`. |
| `type` | Required `String`. |
| `fileName` | Required `String`. |
| `storageKey` | Required `String`. |
| `createdAt` | `DateTime` with current timestamp default. |

#### `Document`

| Field | Definition |
| --- | --- |
| `id` | Required `String`, CUID primary key. |
| `dealId` | Required `String`, foreign key to `Deal.id`. |
| `deal` | Required Prisma relation to `Deal`. |
| `type` | Required `String`. |
| `number` | Required `String`. |
| `status` | Required `String`. |
| `currency` | Required `String`, default `USD`. |
| `issuedAt` | Optional `DateTime`. |
| `dueAt` | Optional `DateTime`. |
| `recipientSnapshot` | Required `Json` recipient snapshot data. |
| `contractorSnapshot` | Required `Json` contractor snapshot data. |
| `projectSnapshot` | Required `Json` Project snapshot data. |
| `subtotal` | Required `Decimal(14,2)`. |
| `tax` | Required `Decimal(14,2)`. |
| `total` | Required `Decimal(14,2)`. |
| `lineItems` | `DocumentLineItem[]` Prisma relation. |
| `createdAt` | `DateTime` with current timestamp default. |
| `updatedAt` | Required `DateTime` with Prisma `@updatedAt`. |

#### `DocumentLineItem`

| Field | Definition |
| --- | --- |
| `id` | Required `String`, CUID primary key. |
| `documentId` | Required `String`, foreign key to `Document.id`. |
| `document` | Required Prisma relation to `Document`. |
| `description` | Required `String`. |
| `quantity` | Required `Decimal(14,2)`. |
| `unitPrice` | Required `Decimal(14,2)`. |
| `total` | Required `Decimal(14,2)`. |
| `position` | Required `Int`. |

### Enum changes and exact status mapping

The inherited `DealStage` values are replaced by six construction values:

| Old value | New value |
| --- | --- |
| `DEMO_BOOKED` | `LEAD` |
| `QUALIFIED_TO_BUY` | `ESTIMATING` |
| `UNQUALIFIED_TO_BUY` | `LOST` |
| `DECISION_MAKER_BOUGHT_IN` | `ESTIMATING` |
| `CONTRACT_SENT` | `CONTRACTED` |
| `CLOSED_WON` | `COMPLETE` |
| `CLOSED_LOST` | `LOST` |

The final enum order is `LEAD`, `ESTIMATING`, `CONTRACTED`, `IN_PROGRESS`,
`COMPLETE`, `LOST`. `LEAD` is the database and API default. The open statuses
are `LEAD`, `ESTIMATING`, `CONTRACTED`, and `IN_PROGRESS`. `COMPLETE` and
`LOST` are closed statuses.

### Indexes, foreign keys, and delete behavior

| Object | Change |
| --- | --- |
| `deal_companyId_fkey` | Recreated for nullable `Deal.companyId`, referencing `company.id` with `ON DELETE SET NULL` and `ON UPDATE CASCADE`. |
| `agentRun_dealId_createdAt_idx` | Added on `AgentRun(dealId, createdAt)`. |
| `agentRun_dealId_fkey` | Added from `AgentRun.dealId` to `Deal.id` with `ON DELETE SET NULL` and `ON UPDATE CASCADE`. |
| `artifact_dealId_createdAt_idx` | Added on `Artifact(dealId, createdAt)`. |
| `artifact_dealId_fkey` | Added from `Artifact.dealId` to `Deal.id` with `ON DELETE CASCADE` and `ON UPDATE CASCADE`. |
| `document_dealId_createdAt_idx` | Added on `Document(dealId, createdAt)`. |
| `document_dealId_fkey` | Added from `Document.dealId` to `Deal.id` with `ON DELETE CASCADE` and `ON UPDATE CASCADE`. |
| `documentLineItem_documentId_position_idx` | Added on `DocumentLineItem(documentId, position)`. |
| `documentLineItem_documentId_fkey` | Added from `DocumentLineItem.documentId` to `Document.id` with `ON DELETE CASCADE` and `ON UPDATE CASCADE`. |
| `dealContact_one_primary_per_deal_key` | Created temporarily for rejected `DealContact.isPrimary`, then dropped by the cleanup migration. It is not in the final schema. |

The existing `DealContact` primary key `(dealId, contactId)` and index on
`contactId` remain.

### Migration and data transformation behavior

`20260827210000_gc_os_poc/migration.sql` runs in one transaction. It:

- Replaces the PostgreSQL `DealStage` enum and maps stored `Deal.stage` values
  using the exact table above.
- Updates `Activity.meta.from` and `Activity.meta.to` for existing
  `STAGE_CHANGE` rows.
- Renames existing `STAGE_CHANGE` subjects from `Stage changed` to
  `Status changed`.
- Updates old stage values in `SavedView` Deal filters and preserves filter
  order.
- Adds the seven nullable Project fields and nullable `AgentRun.dealId`.
- Creates the three new tables. They start empty.

The original migration also created three temporary fields. The later
`20260828203000_remove_unsupported_contact_fields/migration.sql` runs in one
transaction and drops only these columns if they exist:

- `contact.displayName`
- `contact.businessName`
- `dealContact.isPrimary`

The cleanup migration is safe on a fresh database because each drop uses
`IF EXISTS`.

## API contract map

The table uses physical API field names. A field marked calculated is not a
persisted database field.

| Surface | Input parameters changed | Output parameters or behavior changed |
| --- | --- | --- |
| Company | No Company input schema fields were added, removed, or renamed. | Purge now returns a conflict while any Project still references the Company. The retained web deletion copy states that linked deals must be deleted first. Allowed purge continues to clear Company links from Project-related activities and agent tasks before deleting the Company. |
| Contact | No Contact input schema fields were added, removed, or renamed. | No Contact output field is added. Display text is calculated from `firstName` and optional `lastName` through `contactName`. This applies to conflict, archive, restore, purge, colleague, search, and agent-facing labels. |
| Deal create | `companyId` remains named `companyId` but is required and must be non-empty. `stage` is optional and accepts only open statuses. Added optional `description`, `leadSource`, `projectType`, `addressLine1`, `addressLine2`, `city`, `state`, and `postalCode`. Existing `amountCents`, `currency`, and `expectedCloseDate` inputs remain. | `dealCreateOutput.companyId` is nullable because the physical column is nullable. Default stage is `LEAD`. |
| Deal update | Added the seven Project text fields. `companyId` is optional for a partial update but, when present, must be non-empty and connects a Company. No null clear operation is accepted through this input. Existing `amountCents`, `currency`, and `expectedCloseDate` inputs remain. | Deal list rows add the seven Project fields and calculated `primaryContact`. Company is nullable. Deal detail adds the seven Project fields and makes Company nullable. |
| Deal list and search | No list parameter names changed. Physical `deal` search now also matches attached Contact first and last names. | Project rows and search results support a missing Company. Primary contact output is calculated from `Company.primaryContactId`, not from `DealContact`. |
| Deal status | `setStage` and bulk status inputs retain the physical `stage` field. | Status changes use the new enum, write `Status changed`, and require a reason when setting `LOST`. A closed Project can return to an open status. |
| DealContact | Attach still accepts `dealId`, `contactId`, and optional `role`. Role update accepts the same ids and a nullable `role`. | Attach output remains `{ dealId, contactId }`. Role output is `{ dealId, contactId, role }`. No `isPrimary` input or output is part of the final API. Active Contacts from any Company can be attached to a Project. |
| Activity | No Activity input parameter names changed. `dealId` remains the physical Project link. | Validation and errors call the linked record a Project. Existing stage metadata is migrated to the new status values. |
| Dashboard | `scope` remains `me` or `everyone`, default `me`. | Biggest open rows now allow a nullable Company and add nullable `primaryContact` with `id`, `firstName`, `lastName`, `email`, `title`, and `imageUrl`. Metrics use `COMPLETE` and `LOST`. |
| Search | Quick search still accepts one query string `q`. | Contact labels use calculated name parts. Project results allow a null Company and return null company icons when there is no customer. |
| Conversations | Record-scoped inputs still require exactly one of `contactId`, `companyId`, or physical `dealId`. Builder resources still use physical kind `deal`. | Validation text calls a `dealId` record a Project. Contact resource labels use calculated names. Project resources allow a missing Company. |
| Agent runs | No new public run input is required. | `AgentRun.dealId` is selected and copied when a run is retried. Event-triggered runs set it when the source record kind is physical `deal`. |

The API continues to expose physical names such as `deals`, `dealId`, and
`stage` for compatibility. Construction terminology remains in agent-facing
tools, context, and messages because agents are the headless interface. The
main web UI retains upstream Deal, Company, and Stage wording.

## Agent tools and context

Agent input shapes are mostly unchanged. The changes are terminology, Project
status semantics, nullable customer handling, and calculated Contact labels.

| Tool or context | Final parameters and behavior |
| --- | --- |
| `list_deals` | Physical tool name remains. Inputs are `status` (`open`, `won`, `lost`, `all`, default `open`), optional `inactiveForDays`, optional `companyId`, optional `ownerId`, `limit` (default `50`), and optional `cursor`. `won` maps to `COMPLETE`; `lost` maps to `LOST`. Results include nullable `company` and calculated `primaryContact`. |
| `search_crm` | Inputs remain `query`, optional `kinds`, and `limit` (default `10`). Physical kind `deal` is presented as Project. Project hits include nullable Company and calculated primary Contact. Contact scoring includes the calculated full name and its name parts. |
| `read_deal_history` | Inputs remain physical `dealId` and `threads` (default `5`). The result is Project history. It supports a Project with no Company, and its company value is nullable. It clears stale Company focus when no Company exists. |
| `read_company_history` | Inputs remain `companyId`, `threads` (default `5`), and `people` (default `25`). Deal records in the result are described as Projects and status values use the construction enum. |
| `read_crm_history` | Inputs remain `contactId` and `threads` (default `5`). Related deal records are described as Projects. |
| `list_fields` and `set_field_value` | Entity values remain physical `COMPANY`, `CONTACT`, and `DEAL`. Descriptions call `DEAL` fields Project fields. |
| `record_job_change` | Inputs remain `contactId` and optional `moveToCompanyId`. Timeline text uses the calculated Contact name. |
| `schedule_recheck` | Inputs remain `contactId`, `days`, `reason`, and `budget` (default `4`). Guidance refers to live Projects. |
| Agent preambles and transcript | Project context uses Project, Project ID, Status, Target date, and Customer contacts. `DealListItem.company` is nullable and `primaryContact` is nullable with a default of `null`. Contact labels use `firstName` plus optional `lastName`. |
| Focus state | `focusOn` now treats explicit `null` as a clear operation. This lets a no-Company Project remove a prior Company focus. |

## Interface UI

The upstream web UI, landing copy, terminology, forms, fields, columns,
filters, menus, dashboards, and controls are restored. The branch does not
ship a construction Project or Customer web UI. Agent-facing construction
terminology remains in the agent tools and context described above, because
agents are the headless interface.

These are the exact remaining effective `apps/app` differences from
`origin/master` and their required reason:

| File | Required reason |
| --- | --- |
| `app/(app)/[slug]/dashboard-summary.tsx` | Renders nullable API Company output safely. |
| `app/(app)/[slug]/deals/create-deal-sheet.tsx` | Uses current `DealStage` values and blocks create submission without `companyId`. |
| `app/(app)/[slug]/deals/deals-bulk-actions.tsx` | Uses current `LOST` enum value. |
| `components/crm/record-sheet/company-sheet.tsx` | States the retained customer-deletion rule. |
| `components/crm/record-sheet/deal-sheet.tsx` | Handles nullable API Company output without offering a clear operation. |
| `components/crm/record-sheet/quick-add.tsx` | Supports the nullable Company display path. |
| `components/crm/stage-change.tsx` | Uses current `LOST` enum value. |
| `components/crm/stage-stepper.tsx` | Uses current `COMPLETE` enum value. |
| `lib/agent-transcript.ts` | Preserves nullable Company and `primaryContact` agent response types. |
| `lib/contact-name.test.ts` | Retains contact-name behavior coverage. |
| `lib/deal-stage.ts` | Maps only current `DealStage` enum values. |
| `test/agent-transcript.spec.ts` | Verifies the current agent deal-list response shape. |

## Validation and business rules

| Rule | Implementation boundary |
| --- | --- |
| Every construction Project has a Customer. | `dealCreateInput` requires a non-empty `companyId`, and the creation sheet disables submit until a Customer is selected. PostgreSQL keeps `Deal.companyId` nullable for upstream compatibility. |
| A Customer with Projects cannot be purged. | `CompaniesService` rejects purge while a Project references the Company. The Project remains and is not cascaded by Company deletion. |
| Contact labels are calculated. | `contactName` joins `firstName` and optional `lastName`. No persisted display label is used. |
| A Company has one primary Contact at most. | `Company.primaryContactId` remains the persisted primary-contact field. Deal-list and dashboard API primary-Contact values are calculated from it. |
| A Project can have several Contacts. | `DealContact` uses composite primary key `(dealId, contactId)`, optional `role`, and no primary flag. Each active Contact can be attached once to a Project. |
| New Projects start open. | Default is `LEAD`. Create input rejects `COMPLETE` and `LOST` as initial statuses. |
| Lost Projects require a reason. | Single and bulk status changes reject `LOST` without `closedReason`. The reason is stored in the status-change Activity body and the Project `closedReason`. |
| Closed and open status events stay consistent. | `COMPLETE` and `LOST` are closed. Reopening writes an open status, clears closed fields, and emits the existing Project open event. |
| Document snapshot storage is required. | This PR adds required `recipientSnapshot`, `contractorSnapshot`, and `projectSnapshot` JSON fields. It does not implement an issuance workflow or enforce immutability after issuance. |
| Project files and documents follow their Project. | Artifact and Document foreign keys cascade from `Deal`. Document line items cascade from `Document`. |

The application rule for `Deal.companyId` is stricter than the physical rule.
The database uses a nullable column and `ON DELETE SET NULL`; construction API
and interface flows require a Customer. This preserves upstream compatibility
without allowing an unassigned normal construction Project.

## Removed or rejected additions

These additions are not part of the final construction model:

| Rejected addition | Final result |
| --- | --- |
| `Contact.displayName` | Removed by the compatibility migration. Contact labels are calculated from `firstName` and `lastName`. |
| `Contact.businessName` | Removed by the compatibility migration. Company stores the household or business customer name. |
| `DealContact.isPrimary` | Removed by the compatibility migration. `Company.primaryContactId` remains the only persisted primary-contact concept. |
| Household or business discriminator | Not added. `Company.name` is used for either customer kind. |

The final `DealContact` contains only `dealId`, `contactId`, and optional
`role`, with its existing composite primary key and foreign keys.

## Unchanged inherited and final models

These models have no final Prisma schema field change compared with
`origin/master`:

| Model | Final relevant shape and construction meaning |
| --- | --- |
| `User` | Existing User fields and relations remain. The POC has one User who is the GC login and owner of records. |
| `Organization` | Existing access-container fields and relations remain. The POC has one Organization. |
| `Member` | Existing membership fields, unique `(organizationId, userId)`, and indexes remain. The POC has one row with role `owner`. |
| `Company` | Existing Company fields and relations remain, including `name`, optional `ownerId`, unique `primaryContactId`, and `Company.primaryContact` with `ON DELETE SET NULL`. It represents a household or business customer. |
| `Contact` | Existing final fields and relations remain, including `firstName`, optional `lastName`, optional Company and User links, and Contact activity/project links. `displayName` and `businessName` are absent. It represents a homeowner or spouse. |
| `DealContact` | Existing final fields are required `dealId`, required `contactId`, optional `role`, composite primary key `(dealId, contactId)`, `contactId` index, and cascading foreign keys. `isPrimary` is absent. |

The only physical schema whitespace changes in the compared schema are field
alignment in `Organization` and `XmppAgentTask`. They do not change the
database.

## Test coverage in the change

The compared branch adds or updates focused coverage for:

- Project history without a Company, Project search, attached Contact search,
  nullable Project customers, and calculated Contact names.
- Required Project customers, open-only initial statuses, status migration,
  lost reasons, Company purge protection, and preservation of Project activity
  when purge is refused.
- Company primary Contact output, multiple Project Contacts, cross-Company
  Contact attachment, optional Project roles, and draft Documents without an
  issue date.
- Activity output, SavedView status filters, dashboard API rows with nullable
  Companies, agent Project lists, and agent transcript handling for nullable
  customers and primary Contacts.
- Retained application coverage for calculated Contact names and the current
  agent deal-list response shape. Project creation and deletion invariants are
  covered by focused API tests.

No full-suite result is recorded in this map because this change map does not
run the full suite.

## Maintenance

When PR #2 changes, refresh the base SHA, reviewed implementation head, and
date first. Update the reviewed implementation head only when product, API,
agent, interface, schema, migration, validation, or test behavior changes. A
documentation-only map correction does not need to reference its own commit.
Then compare `origin/master...HEAD` and update each affected section. Keep persistent
database fields separate from calculated API output and interface labels.
Add every new or removed field to the database and API tables, and add every
changed input, output, tool parameter, form field, filter, and business rule to
its category. Re-run the rejected-field and `DealStage` value searches, then
run `git diff --check`.
