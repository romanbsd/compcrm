# Existing CompCRM database mapped to construction

Source: [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma).

This document maps the existing CompCRM database to the General Contractor POC. It uses the existing physical model names so upstream synchronization does not require table renames.

The database has 64 Prisma models. Only a small group is required for the first construction workflow.

## Construction vocabulary

| Existing model | Construction meaning | POC use |
| --- | --- | --- |
| `User` | GC login | The POC has one User and one human role, GC. This login owns customers, contacts, and Projects, creates activities, and runs bots. |
| `Organization` and `Member` | Inherited access infrastructure | The POC has one Organization, one User, and one Member row with role `owner`. These records provide access only and are not construction workflow entities. |
| `Company` | Customer | Represents a household or business. Every Project must have one customer. |
| `Contact` | Customer person | Represents a homeowner or spouse. |
| `Deal` | Project | Represents the construction opportunity and job from lead through completion. |
| `DealContact` | Project Contact | Connects people to a Project and records one optional role. |
| `Activity` | Project or customer history item | Stores notes, calls, emails, meetings, tasks, and stage changes. |
| `Artifact` | Project file | Stores the reference to a photo, recording, transcript, plan, or other file. |
| `Document` | Estimate or invoice | Stores an issued financial document and fixed recipient, contractor, and Project snapshots. |
| `DocumentLineItem` | Estimate or invoice line | Stores the work or material lines in a Document. |
| `AgentConversation`, `AgentRun`, `AgentAction` | Automation records | Stores bot conversations, executions, and actions, with optional Project context. |

## Core construction relationship

```mermaid
erDiagram
    USER o|--o{ COMPANY : owns
    COMPANY ||--o{ DEAL : customer_for
    COMPANY o|--o{ CONTACT : groups
    COMPANY o|--o| CONTACT : primary_contact

    USER ||--o{ DEAL : owns
    CONTACT ||--o{ DEAL_CONTACT : participates
    DEAL ||--o{ DEAL_CONTACT : includes

    DEAL ||--o{ ACTIVITY : records
    DEAL ||--o{ ARTIFACT : stores
    DEAL ||--o{ DOCUMENT : produces
    DOCUMENT ||--o{ DOCUMENT_LINE_ITEM : contains

    DEAL o|--o{ AGENT_CONVERSATION : provides_context
    DEAL o|--o{ AGENT_RUN : provides_context
    AGENT_RUN ||--o{ AGENT_ACTION : performs
```

The `Company` to `Deal` line shows the construction rule. The PostgreSQL column is still nullable for upstream compatibility, but the construction API and interface require `Deal.companyId`. A Company cannot be purged while it has Projects.

For a household, `Company.name` can contain the household display name and the spouses are separate `Contact` records. For a business customer, `Company.name` contains the business name and its people are separate `Contact` records. `DealContact` is the authoritative list of people participating in each Project.

## Model inventory

| Area | Models | Direct GC POC role |
| --- | --- | --- |
| GC and CRM | `Company`, `CompanyEnrichment`, `Contact`, `ContactFact`, `ContactBrief`, `Deal`, `DealContact`, `Activity`, `Artifact`, `Document`, `DocumentLineItem`, `ExchangeRate` | `Company`, `Contact`, `Deal`, `DealContact`, `Activity`, `Artifact`, `Document`, and `DocumentLineItem` are in the GC flow. |
| Custom fields and views | `FieldDefinition`, `FieldOption`, `FieldValue`, `SavedView` | Optional CRM support. |
| Agents | `AgentTask`, `XmppAgentTask`, `AgentEvent`, `AgentConversation`, `AgentConversationFeedback`, `AgentConversationShare`, `AgentConversationSubmission`, `AgentConversationAttachment`, `AgentDefinition`, `AgentVersion`, `AgentBuilderArtifact`, `AgentTrigger`, `AgentRun`, `AgentRunEvent`, `AgentAction`, `AgentAuditEvent` | Supports construction automation and the agent builder. |
| Email and calendar | `MailboxSync`, `EmailThread`, `EmailMessage`, `CalendarEvent`, `CalendarAttendee` | Supports customer communication and scheduling. |
| Tracking and forms | `SuppressedDomain`, `SuppressedContact`, `TrackedDomain`, `TrackedVisitor`, `TrackedEvent`, `TrackingCounter`, `TrackedPageDaily`, `FormSubmission` | No required role in the first GC flow. |
| Authentication and workspace | `User`, `Session`, `Account`, `Verification`, `RateLimit`, `Organization`, `WorkspaceProfile`, `Member`, `Invitation`, `SsoProvider`, `Apikey` | Supports sign-in and inherited access infrastructure. |
| Slack | `SlackMemberMatch`, `SlackChannel`, `SlackInstallation`, `SlackWorkspaceGrant` | No required role in the first GC flow. |
| System and telemetry | `AppSetting`, `Install`, `TelemetryMilestone`, `TelemetryCounter` | Application configuration and product telemetry. |

