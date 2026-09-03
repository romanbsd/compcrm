# CompCRM API — `GET /home`

**Audience:** engineers and agents implementing CompCRM (`apps/api`).

**Consumer:** JobSteward mobile (`lib/api/home_client.dart`, `lib/api/home_models.dart`).

**Related product spec:** [`JOBSTEWARD_HOME_SCREEN_SPEC.md`](JOBSTEWARD_HOME_SCREEN_SPEC.md)

---

## 1. Purpose

Expose one **curated command snapshot** for the signed-in workspace owner/operator.

The mobile Home screen is not a CRM dashboard. It answers three questions in under five seconds:

1. Do I need to do anything right now?
2. Which jobs need me most?
3. What is moving without me?

`GET /home` returns everything required for a single pull-to-refresh. The mobile client does **not** compose this screen from multiple CRM endpoints.

---

## 2. Endpoint

| Method | Path | Auth | Query |
|--------|------|------|-------|
| `GET` | `/home` | Bearer OAuth (`crm.read`) | none |

### Security

Use the existing CompCRM OAuth bearer scheme already defined in OpenAPI:

```text
Authorization: Bearer <access_token>
```

- Required scope: **`crm.read`** (minimum).
- Resolve the workspace and user from the same `RequestPrincipal` used by `GET /auth/me`.
- Return **`401`** when unauthenticated, **`403`** when authenticated but not permitted for the workspace.

Cookie and API-key auth may remain supported for parity with other routes, but JobSteward mobile calls this with OAuth bearer tokens only.

### Caching

- No client-side query parameters.
- Server may cache per `(workspaceId, userId)` briefly (e.g. 15–30 s) if needed for performance.
- Response must be safe to refresh on every pull-to-refresh without side effects.

---

## 3. Do not substitute existing endpoints

These paths exist in CompCRM today but **must not** be used to fake `/home`:

| Existing route | Why it is wrong for Home |
|----------------|--------------------------|
| `GET /dashboard/summary` | Sales KPIs (pipeline stages, win rate, revenue trend). Home forbids analytics cards. |
| `GET /activities/my-tasks` | CRM tasks with `dueAt`. Not owner decisions (proposals, allowances, customer updates). |
| `POST /deals/search` | Sales deal stages (`DEMO_BOOKED`, …). JobSteward project lifecycle is construction-oriented (`discovery`, `proposal`, …). |
| `GET /agents/{id}/history` | Per-agent run history; requires agent id; includes tool-approval gates, not curated owner attention. |
| `GET /agents/{id}/activity` | Agent-definition audit log, not human-readable “recent work.” |
| `GET /conversations` | Chat/builder sessions. Not Inbox. |

`/home` is a **new read model** assembled server-side from JobSteward domain data (projects, agent actions, notifications, documents, etc.).

---

## 4. Response — top level

`200 application/json`

```json
{
  "activeProjectCount": 5,
  "attentionCount": 3,
  "unreadNotificationCount": 3,
  "attention": [ /* AttentionItem[], max 3 */ ],
  "projects": [ /* ProjectSummary[], max 3 */ ],
  "recentWork": [ /* ActivitySummary[], max 3 */ ]
}
```

### Count semantics

| Field | Meaning | Used by mobile for |
|-------|---------|-------------------|
| `activeProjectCount` | Total non-archived active projects in the workspace visible to this user | Operating summary: “5 active projects” |
| `attentionCount` | Total items requiring **owner action** across the workspace | Operating summary emphasis; Inbox tab badge |
| `unreadNotificationCount` | Total unread **awareness** notifications (not actionable inbox items) | Header bell badge (`9+` cap is client-side) |

Rules:

- `attention.length` ≤ `min(attentionCount, 3)` — preview only; full list belongs on Inbox (future).
- `projects.length` ≤ `min(activeProjectCount, 3)` — preview only; full list belongs on Projects (future).
- `recentWork.length` ≤ 3.
- **`attentionCount` and `unreadNotificationCount` must not be conflated.** They measure different queues.

---

## 5. Types

### 5.1 `HomeActor`

