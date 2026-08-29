BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "deal"
    WHERE "stage"::text NOT IN (
      'LEAD', 'ESTIMATING', 'CONTRACTED', 'IN_PROGRESS', 'COMPLETE', 'LOST'
    )
  ) THEN
    RAISE EXCEPTION 'Cannot restore DealStage: unexpected stored stage value exists';
  END IF;
END
$$;

ALTER TABLE "deal" ALTER COLUMN "stage" DROP DEFAULT;

CREATE TYPE "DealStage_new" AS ENUM (
  'DEMO_BOOKED',
  'QUALIFIED_TO_BUY',
  'UNQUALIFIED_TO_BUY',
  'DECISION_MAKER_BOUGHT_IN',
  'CONTRACT_SENT',
  'CLOSED_WON',
  'CLOSED_LOST'
);

ALTER TABLE "deal"
  ALTER COLUMN "stage" TYPE "DealStage_new"
  USING (
    CASE "stage"::text
      WHEN 'LEAD' THEN 'DEMO_BOOKED'
      WHEN 'ESTIMATING' THEN 'QUALIFIED_TO_BUY'
      WHEN 'CONTRACTED' THEN 'CONTRACT_SENT'
      WHEN 'IN_PROGRESS' THEN 'DECISION_MAKER_BOUGHT_IN'
      WHEN 'COMPLETE' THEN 'CLOSED_WON'
      WHEN 'LOST' THEN 'CLOSED_LOST'
    END
  )::"DealStage_new";

DROP TYPE "DealStage";
ALTER TYPE "DealStage_new" RENAME TO "DealStage";
ALTER TABLE "deal" ALTER COLUMN "stage" SET DEFAULT 'DEMO_BOOKED';

UPDATE "activity"
SET "meta" = jsonb_set(
  jsonb_set(
    "meta",
    '{from}',
    CASE "meta"->>'from'
      WHEN 'LEAD' THEN '"DEMO_BOOKED"'::jsonb
      WHEN 'ESTIMATING' THEN '"QUALIFIED_TO_BUY"'::jsonb
      WHEN 'CONTRACTED' THEN '"CONTRACT_SENT"'::jsonb
      WHEN 'IN_PROGRESS' THEN '"DECISION_MAKER_BOUGHT_IN"'::jsonb
      WHEN 'COMPLETE' THEN '"CLOSED_WON"'::jsonb
      WHEN 'LOST' THEN '"CLOSED_LOST"'::jsonb
      ELSE COALESCE("meta"->'from', 'null'::jsonb)
    END,
    false
  ),
  '{to}',
  CASE "meta"->>'to'
    WHEN 'LEAD' THEN '"DEMO_BOOKED"'::jsonb
    WHEN 'ESTIMATING' THEN '"QUALIFIED_TO_BUY"'::jsonb
    WHEN 'CONTRACTED' THEN '"CONTRACT_SENT"'::jsonb
    WHEN 'IN_PROGRESS' THEN '"DECISION_MAKER_BOUGHT_IN"'::jsonb
    WHEN 'COMPLETE' THEN '"CLOSED_WON"'::jsonb
    WHEN 'LOST' THEN '"CLOSED_LOST"'::jsonb
    ELSE COALESCE("meta"->'to', 'null'::jsonb)
  END,
  false
)
WHERE "type" = 'STAGE_CHANGE'
  AND "meta" IS NOT NULL
  AND (
    "meta"->>'from' IN ('LEAD', 'ESTIMATING', 'CONTRACTED', 'IN_PROGRESS', 'COMPLETE', 'LOST')
    OR "meta"->>'to' IN ('LEAD', 'ESTIMATING', 'CONTRACTED', 'IN_PROGRESS', 'COMPLETE', 'LOST')
  );

UPDATE "activity"
SET "subject" = 'Stage changed'
WHERE "type" = 'STAGE_CHANGE'
  AND "subject" = 'Status changed';

UPDATE "savedView"
SET "filters" = jsonb_set(
  "filters",
  '{filters,stage}',
  (
    SELECT COALESCE(
      jsonb_agg(
        CASE value #>> '{}'
          WHEN 'LEAD' THEN '"DEMO_BOOKED"'::jsonb
          WHEN 'ESTIMATING' THEN '"QUALIFIED_TO_BUY"'::jsonb
          WHEN 'CONTRACTED' THEN '"CONTRACT_SENT"'::jsonb
          WHEN 'IN_PROGRESS' THEN '"DECISION_MAKER_BOUGHT_IN"'::jsonb
          WHEN 'COMPLETE' THEN '"CLOSED_WON"'::jsonb
          WHEN 'LOST' THEN '"CLOSED_LOST"'::jsonb
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
    WHERE value #>> '{}' IN ('LEAD', 'ESTIMATING', 'CONTRACTED', 'IN_PROGRESS', 'COMPLETE', 'LOST')
  );

COMMIT;