## GC and CRM relations

```mermaid
erDiagram
    USER ||--o{ COMPANY : owns
    USER ||--o{ CONTACT : owns
    USER ||--o{ DEAL : owns
    USER ||--o{ ACTIVITY : creates

    COMPANY ||--o| COMPANY_ENRICHMENT : has
    COMPANY o|--o{ CONTACT : groups
    CONTACT o|--o| COMPANY : primary_contact_for
    COMPANY o|--o{ DEAL : customer_for

    CONTACT ||--o| CONTACT_BRIEF : has
    CONTACT ||--o{ CONTACT_FACT : has
    USER o|--o{ CONTACT_FACT : decides

    CONTACT ||--o{ DEAL_CONTACT : participates
    DEAL ||--o{ DEAL_CONTACT : includes

    COMPANY o|--o{ ACTIVITY : concerns
    CONTACT o|--o{ ACTIVITY : concerns
    DEAL o|--o{ ACTIVITY : records

    DEAL ||--o{ ARTIFACT : stores
    DEAL ||--o{ DOCUMENT : produces
    DOCUMENT ||--o{ DOCUMENT_LINE_ITEM : contains

    COMPANY {
        string id PK
        string name
        string primaryContactId FK
        string ownerId FK
        string domain
        string website
        string phone
        string email
        datetime archivedAt
    }

    COMPANY_ENRICHMENT {
        string companyId PK,FK
        string source
        json raw
        datetime fetchedAt
    }

    CONTACT {
        string id PK
        string companyId FK
        string ownerId FK
        string firstName
        string lastName
        string email
        string phone
        datetime archivedAt
    }

    CONTACT_FACT {
        string id PK
        string contactId FK
        string decidedById FK
        string field
        string value
        float score
        string status
    }

    CONTACT_BRIEF {
        string contactId PK,FK
        string narrative
        json sections
        float score
    }

    DEAL {
        string id PK
        string companyId FK
        string ownerId FK
        string name
        string description
        string stage
        decimal amount
        string currency
        string leadSource
        string projectType
        string addressLine1
        string addressLine2
        string city
        string state
        string postalCode
        datetime expectedCloseDate
        datetime archivedAt
    }

    DEAL_CONTACT {
        string dealId PK,FK
        string contactId PK,FK
        string role
    }

    ACTIVITY {
        string id PK
        string companyId FK
        string contactId FK
        string dealId FK
        string createdById FK
        string type
        string subject
        string body
        datetime occurredAt
        datetime dueAt
        datetime completedAt
    }

    ARTIFACT {
        string id PK
        string dealId FK
        string type
        string fileName
        string storageKey
    }

    DOCUMENT {
        string id PK
        string dealId FK
        string type
        string number
        string status
        string currency
        datetime issuedAt
        datetime dueAt
        json recipientSnapshot
        json contractorSnapshot
        json projectSnapshot
        decimal subtotal
        decimal tax
        decimal total
    }

    DOCUMENT_LINE_ITEM {
        string id PK
        string documentId FK
        string description
        decimal quantity
        decimal unitPrice
        decimal total
        int position
    }

    EXCHANGE_RATE {
        string id PK
        string baseCurrency
        string quoteCurrency
        decimal rate
        datetime asOf
        string source
    }
```

