# Asset storage operations

CompCRM uses a private Cloudflare R2 bucket for customer and project assets. The API signs short-lived direct transfers. The API never returns R2 credentials to a client.

Set these variables together in the root `.env`:

| Variable | Value |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account ID that owns the bucket. |
| `R2_ACCESS_KEY_ID` | R2 API token access key with object read and write access. |
| `R2_SECRET_ACCESS_KEY` | Secret for the R2 API token. |
| `R2_BUCKET` | Private bucket name. |

All four variables are optional. When one value is missing, the API starts without asset storage. Upload and download grants return `503 STORAGE_UNAVAILABLE`. Metadata lists and deletion-state reads remain available. Do not place these values in a package-local `.env` file.

Create the bucket in Cloudflare R2. Keep public access disabled. Use one bucket for the deployment and keep temporary objects under the `temporary/` prefix. Final object keys stay outside this prefix.

Configure an R2 lifecycle rule for `temporary/` with a seven-day expiration. The rule is a backstop for canceled uploads, expired grants, failed finalization, and writes that arrive after a grant expires. Application cleanup still attempts deletion immediately and records the result. Lifecycle deletion is eventual. See [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

Configure bucket CORS for the application origins that perform direct transfers. A starting policy is:

```json
[
  {
    "AllowedOrigins": ["https://app.jobsteward.ai"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace the origin with every approved web origin. Add a local origin only for local development. Do not use `*` for a production bucket.

The upload flow creates an intent, sends the original bytes to the signed PUT URL, confirms the upload, and polls until `READY`. The signed PUT includes `Content-Type` and `Content-Length`. The finalization worker reads the source ETag and uses conditional copy before it creates an artifact. Downloads use a signed GET with `Content-Disposition: attachment`.

The worker retains deletion records and checks deleted keys again each hour. A late PUT or stalled COPY can recreate an object after an earlier deletion. Reconciliation removes that object again. Keep cleanup records after project purge and after the asset reports `DELETED`.

Temporary uploads consume one of 20 reservations per actor. Cleanup retains reservations for seven days after the latest grant expires. This interval is a cleanup policy, not a verified R2 transfer deadline. Twenty uploads in that interval can block new intents. Temporary cleanup continues after reservation release. Verify the provider's transfer-duration behavior before production use.

Existing artifacts keep `UNVERIFIED` status and unknown storage locations. Inventory their original storage before deployment. Confirm the bucket, key, byte count, and media type before marking a row `READY`. Deleting an unresolved artifact creates durable work with an unknown bucket. Resolve that job's bucket from verified storage evidence. Never assign the new bucket solely because its key matches.

## Release checks against real R2

Run these checks after credentials and the bucket are configured. Fake HTTP tests prove request construction. They do not prove R2 behavior.

1. Upload an empty file and a file at `5363466240` bytes. Confirm each object size and ETag.
2. Reject `5363466241` bytes before creating an upload intent.
3. Send a PUT with the signed content type and length. Repeat with a different content type, a shorter body, a longer body, and an unknown-length body. Confirm the rejected cases do not become ready assets.
4. Start a PUT before the 15-minute grant expiry and finish it after expiry. Record whether R2 accepts or rejects the transfer. This behavior is unknown until this test runs. Do not claim that the URL lifetime limits transfer duration.
5. Reconnect after grant expiry. Confirm a new grant uses the same temporary object and the old grant is not reused.
6. Change the temporary object's ETag before finalization. Confirm conditional copy fails and no final artifact is created.
7. Confirm the final key cannot be written with the upload grant. Confirm GET grants use attachment disposition and honor range requests.
8. Cancel an upload with an existing grant. Confirm immediate cleanup is attempted, the reservation remains until cleanup resolves, and the lifecycle rule removes late temporary writes.
9. Run the scheduled cleanup and inspect retry state after a transient R2 failure. Confirm deletion remains visible until R2 confirms removal.
10. Verify the bucket is private and that an unauthenticated request cannot read a final object.

Record the date, bucket, region `auto`, SDK version, test object keys, and R2 responses in the release evidence. Remove test objects after verification. Do not include credentials or signed URLs in the evidence.

Use the [R2 presigned URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/), and [R2 upload limits](https://developers.cloudflare.com/r2/platform/limits/) as the release references.
