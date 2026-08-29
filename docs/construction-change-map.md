# CompCRM construction change map

This is the canonical Markdown map for the headless construction POC. It
records the original CRM names, their construction meanings, and every
retained database or parameter change.

| Item | Value |
| --- | --- |
| Base branch | `origin/master` |
| Base SHA | `c7fc76ee5074152f691c55a9ce5fb017521fefc4` |
| Audited branch | `feat/construction-crm` |
| Audited SHA before this implementation | `f910fe37eb318015773eab50fffd574818a98711` |
| Last updated | 2026-08-28 |

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

## Immutable migration history

The four branch migrations are retained byte-for-byte because they were
already pushed and applied locally. They are historical migration records and
must not be edited, deleted, renamed, reordered, or squashed.

`20260827210000_gc_os_poc` temporarily drops the Deal Company foreign key,
makes `Deal.companyId` nullable, removes the stage default, replaces the
seven-value enum with six temporary values, rewrites Activity stage metadata,
rewrites SavedView stage filters, adds temporary Contact and DealContact
fields, and adds the retained project fields, agent link, and three tables.

The temporary stage conversion is many-to-one:

- `DEMO_BOOKED` becomes `LEAD`.
- `QUALIFIED_TO_BUY` and `DECISION_MAKER_BOUGHT_IN` become `ESTIMATING`.
- `CONTRACT_SENT` becomes `CONTRACTED`.
- `CLOSED_WON` becomes `COMPLETE`.
- `CLOSED_LOST` and `UNQUALIFIED_TO_BUY` become `LOST`.

`20260828203000_remove_unsupported_contact_fields` drops the temporary
`Contact.displayName`, `Contact.businessName`, and `DealContact.isPrimary`
columns when they exist.

`20260829010000_require_deal_company` checks for orphan Deals, restores
`Deal.companyId` to `NOT NULL`, and restores the Company foreign key with
`ON DELETE CASCADE`. It does not backfill or delete data.

`20260829011000_restore_deal_stage` restores the original seven-value enum,
default, Activity metadata, SavedView filters, and `Stage changed` subject.
The earlier conversion cannot recover whether an `ESTIMATING` value came from
`QUALIFIED_TO_BUY` or `DECISION_MAKER_BOUGHT_IN`, or whether a `LOST` value came
from `CLOSED_LOST` or `UNQUALIFIED_TO_BUY`.

The final schema therefore contains the retained additive tables and fields,
plus the original Company and DealStage definitions. The temporary migration
effects remain documented here and are not repeated in application code.

## Retained API parameters and behavior

| Surface | Retained change |
| --- | --- |
| Deal create | Accepts optional `leadSource`, `projectType`, `addressLine1`, `addressLine2`, `city`, `state`, and `postalCode`. Existing `name`, required `companyId`, required `ownerId`, physical `stage`, amount, currency, and expected-close inputs remain unchanged. |
| Deal update | Accepts the same seven optional text fields. Blank strings become null. Existing physical CRM parameters remain unchanged. |
| Deal list | Returns the seven fields on each row. Existing physical output names remain unchanged. |
| Deal detail | Returns the seven fields. Existing physical output names remain unchanged. |
| Company purge | Rejects deletion while a Deal references the Company, with a conflict asking the caller to delete the customer's projects first. Other original purge behavior remains. |
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