`ExchangeRate` has no foreign-key relation to another model.

## Company dependency map

```mermaid
erDiagram
    COMPANY ||--o| COMPANY_ENRICHMENT : enriches
    COMPANY o|--o{ CONTACT : groups
    COMPANY o|--o{ DEAL : groups
    COMPANY o|--o{ AGENT_CONVERSATION : provides_context
    COMPANY o|--o{ FIELD_VALUE : has
    COMPANY o|--o{ ACTIVITY : concerns
    COMPANY o|--o{ EMAIL_THREAD : concerns
    COMPANY o|--o{ CALENDAR_EVENT : concerns
```

| Referencing model | Field | Delete behavior | GC requirement |
| --- | --- | --- | --- |
| `CompanyEnrichment` | `companyId` | Cascade | None. |
| `Contact` | `companyId` | Set null | Optional household or business grouping. Project participation is stored in `DealContact`. |
| `Deal` | `companyId` | Set null in PostgreSQL | Required by the construction API and interface. |
| `AgentConversation` | `companyId` | Cascade | None for Project conversations. |
| `FieldValue` | `companyId` | Cascade | None for Contact or Project values. |
| `Activity` | `companyId` | Cascade | None for Contact or Project activities. |
| `EmailThread` | `companyId` | Set null | None when linked through Contact. |
| `CalendarEvent` | `companyId` | Set null | None when linked through Contact. |
| `AgentTask` | `companyId` | No declared foreign key | None for Project tasks. |

`Company.primaryContactId` also points to `Contact`. Company is the required customer record for a construction Project. The physical `Deal.companyId` column remains nullable only for upstream compatibility.

## Construction workflow mapping

### Lead intake

1. Create or select one `Company` customer. Use it for either a household or business.
2. Create each person as a `Contact`. `Contact.companyId` can group the person under the customer, but this link is not the Project relationship.
3. Create the `Deal` Project with the customer in `Deal.companyId`, the GC owner in `Deal.ownerId`, and `stage = LEAD`.
4. Add each participating person through `DealContact`.
5. Set `Company.primaryContactId` when the main customer contact is known.
6. Store intake notes, calls, meetings, or follow-up work as `Activity` records.

### Sales and production

`Deal.stage` supplies the current POC lifecycle:

| Value | Construction meaning |
| --- | --- |
| `LEAD` | New opportunity. |
| `ESTIMATING` | Scope and price are being prepared. |
| `CONTRACTED` | The customer accepted the work. |
| `IN_PROGRESS` | Construction is active. |
| `COMPLETE` | Construction is complete. |
| `LOST` | The opportunity will not proceed. |

`Deal.projectType` stores the work category, such as kitchen remodeling or patio. The job-site address stays on `Deal`. A separate Property table is not required for this POC.

### Project contacts

The `DealContact` primary key is `(dealId, contactId)`. One person can appear once in a Project and has one optional `role`. `Company.primaryContactId` identifies the main customer contact for the household or business.

This structure supports two spouses without a Household table. Both spouses are Contacts, both link to the same Project, and the Project belongs to the household customer stored in `Company`.

### Estimates and invoices

Create one `Document` for each estimate or invoice. Add its rows through `DocumentLineItem`.

The `recipientSnapshot`, `contractorSnapshot`, and `projectSnapshot` fields preserve the printed information at issue time. Later changes to the customer, Contacts, or Project do not change an issued document.

### Construction automation

Use `AgentConversation` for an automation conversation. Link it to `Deal` when the conversation concerns a Project. `AgentRun` stores each execution and can also link to the Project. `AgentAction` stores each planned or completed action from the run.

The existing agent framework is shared by construction automations. Separate construction bot tables are not required.

### Communication and scheduling

`EmailThread` and `CalendarEvent` can link to a Company or Contact. Their synchronized events can also create an `Activity`. These tables do not link directly to `Deal`, so the Project timeline uses the related `Activity.dealId` when Project context is required.

## Required construction rules