```json
{
  "id": "agent_pm",
  "name": "Bob",
  "role": "projectManager"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Stable actor id (agent definition id or system actor id) |
| `name` | string | yes | Display name, e.g. `Bob`, `Secretary`, `CFO` |
| `role` | enum | yes | Drives dot color in mobile UI — do not overload with free text |

**`role` enum:** `secretary` | `projectManager` | `cfo` | `system`

### 5.2 `AttentionItem`

One concrete decision the owner must make. Not a generic task row.

```json
{
  "id": "att_1",
  "projectId": "prj_1",
  "projectName": "Carter Primary Bath",
  "actor": { "id": "agent_pm", "name": "Bob", "role": "projectManager" },
  "title": "Proposal ready for approval",
  "keyValue": "$42,800",
  "supportingText": "Scope and pricing are complete.",
  "actionLabel": "Review proposal",
  "action": "reviewProposal",
  "createdAt": "2026-08-31T11:12:00.000Z",
  "priority": "customerApproval"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Stable attention item id |
| `projectId` | string | yes | Target project |
| `projectName` | string | yes | Denormalized for list rendering |
| `actor` | HomeActor | yes | Who is asking |
| `title` | string | yes | Decision-oriented headline. Human language, not workflow ids. |
| `keyValue` | string \| null | no | Primary context: money (`$42,800`) or facts (`6 progress photos · 2 open issues`) |
| `supportingText` | string \| null | no | One optional sentence; max ~2 lines worth of copy |
| `actionLabel` | string | yes | Button/link label, e.g. `Review proposal`, `Reply` |
| `action` | enum | yes | Semantic action for future deep-link routing |
| `createdAt` | string (ISO-8601) | yes | Used for relative timestamps (`8 min`, `1 hr`) |
| `priority` | enum | yes | Server ranking input — see §7 |

**`action` enum:** `reviewProposal` | `reviewUpdate` | `reply` | `approveChangeOrder` | `reviewExpense` | `selectSubcontractor` | `reviewPayment` | `other`

**`priority` enum:** `blocked` | `customerApproval` | `financial` | `schedule` | `ordinary`

Content rules (from mobile spec §31):

- Good: `Proposal ready for approval`, `Today's customer update is ready`
- Bad: `Task #1024 awaiting processing`, `Workflow transitioned to approval_pending`
- Do not prefix copy with “AI”.

Money in `keyValue`: format for display (mobile does not re-format). Use workspace reporting currency when showing a single amount.

### 5.3 `ProjectSummary`

Compact project preview for Home (not the full Projects list).

```json
{
  "id": "prj_2",
  "name": "Martinez Kitchen Remodel",
  "customerName": "Maria Martinez",
  "lifecycle": "discovery",
  "operationalState": "Meeting today · 3:30 PM",
  "needsUserAttention": false
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Project id |
| `name` | string | yes | Project name |
| `customerName` | string | yes | Primary customer display name |
| `lifecycle` | enum | yes | Construction lifecycle — **not** CRM deal stage |
| `operationalState` | string | yes | One human-readable fact: schedule, approval wait, permit status, etc. |
| `needsUserAttention` | boolean | yes | `true` when an attention item exists for this project; UI shows subtle dot |

**`lifecycle` enum:** `discovery` | `proposal` | `preConstruction` | `inProgress` | `finishing`

Display labels (mobile responsibility, listed here for alignment):

| Value | Label |
|-------|-------|
| `discovery` | Discovery |
| `proposal` | Proposal |
| `preConstruction` | Pre-Construction |
| `inProgress` | In Progress |
| `finishing` | Finishing |

When a project already appears in `attention`, avoid duplicating the same warning loudly in `operationalState`. Prefer a neutral fact or a subtle “Waiting for your approval” if still appropriate.

### 5.4 `ActivitySummary`

Recent autonomous staff activity — not agent performance metrics.

```json
{
  "id": "act_1",
  "actor": { "id": "agent_sec", "name": "Secretary", "role": "secretary" },
  "description": "Handled 6 customer conversations today",
  "occurredAt": "2026-08-31T10:00:00.000Z",
  "projectId": null
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Activity row id |
| `actor` | HomeActor | yes | Which staff member did the work |
| `description` | string | yes | Past-tense operational sentence |
| `occurredAt` | string (ISO-8601) | yes | When the work happened |
| `projectId` | string \| null | no | Optional link target for future navigation |

---

## 6. Ordering and curation

### Attention (`attention` array)

Server-ranked. **Do not sort by `createdAt` alone.**

Rank by `priority`, then by business urgency within tier:

1. `blocked`
2. `customerApproval`
3. `financial`
4. `schedule`
5. `ordinary`

Return at most **3** items. Set `attentionCount` to the **total** actionable count, which may exceed 3.

### Projects (`projects` array)

Return at most **3** previews. Suggested ordering:

1. Projects with open attention items for this user
2. Schedule-sensitive projects (meetings/walkthroughs today)
3. Recently active projects

Set `activeProjectCount` to the total active project count, not the preview length.

### Recent work (`recentWork` array)

Return at most **3** items, newest `occurredAt` first. Prefer cross-agent variety (Secretary, PM, CFO) when possible so Home reinforces “the team is working.”

---

## 7. Empty and partial states

### New business (no projects)

```json
{
  "activeProjectCount": 0,
  "attentionCount": 0,
  "unreadNotificationCount": 0,
  "attention": [],
  "projects": [],
  "recentWork": []
}
```

Mobile shows “Start your first project” in the Projects section.

### Operating business, nothing needs owner

```json
{
  "activeProjectCount": 5,
  "attentionCount": 0,
  "unreadNotificationCount": 0,
  "attention": [],
  "projects": [ /* up to 3 previews */ ],
  "recentWork": [ /* up to 3 rows */ ]
}
```

Mobile shows “Nothing needs you right now” in the attention section but still renders projects and recent work.

---

## 8. Errors

Use existing CompCRM error envelopes (`docs/compcrm-openapi.json` → `components.schemas.error.*`):

| Status | When |
|--------|------|
| `401` | Missing/invalid bearer token |
| `403` | Valid token but no workspace access |
| `500` | Unexpected server failure |

Example:

```json
{
  "code": "UNAUTHORIZED",
  "message": "Authorization not provided"
}
```

There are **no per-section partial payloads**. If assembly fails, return an error for the whole request. The mobile client keeps the last successful snapshot when refreshing offline or after a transient failure.

---

## 9. Reference response (acceptance fixture)

This payload matches [`JOBSTEWARD_HOME_SCREEN_SPEC.md`](JOBSTEWARD_HOME_SCREEN_SPEC.md) §36 and the mobile test fixture in `lib/home/home_fixtures.dart`.

```json
{
  "activeProjectCount": 5,
  "attentionCount": 3,
  "unreadNotificationCount": 3,
  "attention": [
    {
      "id": "att_carter_proposal",
      "projectId": "prj_carter",
      "projectName": "Carter Primary Bath",
      "actor": { "id": "bob", "name": "Bob", "role": "projectManager" },
      "title": "Proposal ready for approval",
      "keyValue": "$42,800",
      "supportingText": "Scope and pricing are complete.",
      "actionLabel": "Review proposal",
      "action": "reviewProposal",
      "createdAt": "2026-08-31T11:12:00.000Z",
      "priority": "customerApproval"
    },
    {
      "id": "att_johnson_update",
      "projectId": "prj_johnson",
      "projectName": "Johnson Kitchen + Living",
      "actor": { "id": "bob", "name": "Bob", "role": "projectManager" },
      "title": "Today's customer update is ready",
      "keyValue": "6 progress photos · 2 open issues",
      "supportingText": null,
      "actionLabel": "Review update",
      "action": "reviewUpdate",
      "createdAt": "2026-08-31T10:48:00.000Z",
      "priority": "ordinary"
    },
    {
      "id": "att_martinez_allowance",
      "projectId": "prj_martinez",
      "projectName": "Martinez Kitchen Remodel",
      "actor": { "id": "bob", "name": "Bob", "role": "projectManager" },
      "title": "Choose the countertop allowance",
      "keyValue": null,
      "supportingText": "Bob needs one number before finishing the estimate.",
      "actionLabel": "Reply",
      "action": "reply",
      "createdAt": "2026-08-31T10:00:00.000Z",
      "priority": "financial"
    }
  ],
  "projects": [
    {
      "id": "prj_martinez",
      "name": "Martinez Kitchen Remodel",
      "customerName": "Maria Martinez",
      "lifecycle": "discovery",
      "operationalState": "Meeting today · 3:30 PM",
      "needsUserAttention": false
    },
    {
      "id": "prj_carter",
      "name": "Carter Primary Bath",
      "customerName": "Sarah Carter",
      "lifecycle": "proposal",
      "operationalState": "Waiting for your approval",
      "needsUserAttention": true
    },
    {
      "id": "prj_wilson",
      "name": "Wilson Home Addition",
      "customerName": "Mark Wilson",
      "lifecycle": "preConstruction",
      "operationalState": "Permit pending · Deposit paid",
      "needsUserAttention": false
    }
  ],
  "recentWork": [
    {
      "id": "rw_secretary_calls",
      "actor": { "id": "secretary", "name": "Secretary", "role": "secretary" },
      "description": "Handled 6 customer conversations today",
      "occurredAt": "2026-08-31T09:00:00.000Z",
      "projectId": null
    },
    {
      "id": "rw_cfo_deposit",
      "actor": { "id": "cfo", "name": "CFO", "role": "cfo" },
      "description": "Recorded Wilson's $18,500 deposit",
      "occurredAt": "2026-08-31T08:30:00.000Z",
      "projectId": "prj_wilson"
    },
    {
      "id": "rw_bob_report",
      "actor": { "id": "bob", "name": "Bob", "role": "projectManager" },
      "description": "Prepared Johnson's daily project report",
      "occurredAt": "2026-08-31T08:00:00.000Z",
      "projectId": "prj_johnson"
    }
  ]
}
```

---

## 10. Suggested CompCRM implementation shape

Recommended module layout in `apps/api`:

```text
src/home/
  home.module.ts
  home.router.ts          # GET /home
  home.service.ts         # assemble snapshot
  home.contracts.ts       # Zod/io-ts schemas matching §5
  home.repository.ts      # queries across project/attention/notification stores
```

Implementation notes:

1. **Auth** — reuse `@Principal() principal: RequestPrincipal` like `AuthController.getMe`.
2. **Workspace scope** — every query filters by the principal's workspace membership.
3. **Attention source** — derive from JobSteward action queue (agent runs awaiting owner approval, document reviews, allowance questions, etc.). Do not expose raw `WAITING_FOR_APPROVAL` agent-run rows directly.
4. **Project source** — JobSteward project records with construction lifecycle, not raw `Deal.stage`.
5. **Recent work** — aggregate human-readable summaries from agent activity feed, secretary call handling, CFO postings, PM reports.
6. **Notifications** — separate store/table from actionable inbox items; only the count is needed on Home today.
7. **OpenAPI** — add this route to the generated spec consumed by JobSteward (`docs/compcrm-openapi.json` in the mobile repo).

---

## 11. Acceptance criteria

- [ ] `GET /home` registered at workspace API root (`/home`, not `/api/home`).
- [ ] Bearer token with `crm.read` returns `200` with schema in §4–§5.
- [ ] Unauthenticated requests return `401` with standard error envelope.
- [ ] `attention` length ≤ 3; `attentionCount` reflects total actionable items.
- [ ] `projects` length ≤ 3; `activeProjectCount` reflects total active projects.
- [ ] `recentWork` length ≤ 3.
- [ ] Attention ordering follows §6 priority tiers, not created-at desc only.
- [ ] `attentionCount` ≠ `unreadNotificationCount` unless coincidentally equal.
- [ ] Empty workspace returns zeros and empty arrays (§7).
- [ ] Copy uses human operational language (§5.2 content rules).
- [ ] Mobile client parses response without code changes (`HomeSnapshot.fromJson`).
- [ ] Route documented in CompCRM OpenAPI export.

---

## 12. Mobile client contract (frozen)

JobSteward parses this endpoint in:

- `lib/api/home_client.dart` — `GET /home`
- `lib/api/home_models.dart` — JSON → typed models

Any additive fields are allowed if ignored by the client. **Do not rename or change the type of existing fields** without coordinating a mobile release.

Greeting name comes from a separate call: `GET /auth/me` → `user.name` (first token = first name). `/home` does not need to repeat profile fields.

---

## 13. OpenAPI fragment (add to CompCRM export)

```yaml
/home:
  get:
    operationId: home-snapshot
    tags: [Home]
    security:
      - oauth: []
    responses:
      '200':
        description: Curated JobSteward Home command snapshot for the signed-in user.
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/HomeSnapshot'
      '401':
        $ref: '#/components/responses/Unauthorized'
      '403':
        $ref: '#/components/responses/Forbidden'
```

Define `HomeSnapshot`, `AttentionItem`, `ProjectSummary`, `ActivitySummary`, and `HomeActor` component schemas mirroring §5.
