CREATE TYPE "AssetSource" AS ENUM ('MANUAL', 'MOBILE_RECORDING', 'EMAIL_ATTACHMENT');

CREATE TYPE "AssetStatus" AS ENUM ('UNVERIFIED', 'READY', 'DELETING', 'DELETED');

CREATE TYPE "AssetUploadStatus" AS ENUM ('PENDING', 'FINALIZING', 'READY', 'FAILED', 'CANCELED', 'EXPIRED');

CREATE TYPE "AssetJobOperation" AS ENUM ('FINALIZE_UPLOAD', 'DELETE_OBJECT');

CREATE TYPE "AssetJobState" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE');

ALTER TABLE "artifact" ADD COLUMN     "activityId" TEXT,
ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "durationMilliseconds" BIGINT,
ADD COLUMN     "emailAttachmentId" TEXT,
ADD COLUMN     "emailMessageId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'file',
ADD COLUMN     "sizeBytes" BIGINT,
ADD COLUMN     "source" "AssetSource",
ADD COLUMN     "status" "AssetStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "storageBucket" TEXT,
ADD COLUMN     "uploadedById" TEXT;

CREATE TABLE "assetUpload" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "mailboxOwnerId" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" "AssetSource" NOT NULL,
    "activityId" TEXT,
    "durationMilliseconds" BIGINT,
    "capturedAt" TIMESTAMP(3),
    "emailMessageId" TEXT,
    "emailAttachmentId" TEXT,
    "metadataHash" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "temporaryKey" TEXT NOT NULL,
    "finalKey" TEXT NOT NULL,
    "sourceEtag" TEXT,
    "status" "AssetUploadStatus" NOT NULL DEFAULT 'PENDING',
    "assetId" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "grantExpiresAt" TIMESTAMP(3) NOT NULL,
    "reservationUntil" TIMESTAMP(3) NOT NULL,
    "reservationReleasedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assetUpload_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assetEmailSource" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "metadataHash" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "assetId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "mailboxOwnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assetEmailSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assetStorageJob" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "operation" "AssetJobOperation" NOT NULL,
    "projectId" TEXT NOT NULL,
    "uploadId" TEXT,
    "artifactId" TEXT,
    "bucket" TEXT,
    "objectKey" TEXT NOT NULL,
    "finalKey" TEXT,
    "temporary" BOOLEAN NOT NULL DEFAULT false,
    "state" "AssetJobState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assetStorageJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assetApiRequest" (
    "id" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assetApiRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assetUpload_temporaryKey_key" ON "assetUpload"("temporaryKey");

CREATE UNIQUE INDEX "assetUpload_finalKey_key" ON "assetUpload"("finalKey");

CREATE UNIQUE INDEX "assetUpload_assetId_key" ON "assetUpload"("assetId");

CREATE INDEX "assetUpload_actorKey_reservationReleasedAt_idx" ON "assetUpload"("actorKey", "reservationReleasedAt");

CREATE INDEX "assetUpload_projectId_idx" ON "assetUpload"("projectId");

CREATE INDEX "assetUpload_status_expiresAt_idx" ON "assetUpload"("status", "expiresAt");

CREATE INDEX "assetEmailSource_projectId_idx" ON "assetEmailSource"("projectId");

CREATE UNIQUE INDEX "assetEmailSource_messageId_attachmentId_key" ON "assetEmailSource"("messageId", "attachmentId");

CREATE UNIQUE INDEX "assetStorageJob_operationKey_key" ON "assetStorageJob"("operationKey");

CREATE INDEX "assetStorageJob_state_nextAttemptAt_leaseUntil_idx" ON "assetStorageJob"("state", "nextAttemptAt", "leaseUntil");

CREATE INDEX "assetStorageJob_projectId_idx" ON "assetStorageJob"("projectId");

CREATE INDEX "assetApiRequest_expiresAt_idx" ON "assetApiRequest"("expiresAt");

CREATE UNIQUE INDEX "assetApiRequest_actorKey_operation_path_idempotencyKey_key" ON "assetApiRequest"("actorKey", "operation", "path", "idempotencyKey");

CREATE INDEX "artifact_dealId_status_createdAt_id_idx" ON "artifact"("dealId", "status", "createdAt", "id");

CREATE UNIQUE INDEX "artifact_storageBucket_storageKey_key" ON "artifact"("storageBucket", "storageKey");


UPDATE "artifact" SET "kind" = CASE WHEN length("type") BETWEEN 1 AND 64 THEN "type" ELSE 'file' END;