| Rule | Current enforcement |
| --- | --- |
| Every Project has one customer. | The construction API and interface require `Deal.companyId`. PostgreSQL still permits null for upstream compatibility. |
| A customer with Projects cannot be purged. | The Company service rejects purge until its Projects are deleted. |
| A Project can have several people. | `DealContact` is a many-to-many join between `Deal` and `Contact`. |
| A person appears once per Project. | Composite primary key on `DealContact(dealId, contactId)`. |
| A Company has at most one primary contact. | `Company.primaryContactId` points to one Contact. |
| Issued documents keep their original printed details. | Required JSON snapshots on `Document`. |
| Project files are deleted with the Project. | `Artifact.dealId` uses cascade delete. |
| Documents and their lines are deleted with the Project. | `Document.dealId` and `DocumentLineItem.documentId` use cascade delete. |

## Custom fields and saved views

```mermaid
erDiagram
    FIELD_DEFINITION ||--o{ FIELD_OPTION : offers
    FIELD_DEFINITION ||--o{ FIELD_VALUE : defines
    FIELD_OPTION o|--o{ FIELD_VALUE : selected_by
    COMPANY o|--o{ FIELD_VALUE : has
    CONTACT o|--o{ FIELD_VALUE : has
    DEAL o|--o{ FIELD_VALUE : has
    USER o|--o{ FIELD_VALUE : supplies_user_value
    USER ||--o{ SAVED_VIEW : owns

    FIELD_DEFINITION {
        string id PK
        string entity
        string key
        string label
        string type
        boolean required
        int position
    }

    FIELD_OPTION {
        string id PK
        string fieldId FK
        string label
        int position
    }

    FIELD_VALUE {
        string id PK
        string fieldId FK
        string companyId FK
        string contactId FK
        string dealId FK
        string optionId FK
        string userId FK
        string text
        decimal number
        datetime date
        boolean bool
    }

    SAVED_VIEW {
        string id PK
        string ownerId FK
        string entity
        string name
        boolean shared
        json filters
    }
```

## Agent and bot relations

```mermaid
erDiagram
    USER ||--o{ AGENT_CONVERSATION : owns
    CONTACT o|--o{ AGENT_CONVERSATION : provides_context
    COMPANY o|--o{ AGENT_CONVERSATION : provides_context
    DEAL o|--o{ AGENT_CONVERSATION : provides_context
    AGENT_DEFINITION o|--o{ AGENT_CONVERSATION : handles

    AGENT_CONVERSATION ||--o{ AGENT_EVENT : emits
    AGENT_CONVERSATION ||--o{ AGENT_CONVERSATION_FEEDBACK : receives
    AGENT_CONVERSATION ||--o| AGENT_CONVERSATION_SHARE : shares
    AGENT_CONVERSATION ||--o{ AGENT_CONVERSATION_SUBMISSION : accepts
    AGENT_CONVERSATION_SUBMISSION ||--o{ AGENT_CONVERSATION_ATTACHMENT : contains
    AGENT_CONVERSATION o|--o{ AGENT_VERSION : sources
    AGENT_CONVERSATION o|--o{ AGENT_BUILDER_ARTIFACT : produces

    USER ||--o{ AGENT_CONVERSATION_FEEDBACK : writes
    USER ||--o{ AGENT_CONVERSATION_SHARE : creates
    USER ||--o{ AGENT_CONVERSATION_SUBMISSION : submits

    USER ||--o{ AGENT_DEFINITION : creates
    AGENT_DEFINITION ||--o{ AGENT_VERSION : versions
    AGENT_DEFINITION o|--o| AGENT_VERSION : current_version
    USER ||--o{ AGENT_VERSION : creates
    AGENT_VERSION o|--o{ AGENT_BUILDER_ARTIFACT : produces

    AGENT_DEFINITION ||--o{ AGENT_TRIGGER : configures
    AGENT_VERSION ||--o{ AGENT_TRIGGER : uses
    USER ||--o{ AGENT_TRIGGER : creates

    AGENT_DEFINITION ||--o{ AGENT_RUN : executes
    AGENT_VERSION ||--o{ AGENT_RUN : runs
    AGENT_TRIGGER o|--o{ AGENT_RUN : starts
    USER o|--o{ AGENT_RUN : initiates
    DEAL o|--o{ AGENT_RUN : provides_context
    AGENT_RUN ||--o{ AGENT_RUN_EVENT : emits

    AGENT_DEFINITION ||--o{ AGENT_ACTION : owns
    AGENT_RUN ||--o{ AGENT_ACTION : performs

    AGENT_DEFINITION ||--o{ AGENT_AUDIT_EVENT : records
    AGENT_VERSION o|--o{ AGENT_AUDIT_EVENT : records
    USER o|--o{ AGENT_AUDIT_EVENT : acts

    ORGANIZATION ||--o{ XMPP_AGENT_TASK : owns
```

