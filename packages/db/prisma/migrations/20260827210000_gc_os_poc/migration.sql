BEGIN;

ALTER TABLE "deal" DROP CONSTRAINT "deal_companyId_fkey";
ALTER TABLE "deal" ALTER COLUMN "companyId" DROP NOT NULL;
ALTER TABLE "deal" ALTER COLUMN "stage" DROP DEFAULT;

CREATE TYPE "DealStage_new" AS ENUM ('LEAD', 'ESTIMATING', 'CONTRACTED', 'IN_PROGRESS', 'COMPLETE', 'LOST');

ALTER TABLE "deal"
  ALTER COLUMN "stage" TYPE "DealStage_new"
  USING (
    CASE "stage"::text
      WHEN 'DEMO_BOOKED' THEN 'LEAD'
      WHEN 'QUALIFIED_TO_BUY' THEN 'ESTIMATING'
      WHEN 'UNQUALIFIED_TO_BUY' THEN 'LOST'
      WHEN 'DECISION_MAKER_BOUGHT_IN' THEN 'ESTIMATING'
      WHEN 'CONTRACT_SENT' THEN 'CONTRACTED'
      WHEN 'CLOSED_WON' THEN 'COMPLETE'
      WHEN 'CLOSED_LOST' THEN 'LOST'
    END
  )::"DealStage_new";

DROP TYPE "DealStage";
ALTER TYPE "DealStage_new" RENAME TO "DealStage";
ALTER TABLE "deal" ALTER COLUMN "stage" SET DEFAULT 'LEAD';
ALTER TABLE "deal" ADD CONSTRAINT "deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "activity"
SET "meta" = jsonb_set(
  jsonb_set(
    "meta",
    '{from}',
    CASE "meta"->>'from'
      WHEN 'DEMO_BOOKED' THEN '"LEAD"'::jsonb
      WHEN 'QUALIFIED_TO_BUY' THEN '"ESTIMATING"'::jsonb
      WHEN 'UNQUALIFIED_TO_BUY' THEN '"LOST"'::jsonb
      WHEN 'DECISION_MAKER_BOUGHT_IN' THEN '"ESTIMATING"'::jsonb
      WHEN 'CONTRACT_SENT' THEN '"CONTRACTED"'::jsonb
      WHEN 'CLOSED_WON' THEN '"COMPLETE"'::jsonb
      WHEN 'CLOSED_LOST' THEN '"LOST"'::jsonb
      ELSE COALESCE("meta"->'from', 'null'::jsonb)
    END,
    false
  ),
  '{to}',
  CASE "meta"->>'to'
    WHEN 'DEMO_BOOKED' THEN '"LEAD"'::jsonb
    WHEN 'QUALIFIED_TO_BUY' THEN '"ESTIMATING"'::jsonb
    WHEN 'UNQUALIFIED_TO_BUY' THEN '"LOST"'::jsonb
    WHEN 'DECISION_MAKER_BOUGHT_IN' THEN '"ESTIMATING"'::jsonb
    WHEN 'CONTRACT_SENT' THEN '"CONTRACTED"'::jsonb
    WHEN 'CLOSED_WON' THEN '"COMPLETE"'::jsonb
    WHEN 'CLOSED_LOST' THEN '"LOST"'::jsonb
    ELSE COALESCE("meta"->'to', 'null'::jsonb)
  END,
  false
)
WHERE "type" = 'STAGE_CHANGE'
  AND "meta" IS NOT NULL
  AND (
    "meta"->>'from' IN (
      'DEMO_BOOKED', 'QUALIFIED_TO_BUY', 'UNQUALIFIED_TO_BUY',
      'DECISION_MAKER_BOUGHT_IN', 'CONTRACT_SENT', 'CLOSED_WON', 'CLOSED_LOST'
    )
    OR "meta"->>'to' IN (
      'DEMO_BOOKED', 'QUALIFIED_TO_BUY', 'UNQUALIFIED_TO_BUY',
      'DECISION_MAKER_BOUGHT_IN', 'CONTRACT_SENT', 'CLOSED_WON', 'CLOSED_LOST'
    )
  );

UPDATE "activity"
SET "subject" = 'Status changed'
WHERE "type" = 'STAGE_CHANGE'
  AND "subject" = 'Stage changed';

UPDATE "savedView"
SET "filters" = jsonb_set(
  "filters",
  '{filters,stage}',
  (
    SELECT COALESCE(
      jsonb_agg(
        CASE value #>> '{}'
          WHEN 'DEMO_BOOKED' THEN '"LEAD"'::jsonb
          WHEN 'QUALIFIED_TO_BUY' THEN '"ESTIMATING"'::jsonb
          WHEN 'UNQUALIFIED_TO_BUY' THEN '"LOST"'::jsonb
          WHEN 'DECISION_MAKER_BOUGHT_IN' THEN '"ESTIMATING"'::jsonb
          WHEN 'CONTRACT_SENT' THEN '"CONTRACTED"'::jsonb
          WHEN 'CLOSED_WON' THEN '"COMPLETE"'::jsonb
          WHEN 'CLOSED_LOST' THEN '"LOST"'::jsonb
          ELSE value
        END ORDER BY ordinal
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements("filters"->'filters'->'stage') WITH ORDINALITY AS stage_filter(value, ordinal)
  ),
  false
)
WHERE "entity" = 'DEAL'
  AND jsonb_typeof("filters"->'filters'->'stage') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("filters"->'filters'->'stage') AS value
    WHERE value #>> '{}' IN (
      'DEMO_BOOKED', 'QUALIFIED_TO_BUY', 'UNQUALIFIED_TO_BUY',
      'DECISION_MAKER_BOUGHT_IN', 'CONTRACT_SENT', 'CLOSED_WON', 'CLOSED_LOST'
    )
  );

ALTER TABLE "contact" ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "contact" ADD COLUMN "businessName" TEXT;
UPDATE "contact"
SET "displayName" = trim(concat_ws(' ', "firstName", "lastName"))
WHERE "displayName" = '';

ALTER TABLE "deal" ADD COLUMN "leadSource" TEXT;
ALTER TABLE "deal" ADD COLUMN "projectType" TEXT;
ALTER TABLE "deal" ADD COLUMN "addressLine1" TEXT;
ALTER TABLE "deal" ADD COLUMN "addressLine2" TEXT;
ALTER TABLE "deal" ADD COLUMN "city" TEXT;
ALTER TABLE "deal" ADD COLUMN "state" TEXT;
ALTER TABLE "deal" ADD COLUMN "postalCode" TEXT;

ALTER TABLE "dealContact" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "dealContact_one_primary_per_deal_key" ON "dealContact" ("dealId") WHERE ("isPrimary" = true);

ALTER TABLE "agentRun" ADD COLUMN "dealId" TEXT;
CREATE INDEX "agentRun_dealId_createdAt_idx" ON "agentRun" ("dealId", "createdAt");
ALTER TABLE "agentRun" ADD CONSTRAINT "agentRun_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "document" ADD CONSTRAINT "document_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
CREATE INDEX "documentLineItem_documentId_position_idx" ON "documentLineItem" ("documentId", "position");
ALTER TABLE "documentLineItem" ADD CONSTRAINT "documentLineItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
