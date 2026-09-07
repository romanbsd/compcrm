import { scopedTransaction } from "@crm/db/tenant-scope";
import { Injectable } from "@nestjs/common";

@Injectable()
export class TrackingRollupService {
	async run(before: Date): Promise<number> {
		const rolled = await scopedTransaction(
			(tx) =>
				tx.$executeRaw`
				INSERT INTO "trackedPageDaily" ("organizationId", "day", "host", "path", "views", "visitors")
				SELECT
					"organizationId",
					date_trunc('day', "occurredAt") AS "day",
					"host",
					"path",
					count(*)::int AS "views",
					count(DISTINCT "visitorId")::int AS "visitors"
				FROM "trackedEvent"
				WHERE "occurredAt" < ${before}
					AND "type" = 'page_view'
				GROUP BY 1, 2, 3, 4
				ON CONFLICT ("organizationId", "day", "host", "path") DO UPDATE
				SET "views" = GREATEST("trackedPageDaily"."views", EXCLUDED."views"),
					"visitors" = GREATEST("trackedPageDaily"."visitors", EXCLUDED."visitors");
			`,
		);

		return rolled;
	}
}