### Agent models

| Model | Main role |
| --- | --- |
| `AgentTask` | Legacy enrichment or background work queue. Its `contactId`, `companyId`, and `dealId` fields are scalar IDs without declared Prisma relations. |
| `XmppAgentTask` | XMPP task lifecycle for an Organization. |
| `AgentEvent` | Conversation event stream. |
| `AgentConversation` | User conversation linked optionally to Contact, Company, Deal, and AgentDefinition. |
| `AgentConversationFeedback` | Per-message user rating. |
| `AgentConversationShare` | Share token for a conversation. |
| `AgentConversationSubmission` | Durable user command submission. |
| `AgentConversationAttachment` | Binary attachment on a submission. |
| `AgentDefinition` | Agent identity and current version. |
| `AgentVersion` | Versioned instructions, manifest, model, and sandbox policy. |
| `AgentBuilderArtifact` | Versioned builder file content. |
| `AgentTrigger` | Manual, schedule, event, or webhook trigger. |
| `AgentRun` | One agent execution, optionally linked to a Deal. |
| `AgentRunEvent` | Ordered run event stream. |
| `AgentAction` | External or internal action attempted by a run. |
| `AgentAuditEvent` | Agent configuration audit history. |

## Email and calendar relations

```mermaid
erDiagram
    USER ||--o{ MAILBOX_SYNC : owns

    COMPANY o|--o{ EMAIL_THREAD : concerns
    CONTACT o|--o{ EMAIL_THREAD : concerns
    EMAIL_THREAD ||--o{ EMAIL_MESSAGE : contains
    EMAIL_THREAD ||--o| ACTIVITY : creates

    COMPANY o|--o{ CALENDAR_EVENT : concerns
    CONTACT o|--o{ CALENDAR_EVENT : concerns
    CALENDAR_EVENT ||--o{ CALENDAR_ATTENDEE : includes
    CONTACT o|--o{ CALENDAR_ATTENDEE : matches
    CALENDAR_EVENT ||--o| ACTIVITY : creates

    MAILBOX_SYNC {
        string id PK
        string userId FK
        string source
        string status
        string cursor
    }

    EMAIL_THREAD {
        string id PK
        string companyId FK
        string contactId FK
        string rootMessageId
        string subject
    }

    EMAIL_MESSAGE {
        string id PK
        string threadId FK
        string direction
        string fromEmail
        json recipients
        string subject
        string body
        datetime sentAt
    }

    CALENDAR_EVENT {
        string id PK
        string companyId FK
        string contactId FK
        string iCalUid
        string title
        datetime startsAt
        datetime endsAt
    }

    CALENDAR_ATTENDEE {
        string id PK
        string eventId FK
        string contactId FK
        string email
        string name
    }
```

## Tracking and forms

```mermaid
erDiagram
    CONTACT o|--o{ TRACKED_VISITOR : identifies
    CONTACT o|--o{ FORM_SUBMISSION : identifies

    SUPPRESSED_DOMAIN {
        string domain PK
        string reason
    }

    SUPPRESSED_CONTACT {
        string email PK
        string reason
    }

    TRACKED_DOMAIN {
        string id PK
        string host
        string scope
        int pageViews
    }

    TRACKED_VISITOR {
        string id PK
        string contactId FK
        string firstSource
        string firstCampaign
        string lastSource
        string lastCampaign
    }

    TRACKED_EVENT {
        string id PK
        string visitorId
        string type
        string host
        string path
        string source
        string campaign
    }

    TRACKING_COUNTER {
        string key PK
        int value
        datetime expiresAt
    }

    TRACKED_PAGE_DAILY {
        datetime day PK
        string host PK
        string path PK
        int views
        int visitors
    }

    FORM_SUBMISSION {
        string id PK
        string visitorId
        string contactId FK
        string host
        string path
        string email
        json fields
    }
```

