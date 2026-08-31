# CompCRM construction change map

This is the canonical Markdown map for the headless construction POC. It
records the original CRM names, their construction meanings, and every
retained database or parameter change.

| Item | Value |
| --- | --- |
| Base branch | `origin/master` |
| Base SHA | `c7fc76ee5074152f691c55a9ce5fb017521fefc4` |
| Audited branch | `feat/construction-crm` |
| Audited SHA before this implementation | `c505c3e1e868de74f68666a1011fe51d4d9d2856` |
| Last updated | 2026-08-29 |

## Vocabulary and boundary

| Original CRM name | Construction meaning | Stored and API name |
| --- | --- | --- |
| `Company` | Customer or Household | `Company`, `company` |
| `Contact` | Person | `Contact`, `contact` |
| `Deal` | Project | `Deal`, `deal` |
| `DealContact` | Project Contact | `DealContact`, `dealContact` |
| `DealStage` | Project Status | `DealStage`, `stage` |
| `Artifact` | Project File | `Artifact`, `artifact` |
| `Document` | Estimate or Invoice | `Document`, `document` |
| `DocumentLineItem` | Estimate or Invoice Line | `DocumentLineItem`, `documentLineItem` |

The POC has one human GC role. Other operational roles are bots or agents.
`User`, `Organization`, and `Member` remain inherited access infrastructure.
The future middleware may translate construction terms into CRM terms. This
branch does not implement that middleware.

## DealStage mapping

The stored enum and the API `stage` parameter retain the original values.

| Original `DealStage` value | Construction status |
| --- | --- |
| `DEMO_BOOKED` | Lead |
| `QUALIFIED_TO_BUY` | Estimating |
| `CONTRACT_SENT` | Contracted |
| `DECISION_MAKER_BOUGHT_IN` | In progress |
| `CLOSED_WON` | Complete |
| `CLOSED_LOST` | Lost |
| `UNQUALIFIED_TO_BUY` | Disqualified |

The default remains `DEMO_BOOKED`. No code mapping or enum rename is retained.

## Retained database changes

### Existing models

| Model or field | Retained change |
| --- | --- |
| `Deal.leadSource` | Optional `String` for lead source. |
| `Deal.projectType` | Optional `String` for construction type. |
| `Deal.addressLine1` | Optional `String` for the job-site address. |
| `Deal.addressLine2` | Optional `String` for a second address line. |
| `Deal.city` | Optional `String` for the job-site city. |
| `Deal.state` | Optional `String` for the job-site state or region. |
| `Deal.postalCode` | Optional `String` for the job-site postal code. |
| `AgentRun.dealId` | Optional `String` with a nullable `Deal` relation, `ON DELETE SET NULL`, and an index on `(dealId, createdAt)`. |
| `Deal.agentRuns` | Reverse `AgentRun[]` relation. |
| `Deal.artifacts` | Reverse `Artifact[]` relation. |
| `Deal.documents` | Reverse `Document[]` relation. |

`Deal.companyId` remains required. Its original Company foreign key and
`ON DELETE CASCADE` behavior remain. `DealStage` remains the original enum.
`Contact` has no `displayName` or `businessName`. `DealContact` has no
`isPrimary` field or unique primary-contact index.

### `Artifact`

| Field | Definition |
| --- | --- |
| `id` | Required CUID string primary key. |
| `dealId` | Required foreign key to `Deal.id`. |
| `deal` | Required relation to `Deal`, cascade on delete. |
| `type` | Required string. |
| `fileName` | Required string. |
| `storageKey` | Required string. |
| `createdAt` | Timestamp with current-time default. |

Index: `(dealId, createdAt)`.

### `Document`

| Field | Definition |
| --- | --- |
| `id` | Required CUID string primary key. |
| `dealId` | Required foreign key to `Deal.id`. |
| `deal` | Required relation to `Deal`, cascade on delete. |
| `type` | Required string. |
| `number` | Required string. |
| `status` | Required string. |
| `currency` | Required string, default `USD`. |
| `issuedAt` | Optional timestamp. |
| `dueAt` | Optional timestamp. |
| `recipientSnapshot` | Required JSON. |
| `contractorSnapshot` | Required JSON. |
| `projectSnapshot` | Required JSON. |
| `subtotal` | Required `Decimal(14,2)`. |
| `tax` | Required `Decimal(14,2)`. |
| `total` | Required `Decimal(14,2)`. |
| `lineItems` | `DocumentLineItem[]` relation. |
| `createdAt` | Timestamp with current-time default. |
| `updatedAt` | Required timestamp with Prisma `@updatedAt`. |

Index: `(dealId, createdAt)`.

### `DocumentLineItem`

| Field | Definition |
| --- | --- |
| `id` | Required CUID string primary key. |
| `documentId` | Required foreign key to `Document.id`. |
| `document` | Required relation to `Document`, cascade on delete. |
| `description` | Required string. |
| `quantity` | Required `Decimal(14,2)`. |
| `unitPrice` | Required `Decimal(14,2)`. |
| `total` | Required `Decimal(14,2)`. |
| `position` | Required integer. |

Index: `(documentId, position)`.

## Additive migration

`20260829120000_add_deal_metadata_documents` is the single branch migration.
It adds the seven optional Deal text fields, the optional AgentRun Deal
relation and index, and the Artifact, Document, and DocumentLineItem tables
with their required indexes and delete behavior.

The migration adds no data changes. It does not change DealStage, Deal.companyId,
Contact, DealContact, Activity, or SavedView.

## Retained API parameters and behavior

| Surface | Retained change |
| --- | --- |
| Deal create | Accepts optional `leadSource`, `projectType`, `addressLine1`, `addressLine2`, `city`, `state`, and `postalCode`. Existing `name`, required `companyId`, required `ownerId`, physical `stage`, amount, currency, and expected-close inputs remain unchanged. |
| Deal update | Accepts the same seven optional text fields. Blank strings become null. Existing physical CRM parameters remain unchanged. |
| Deal list | Returns the seven fields on each row. Existing physical output names remain unchanged. |
| Deal detail | Returns the seven fields. Existing physical output names remain unchanged. |
| Company purge | Rejects deletion while a Deal references the Company, with the original CRM conflict text. Other original purge behavior remains. |
| Agent runs | Event-triggered runs store `dealId` for physical Deal records. Retry loading and creation copy the nullable `dealId`. |

No API alias, primary-contact output, cross-Company attach behavior, closed-stage
create restriction, attached-contact search, company clearing, or construction
wording change is retained.

## Original behavior retained

- Company is required for every Deal at the database and API boundary.
- Original CRM names, routes, OpenAPI tags, error text, event text, and stage
  values remain in application code.
- `DealContact` keeps its composite key `(dealId, contactId)`, optional `role`,
  same-Company attach rule, and original service behavior.
- Contact labels remain calculated from `firstName` and optional `lastName`.
- The web UI, landing copy, agent prompts, agent tool wording, and construction
  status code mappings are restored to the original branch behavior.
- No construction UI is shipped.

## Retained focused tests

- Deal field create, update, list, and detail behavior.
- Required database Company relation for a Deal.
- Document and DocumentLineItem persistence.
- Company purge refusal while a Deal exists, including preserved project
  activity and queued task records.
- AgentRun Deal context on event dispatch and retry.
- Original physical DealStage behavior in agent event fixtures.

The full test commands and their results belong in the implementation report.
