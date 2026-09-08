---
title: Customer and project asset API
status: implemented-pending-r2-verification
updated: 2026-09-07
---

# Customer and project asset API

This contract defines the implemented customer and project asset API. Production configuration and real R2 checks remain release requirements.
See [storage operations](./assets-storage-operations.md) for configuration and release checks.
Transcription, mobile implementation, mailbox fetching, customer matching, and project creation remain outside this API.

## Common contract

Base URL: `https://api.jobsteward.ai/rest/v1`.
All paths below are relative to this base. All CRM requests and responses use JSON.
Returned `statusUrl` values are origin-relative. Resolve them against `https://api.jobsteward.ai`, without adding `/rest/v1` again.
The API transfers metadata only. Callers transfer original file bytes directly to private R2 storage.
Any file format is accepted. No filename extension or media-type allowlist applies.

Public names are `customerId`, `projectId`, and `assetId`.
They map to `Company.id`, `Deal.id`, and `Artifact.id`.
Each asset has one required project. Resolve its customer through `Deal.companyId`.
The caller cannot set `customerId`, `storageKey`, uploader identity, or a storage URL in a mutation body.
Never select a customer's newest project automatically.

Use existing CRM authentication and principal resolution. OAuth callers send `Authorization: Bearer <access-token>`.
GET operations require `crm.read`. POST and DELETE operations require `crm.write`.
Existing session and API-key callers retain their current admission rules. Never embed a shared API key in mobile clients.
Check record access on every operation, including retries. Missing or inaccessible records return `404 RESOURCE_NOT_FOUND`.
Use the [OAuth implementation guide](./oauth-oidc-crm-implementation.md) for OAuth configuration.

IDs are opaque nonempty strings, at most 128 characters. Timestamps use RFC 3339 UTC.
Optional input fields can be omitted. Nullable fields accept null. Responses include documented nullable fields as null.
Reject unknown mutation fields to catch misspelled identifiers.
Clients ignore unknown response fields for additive compatibility.
Return `Cache-Control: private, no-store` and `X-Request-Id` on all asset API responses.
Accept an optional client `X-Request-Id`; generate one when absent or invalid.

All successful operations return `200 OK` with the defined JSON body, matching the existing REST bridge's default status.
Success on a state-changing request means the durable state change is accepted. Inspect status for background completion.

## Endpoints

| ID | Method | Path | Purpose |
| --- | --- | --- | --- |
| E1 | POST | `/projects/{projectId}/asset-uploads` | Create an upload intent. |
| E2 | GET | `/projects/{projectId}/asset-uploads/{uploadId}` | Read durable upload state. |
| E3 | POST | `/projects/{projectId}/asset-uploads/{uploadId}/url` | Renew a pending upload URL. |
| E4 | POST | `/projects/{projectId}/asset-uploads/{uploadId}/confirm` | Start file verification and finalization. |
| E5 | DELETE | `/projects/{projectId}/asset-uploads/{uploadId}` | Cancel a pending or failed upload. |
| E6 | GET | `/customers/{customerId}/assets` | List assets across the customer's projects. |
| E7 | GET | `/projects/{projectId}/assets` | List one project's assets. |
| E8 | GET | `/projects/{projectId}/assets/{assetId}` | Read asset metadata and deletion state. |
| E9 | GET | `/projects/{projectId}/assets/{assetId}/download` | Obtain temporary file access. |
| E10 | DELETE | `/projects/{projectId}/assets/{assetId}` | Delete one asset and its stored file. |

E1, E3, E4, E5, and E10 require `Idempotency-Key`.

## E1: Create an upload

Request example:

```json
{
  "fileName": "bathroom-visit.mp3",
  "contentType": "audio/mpeg",
  "sizeBytes": 57600000,
  "kind": "meeting_recording",
  "source": "MOBILE_RECORDING",
  "activityId": null,
  "durationMilliseconds": 3600000,
  "capturedAt": "2026-07-15T15:00:00Z",
  "emailSource": null
}
```

