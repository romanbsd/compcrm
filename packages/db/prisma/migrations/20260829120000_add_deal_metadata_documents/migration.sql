BEGIN;

ALTER TABLE "deal"
  ADD COLUMN "leadSource" TEXT,
  ADD COLUMN "projectType" TEXT,
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postalCode" TEXT;

ALTER TABLE "agentRun" ADD COLUMN "dealId" TEXT;
CREATE INDEX "agentRun_dealId_createdAt_idx" ON "agentRun" ("dealId", "createdAt");
ALTER TABLE "agentRun"
  ADD CONSTRAINT "agentRun_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "artifact" (
  "id" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "artifact_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "artifact_dealId_createdAt_idx" ON "artifact" ("dealId", "createdAt");
ALTER TABLE "artifact"
  ADD CONSTRAINT "artifact_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "document" (
  "id" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "issuedAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "recipientSnapshot" JSONB NOT NULL,
  "contractorSnapshot" JSONB NOT NULL,
  "projectSnapshot" JSONB NOT NULL,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "tax" DECIMAL(14,2) NOT NULL,
  "total" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "document_dealId_createdAt_idx" ON "document" ("dealId", "createdAt");
ALTER TABLE "document"
  ADD CONSTRAINT "document_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "documentLineItem" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(14,2) NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "total" DECIMAL(14,2) NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "documentLineItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "documentLineItem_documentId_position_idx"
  ON "documentLineItem" ("documentId", "position");
ALTER TABLE "documentLineItem"
  ADD CONSTRAINT "documentLineItem_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