`TrackedEvent.visitorId` and `FormSubmission.visitorId` do not have declared Prisma relations to `TrackedVisitor`.

## Authentication, workspace, Slack, and system models

```mermaid
erDiagram
    USER ||--o{ SESSION : authenticates
    USER ||--o{ ACCOUNT : uses
    USER ||--o{ MEMBER : joins
    USER ||--o{ INVITATION : sends
    USER o|--o{ SSO_PROVIDER : configures
    USER ||--o{ APIKEY : owns
    USER ||--o| SLACK_MEMBER_MATCH : matches

    ORGANIZATION ||--o{ MEMBER : includes
    ORGANIZATION ||--o{ INVITATION : issues
    ORGANIZATION ||--o{ XMPP_AGENT_TASK : owns

    USER {
        string id PK
        string name
        string email
        boolean emailVerified
    }

    SESSION {
        string id PK
        string userId FK
        string token
        datetime expiresAt
    }

    ACCOUNT {
        string id PK
        string userId FK
        string providerId
        string accountId
    }

    VERIFICATION {
        string id PK
        string identifier
        string value
        datetime expiresAt
    }

    RATE_LIMIT {
        string id PK
        string key
        int count
    }

    ORGANIZATION {
        string id PK
        string name
        string slug
    }

    WORKSPACE_PROFILE {
        string id PK
        string website
        string narrative
        json sections
    }

    MEMBER {
        string id PK
        string organizationId FK
        string userId FK
        string role
    }

    INVITATION {
        string id PK
        string organizationId FK
        string inviterId FK
        string email
        string role
        string status
    }

    SSO_PROVIDER {
        string id PK
        string userId FK
        string organizationId
        string providerId
        string domain
    }

    APIKEY {
        string id PK
        string referenceId FK
        string key
        boolean enabled
    }

    SLACK_MEMBER_MATCH {
        string id PK
        string crmUserId FK
        string slackUserId
        string slackHandle
    }

    SLACK_CHANNEL {
        string id PK
        string name
        boolean available
        boolean isPrivate
    }

    SLACK_INSTALLATION {
        string installerId PK
        string teamId
        string userToken
        string userScopes
    }

    SLACK_WORKSPACE_GRANT {
        string id PK
        string teamId
        string userToken
        string userScopes
    }

    APP_SETTING {
        string id PK
        string agentModelId
        string reportingCurrency
        boolean trackingPaused
    }

    INSTALL {
        string id PK
        string uuid
        string version
    }

    TELEMETRY_MILESTONE {
        string step PK
        datetime reachedAt
    }

    TELEMETRY_COUNTER {
        string name PK
        int count
    }
```

The following models are independent stores with no declared Prisma relation: `SlackChannel`, `SlackInstallation`, `SlackWorkspaceGrant`, `Verification`, `RateLimit`, `WorkspaceProfile`, `AppSetting`, `Install`, `TelemetryMilestone`, and `TelemetryCounter`.

`SsoProvider.organizationId` is a scalar field without a declared relation to `Organization`.

## GC POC boundary

The first GC flow directly depends on these physical models:

```mermaid
flowchart LR
    Company --> Deal
    User --> Deal
    Contact --> DealContact --> Deal
    Deal --> Activity
    Deal --> Artifact
    Deal --> Document --> DocumentLineItem
    Deal --> AgentConversation
    Deal --> AgentRun --> AgentAction
```

The physical `Deal` model is Project in the product. Company represents the household or business customer. The construction API requires it for every new Project. Company deletion is blocked while Projects reference it. The PostgreSQL column stays nullable for upstream compatibility.