| Field | Type | Rule |
| --- | --- | --- |
| `fileName` | string | Required display name, 1–255 characters. Reject path separators and control characters. Never use it as an object key. |
| `contentType` | string | Optional, at most 255 characters. Default `application/octet-stream`. Treat it as caller metadata, not verified content. |
| `sizeBytes` | integer | Required, zero or greater, within the selected upload method's byte limit. Empty files are valid assets. |
| `kind` | string | Optional descriptive label, 1–64 characters. Default `file`. Examples include `meeting_notes`, `evidence`, and `reference`. No fixed category list. |
| `source` | enum | Required: `MANUAL`, `MOBILE_RECORDING`, or `EMAIL_ATTACHMENT`. These values describe origin, not accepted formats. |
| `activityId` | string or null | Optional `Activity.id`. Its type must be `MEETING` and its non-null `dealId` must equal the project. |
| `durationMilliseconds` | integer or null | Optional nonnegative duration. No one-hour duration cap. |
| `capturedAt` | timestamp or null | Optional capture time. Separate from the server upload time. |
| `emailSource` | object or null | Required only for `EMAIL_ATTACHMENT`. Fields are `messageId` and `attachmentId`, each a nonempty string up to 255 characters. |

`emailSource.messageId` is the internal CRM `EmailMessage.id`.
`attachmentId` identifies one attachment occurrence within that message. Intake computes it before calling the asset service.
For Gmail, use `gmail-part:<partId>`. Google defines `MessagePart.partId` as immutable within its message.
For a raw MIME importer, use `mime-part:<path>`, with the zero-based nested part path from the immutable message.
Persist this identity with the email source record. Retries reuse it, including attachments whose bytes match another attachment.
Do not use a download token, filename, or byte hash alone as attachment identity.
Other intake adapters must supply a persisted occurrence identity before importing through this API.
Source: [Gmail message-part identity](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages#MessagePart).

Reject non-null `emailSource` for other sources. Verify access to the referenced email before creating an intent.
The existing thread association is `EmailMessage.thread → EmailThread.activity → Activity.dealId`.
Treat that thread project as an intake hint, not the destination of every attachment in later messages.
The caller supplies the exact project. A non-null `EmailThread.companyId` must match that project's customer.
An unbound thread requires an explicit project selected by the authorized caller or resolved by intake.
The first import records an attachment-level project binding in `AssetEmailSource`.
Later imports of that same attachment must use its recorded project or return `409 PROJECT_MISMATCH`.
Never change the thread association during an asset upload.

An accessible non-meeting activity, null activity project, or different activity project returns `409 PROJECT_MISMATCH`.
An inaccessible activity returns `404 RESOURCE_NOT_FOUND`.
E1 and E3 reject archived projects with `409 PROJECT_ARCHIVED`; restore the project before starting or renewing uploads.
E4 also rejects an archived project before accepting finalization. E2 and E5 remain available.
Work accepted before archiving can finish, subject to the existing project-purge checks.

### Import attribution

User-authenticated API calls record the principal's user ID in `uploadedById`, including manually imported email files.
Scheduled email intake calls the shared asset service in-process with a trusted `SYSTEM` actor, not a forged user token.
The service verifies the stored mailbox owner and resolved project context. Request bodies cannot select a system actor.
System imports set `uploadedById: null`. Preserve the source message and mailbox owner in the internal audit record.
`CRON_SECRET` protects internal scheduler routes only. It does not authorize E1 through E10.
Public callers and internal intake use the same validation, source deduplication, and upload-state service.

The API stores expected metadata and a generated temporary object key before returning the grant.
The intent expires 24 hours after creation. URL renewal does not extend that deadline.

Response example:

```json
{
  "upload": {
    "id": "upload_123",
    "customerId": "company_alice",
    "projectId": "deal_bathroom_2026",
    "status": "PENDING",
    "expiresAt": "2026-09-08T15:00:00Z",
    "assetId": null,
    "failure": null
  },
  "transfer": {
    "method": "PUT",
    "url": "https://example.r2.cloudflarestorage.com/private/temporary-object?signature=example",
    "headers": { "Content-Type": "audio/mpeg", "Content-Length": "57600000" },
    "expiresAt": "2026-09-07T15:15:00Z",
    "maxBytes": 5363466240
  }
}
```

The example URL is illustrative and cannot authorize a request.
`transfer` is nullable: it is null when email deduplication resolves to a finalized upload.
Send raw bytes with every returned header. Do not send the CRM bearer token to R2.
Bind the expected `Content-Length` into the PUT signature. HTTP clients can supply the equivalent header automatically.
Verify rejection of shorter, longer, and unknown-length bodies against real R2 before release.
Signed length does not replace final object existence, byte-count, and copy checks.
The caller confirms through E4 after R2 returns a successful PUT response.

V1 uses single-request PUT uploads. The maximum is 5 GiB minus 5 MiB, or `5363466240` bytes.
This follows the current R2 upload-limit footnote. It is a transport limit, not a restriction on file formats.
Requests above that limit return `413 UPLOAD_TOO_LARGE` before an intent is created.
There is no recording-duration restriction or separate photo/document cap.
Multipart upload is outside this V1 contract. Verify the exact byte boundary against R2 before release.
Source: [Cloudflare R2 limits](https://developers.cloudflare.com/r2/platform/limits/).

## E2: Read upload state

Return `{"upload": <Upload>, "pollAfterSeconds": <integer-or-null>}`.
The `Upload` schema is the object shown in E1. Every nullable field is present.
For `FINALIZING`, return `pollAfterSeconds: 3`. Otherwise return null.
The failure value is null or `{"code": "UPLOAD_VERIFICATION_FAILED", "message": "Stored size differs from declared size."}`.
Messages contain no provider response, private object key, or credentials.
Status does not claim upload progress. A completed R2 PUT remains `PENDING` until E4 is accepted.

| State | Meaning | Allowed action |
| --- | --- | --- |
| `PENDING` | Intent accepts file transfer before expiry. | Renew URL, confirm, or cancel. |
| `FINALIZING` | Durable backend work verifies and finalizes the file. | Poll E2. |
| `READY` | Exactly one confirmed artifact exists. `assetId` is non-null. | Read the artifact. |
| `FAILED` | Verification or finalization ends with a terminal failure. | Start a replacement upload or cancel. |
| `CANCELED` | The caller cancels the intent. Temporary cleanup is scheduled. | Start a new upload. |
| `EXPIRED` | The pending intent reaches its deadline. Temporary cleanup is scheduled. | Start a new upload. |

States are monotonic except internal retries within `FINALIZING`.
An intent accepted for finalization before expiry can finish after its deadline.
Store terminal upload status for at least seven days after completion or expiry, then permit `404` after cleanup.
Access to an upload also requires access to its current project. Deleted projects return `404`.

## E3: Renew the upload URL

Request body: `{}`. Return the same E1 response shape.
Issue a fresh URL for the same temporary key only while status is `PENDING` and the intent remains valid.
The URL expires after 15 minutes or at intent expiry, whichever comes first.
This is grant validity, not a claimed maximum transfer duration.
Test a slow R2 PUT that starts before URL expiry and finishes after expiry, plus a reconnect after expiry.
R2 behavior remains unverified. Do not infer a 15-minute transfer cutoff or add size-based expiry without that evidence.
Use a new idempotency key for each logical renewal. Retries of that renewal reuse its key.
No new upload record, artifact, project binding, or metadata is created.

## E4: Confirm the upload

Request body: `{}`.
Return `{"uploadId": "upload_123", "statusUrl": "/rest/v1/projects/deal_bathroom_2026/asset-uploads/upload_123"}`.
Acceptance atomically changes `PENDING` to `FINALIZING` and records durable finalization work.
Repeat confirmation for `FINALIZING` or `READY` returns the same acknowledgement without another job or artifact.
Confirming `FAILED`, `CANCELED`, or `EXPIRED` returns `409 UPLOAD_STATE_CONFLICT` with `details.state` set to that state.

Finalization performs these operations:

1. Recheck that the project exists and no project purge or upload cancellation supersedes the work.
2. Read the object's byte count and ETag. Missing or mismatched bytes cause a terminal verification failure.
3. Copy the checked object into a generated final key, conditioned on the observed source ETag.
4. Verify the final object, then commit one artifact and `READY` state through a database transaction.
5. Schedule temporary-object cleanup. Preserve the final key for download grants only.

The final key never receives a client PUT grant. Reusing the upload URL cannot overwrite the confirmed artifact.
A timeout has an unknown result. Reconcile the final object and database state before another copy or insert.
An ETag is an object identity check, not a promised SHA-256 checksum.
R2 and PostgreSQL do not share a transaction. Use one stable final key, durable work, and retry-safe reconciliation.
Source: [R2 conditional copy support](https://developers.cloudflare.com/r2/api/s3/api/).

Confirmation stores an asset only. It does not start transcription or claim a transcription status.

## E5: Cancel the upload

No request body. Return `{"uploadId": "upload_123", "status": "CANCELED"}`.
Cancel `PENDING` or `FAILED`; repeated cancellation returns the same result.
`FINALIZING` and `READY` return `409 UPLOAD_STATE_CONFLICT`. Delete the resulting asset through E10 after finalization.
`EXPIRED` returns `409 UPLOAD_STATE_CONFLICT` with `details.state: "EXPIRED"`.
Serialize confirmation and cancellation so only one transition wins.
Cancellation blocks confirmation immediately. An issued R2 PUT grant remains usable until its expiry.
Attempt immediate temporary-object deletion through durable cleanup work.
The temporary-prefix lifecycle policy also removes late writes made through an already issued grant.
Set temporary-object expiry to seven days. Keep final objects outside that prefix.
This is eventual cleanup, not immediate revocation or a guaranteed deletion deadline.
Verify late-write cleanup and ensure finalization finishes or fails before its temporary object reaches lifecycle expiry.
Source: [R2 lifecycle behavior](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

## E8: Asset schema and detail

E8 returns `{"asset": <Asset>}`. E6 and E7 return arrays of the same object.

```json
{
  "id": "artifact_123",
  "customerId": "company_alice",
  "projectId": "deal_bathroom_2026",
  "activityId": null,
  "fileName": "bathroom-visit.mp3",
  "contentType": "audio/mpeg",
  "sizeBytes": 57600000,
  "kind": "meeting_recording",
  "source": "MOBILE_RECORDING",
  "emailSource": null,
  "uploadedById": "user_gc",
  "durationMilliseconds": 3600000,
  "capturedAt": "2026-07-15T15:00:00Z",
  "createdAt": "2026-09-07T15:03:00Z",
  "status": "READY",
  "deletedAt": null
}
```

Metadata follows E1 field types, with the migration exceptions below. `createdAt` is the artifact's original creation time.
`uploadedById` is a user ID or null for system imports and unknown historical attribution.
`status` is `UNVERIFIED`, `READY`, `DELETING`, or `DELETED`.
`UNVERIFIED` applies only to pre-existing artifacts awaiting storage inventory. New uploads become artifacts only after verification.
`deletedAt` is non-null only after physical object deletion succeeds.
Do not expose storage keys, access URLs, or transcripts in the asset schema.
The same object key never belongs to two project artifacts.
This API does not move assets between projects or update their source metadata.

### Existing artifact rows

Inventory existing rows and storage locations before deployment. Skip the backfill when no rows exist.
Preserve each existing ID, project, filename, storage key, and creation time.
Do not assume an existing key points to the new R2 bucket.

| Field | Existing-row mapping |
| --- | --- |
| `kind` | Use existing `type` when it fits the kind schema; otherwise use `file`. Preserve original `type` internally. |
| `source`, `uploadedById` | Null unless existing evidence establishes the source or user. Null is response-only for `source`. |
| `sizeBytes` | Null until a storage metadata check supplies the actual byte count. Zero means a verified empty file. |
| `contentType` | Storage metadata when available; otherwise `application/octet-stream`. |
| `activityId`, `emailSource`, `durationMilliseconds`, `capturedAt` | Null unless supported by existing data. |
| `status` | `UNVERIFIED` until the stored object and its location are verified; then `READY`. |

Expose `UNVERIFIED` metadata in lists and E8. E9 returns `409 ASSET_NOT_READY` until verification succeeds.
E10 can accept deletion, but never reports `DELETED` until the storage location is resolved and deletion is confirmed.
A missing or unknown object location requires operator resolution during migration. Never invent readiness or discard its reference.

## E6 and E7: List assets

| Query parameter | Rule |
| --- | --- |
| `page` | Integer, minimum 1. Default 1. |
| `pageSize` | Integer, 1–100. Default 25. |
| `projectId` | Optional on E6 only. Must belong to the path customer. |
| `activityId` | Optional exact activity filter. |
| `kind` | Optional exact kind filter. |
| `source` | Optional source enum filter. |

Return `{"items": [<Asset>], "page": 1, "pageSize": 25, "total": 1, "hasNextPage": false}`.
Sort by `createdAt DESC, id DESC` after applying customer, project, and access filters.
`total` counts filtered `READY` and `UNVERIFIED` artifacts. `hasNextPage` equals `page * pageSize < total`.
Pending uploads and deletion states do not appear in lists. Use E2 or E8 for their status.
Archived projects retain files only until permanent purge, including automatic purge after the configured archive-retention period.
E6 includes accessible archived-project artifacts until purge. E7 supports an archived project's ID until purge.
Pagination is a live listing, not a snapshot. Concurrent inserts can shift page boundaries.
Unknown query parameters return `400 VALIDATION_ERROR`.

## E9: Download or play a recording

Query parameters: none. Return a signed GET URL only for an authorized `READY` asset.

```json
{
  "assetId": "artifact_123",
  "url": "https://example.r2.cloudflarestorage.com/private/final-object?signature=example",
  "method": "GET",
  "headers": {},
  "expiresAt": "2026-09-07T15:30:00Z",
  "fileName": "bathroom-visit.mp3",
  "contentType": "audio/mpeg",
  "sizeBytes": 57600000
}
```

URL lifetime is 15 minutes. The caller requests a fresh URL when needed.
Default storage responses use `Content-Disposition: attachment` with an encoded filename.
Native playback uses the same URL and HTTP Range requests. No recording-specific download endpoint is needed.
Reported media type does not authorize active-content rendering in a browser.
Unknown formats remain downloadable. Format support in a viewer is outside this API.
Presigned URLs expose their object path and grant temporary access. Never log them or claim that their paths are secret.
Use the S3 API domain; no public bucket or public custom domain is required.
Sources: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
[R2 range requests](https://developers.cloudflare.com/r2/api/s3/api/).

## E10: Delete an asset

No request body. Return `{"assetId": "artifact_123", "status": "DELETING"}` when cleanup is pending.
Return the same shape with `DELETED` after cleanup completes.
Mark the artifact `DELETING` and store durable object-deletion work in one database transaction.
Immediately hide it from lists and refuse new download grants. Existing grants stop working after physical deletion.
An accepted deletion does not claim immediate removal from R2 or from previously downloaded client files.
E8 reports `DELETING` until R2 deletion succeeds, then `DELETED` with `deletedAt`.
Retain the deletion record for at least seven days after completion. After that, GET and DELETE can return `404`.
Repeated deletion never schedules duplicate work. A transient R2 error keeps `DELETING` and triggers a server retry.

Permanent project purge uses this cleanup mechanism for every project artifact and pending upload.
Store all object references durably before existing database cascades remove their rows.
Prevent concurrent upload finalization from creating an artifact after project purge.
Finalization and deletion workers reconcile copied objects left by concurrent operations.
No files from another project are removed. Archiving does not delete files immediately.
The existing daily `/internal/archive/prune` job calls `deals.purgeExpired` after the configured retention period.
That automatic purge must enqueue the same storage cleanup as explicit project deletion, before database cascades run.
Use the existing archive-retention setting. Do not add a separate asset-retention setting for archived projects.
Keep the existing rule that a company with projects cannot be purged until those projects are purged.

## Idempotency and email deduplication

`Idempotency-Key` is a nonempty ASCII string, at most 128 characters. A UUID is recommended.
Scope it to principal identity, operation, and canonical path. Store a normalized request hash.
For E1, this key is the client creation-request identifier. No second client upload identifier is required.
The returned server `uploadId` identifies the upload across later operations and outlives the response cache.
Renewal, confirmation, cancellation, and deletion each use their own operation key. Never use one key for the whole upload workflow.
Same key and request replay the first successful response for at least 24 hours.
Different input with the same key returns `409 IDEMPOTENCY_CONFLICT`.
Concurrent attempts produce one durable action. Transient failures before durable acceptance are retryable with the same key.
Perform authentication and current record authorization before response replay.
A replayed URL can be expired. Obtain a fresh grant through E3 with a new renewal key.
State transitions remain idempotent beyond response retention. E2 and E8 provide current status after response replay.

Email imports use `AssetEmailSource`, unique on `(messageId, attachmentId)`, with its immutable destination `projectId`.
It references the current attempt or confirmed artifact and persists independently of the 24-hour response cache.
A repeated source with matching metadata returns the existing upload and no duplicate asset.
A repeated source with different expected metadata returns `409 SOURCE_CONFLICT`.
For `READY`, return the existing `assetId` with `transfer: null`; for `FINALIZING`, return `transfer: null` and poll E2.
After an expired, failed, or canceled attempt, a new key can create one replacement intent without parallel active duplicates.
Deleting an artifact suppresses automatic reimport of that source identity. Reimport is outside V1.
Keep the source-deletion marker while its project and source email exist, even after the asset deletion record expires.
An E1 request for a deleted email source returns `409 SOURCE_DELETED`, without a transfer URL.
Manual reuploads with new idempotency keys are separate assets, even when filenames match.

## Errors

The versioned asset routes use the existing proposed mobile error envelope:

```json
{
  "error": {
    "code": "UPLOAD_TOO_LARGE",
    "message": "The file exceeds the single-upload limit.",
    "requestId": "request_123",
    "retryable": false,
    "details": { "maxBytes": 5363466240 }
  }
}
```

`details` is optional. Validation details use `fields: [{"field": "sizeBytes", "message": "Must be an integer."}]`.
Do not return provider payloads, private email text, stack traces, object keys, or credentials in errors.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid schema, unknown field, or missing idempotency key. |
| 401 | `AUTH_REQUIRED` | Missing, expired, or invalid authentication. |
| 403 | `FORBIDDEN` | Authenticated caller lacks the operation permission or OAuth scope. |
| 404 | `RESOURCE_NOT_FOUND` | Record is absent or inaccessible. |
| 409 | `IDEMPOTENCY_CONFLICT`, `SOURCE_CONFLICT` | Retry identity is reused with different input. |
| 409 | `SOURCE_DELETED` | The email source belongs to an artifact that is deleting or deleted. |
| 409 | `PROJECT_MISMATCH` | Accessible activity, email binding, or project belongs to a different requested parent. |
| 409 | `UPLOAD_STATE_CONFLICT`, `ASSET_NOT_READY` | Operation is unavailable in the current state. Include `details.state`. |
| 409 | `PROJECT_ARCHIVED` | Restore the project before creating, renewing, or confirming an upload. |
| 413 | `UPLOAD_TOO_LARGE` | File exceeds the supported upload method. Include `details.maxBytes`. |
| 429 | `UPLOAD_CAPACITY_EXCEEDED` | Caller has 20 outstanding temporary-object reservations. Retry after `Retry-After: 60`. |
| 503 | `STORAGE_UNAVAILABLE` | R2 configuration is absent or storage is temporarily unavailable. |
| 500 | `INTERNAL_ERROR` | Unexpected backend failure. Reconcile state before retrying a mutation. |

Only 429 and transient 503 errors set `retryable: true`; state errors require the stated recovery action.
An expired upload uses HTTP 409 and `details.state: "EXPIRED"`. No asset route requires HTTP 410.
Unconfigured storage returns 503 with `retryable: false`. Artifact listing and deletion-state reads remain available.
Finalization errors appear through E2 as `FAILED`, with `UPLOAD_VERIFICATION_FAILED` or `UPLOAD_FINALIZATION_FAILED`.
Successful E2 polling remains HTTP 200 even when the stored upload has failed.
Direct R2 errors use R2's response format, not this JSON envelope.
There is no `415 UNSUPPORTED_AUDIO_TYPE` response in this asset API.

## Durable backend work

`AssetStorageJob` stores deterministic file work in PostgreSQL.
Use two operations: `FINALIZE_UPLOAD` and `DELETE_OBJECT`.
Store a unique operation key, upload reference, bucket and object keys, state, attempts, next-attempt time, and last error.
Jobs also carry `leaseUntil` and a lease token. Cleanup references survive project and artifact deletion without cascade.
Retain deletion jobs after successful removal and reconcile their keys hourly. A stalled worker or delayed PUT can recreate an object after an earlier deletion.
The next reconciliation deletes that object again. `DELETED` records the last verified physical removal. Cleanup records remain durable after the public deletion record retention period.
E4 inserts finalization work in the same transaction as `FINALIZING`.
E5, E10, and project purge insert cleanup work in their state-change transactions.

`GET /internal/assets/process` uses `CRON_SECRET` and the existing internal cron pattern.
Schedule it once per minute in the API deployment. It processes bounded batches within the invocation deadline.
Claim due jobs with `FOR UPDATE SKIP LOCKED`. Renew leases during active work and reject state writes from expired lease holders.
After a crash, another invocation reclaims an expired lease and reconciles R2 state before repeating the operation.
Finalization makes at most five failed attempts within 24 hours of confirmation, then records `FAILED` and schedules cleanup.
Deletion retries continue with delay capped at one hour. Persistent failure remains visible in job state and operational logs.
Delay transient retries with exponential backoff. Store every next-attempt time; never depend on an in-process timer.
Process-local promises and agent prompts do not own these jobs. Existing deterministic worker code supplies patterns, not an asset implementation.

`AssetApiRequest` stores results, unique on actor, operation, canonical path, and idempotency key.
Store the request hash, response status and body, and expiry. Commit accepted state changes and their replay record atomically.
Use transaction locking for simultaneous requests. Uncommitted or transiently failed attempts must remain retryable.
Delete expired replay records through the same bounded internal sweep. Keep upload and source identities independently.

### Temporary-upload capacity

Permit at most 20 outstanding temporary-object reservations per actor. Enforce the count transactionally when E1 creates an intent.
An existing-intent replay or E3 renewal consumes no additional reservation.
Count pending, finalizing, and retained temporary objects, including canceled, expired, failed, and ready uploads awaiting temporary cleanup.
Cancellation alone does not release a reservation. The current implementation retains it for seven days after the latest grant expires and verifies object removal before release.
This retention interval is a conservative cleanup policy. It is not evidence that R2 terminates all in-flight PUT requests within seven days.
Temporary deletion jobs continue reconciliation after reservation release. Late objects remain covered by that work and the temporary-prefix lifecycle policy.
The provider transfer-duration boundary remains a release check. Do not describe the reservation count as a hard bound on in-flight transfers or stored bytes.
Use the authenticated user as the public actor. Scheduled email intake uses a server-selected mailbox actor key.
Keep reservation records independently of project deletion until cleanup completes.
This is a retained-reservation limit. Twenty uploads within the retention interval can block new intents until cleanup releases capacity.
It is not a general request-rate limiter or a guaranteed storage-byte budget.
R2 quota failures and operational storage metrics remain separate from this API capacity error.

## Implementation boundaries and acceptance

Use a shared asset service and typed schemas. Keep public REST paths under `/rest/v1`.
The repository currently builds REST routes from tRPC metadata and publishes OpenAPI at `/openapi.json`.
Asset operations use that mechanism. Regenerate router types after changing their schemas. Do not commit generated OpenAPI.
The error middleware maps HTTP 413 and 503 to `PAYLOAD_TOO_LARGE` and `SERVICE_UNAVAILABLE` and preserves the domain error.
The asset response adapter supplies the defined JSON envelope for versioned asset routes. Unversioned routes retain their existing format.
The generated OpenAPI document describes asset request headers and the same error envelope. State conflicts use HTTP 409.
Keep finalization and deletion durable outside the request lifetime. API success cannot depend on process-local background promises.
Use the storage jobs and authenticated cron route defined above. This storage feature does not start intelligence or transcription work.

Verify every endpoint's authorization, schemas, status codes, idempotency, and actual R2 behavior.
Include arbitrary formats, empty files, signed-length enforcement, one-hour recordings, expiry during transfer, and reconnect after expiry.
Test worker crash recovery, idempotency, capacity after cancellation, late lifecycle cleanup, and conditional-copy races.
Test archived-project rejection, automatic retention purge, explicit purge races, system attribution, and existing-row migration.
Prove exact byte-limit handling. Configure production only after target verification and implementation authorization.
The complete backend flow is E1, R2 PUT, E4, E2 until READY, E8/E9, and E10 with deletion-status verification.
