BEGIN;

DO $$
DECLARE
	orphan_count integer;
BEGIN
	SELECT count(*) INTO orphan_count
	FROM "deal"
	WHERE "companyId" IS NULL;

	IF orphan_count > 0 THEN
		RAISE EXCEPTION 'Cannot require Deal.companyId: % orphan Deal rows exist', orphan_count;
	END IF;
END
$$;

ALTER TABLE "deal" DROP CONSTRAINT "deal_companyId_fkey";
ALTER TABLE "deal" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "deal"
	ADD CONSTRAINT "deal_companyId_fkey"
	FOREIGN KEY ("companyId") REFERENCES "company"("id")
	ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
