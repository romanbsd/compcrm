import { type Db, type Prisma } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedTransaction } from "@crm/db/tenant-scope";
import { organizationIds } from "@crm/db/tenants";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { TrackingCounterService } from "./tracking-counter.service";
import { TRACKING_RETENTION } from "./tracking-retention.config";
import { TrackingRollupService } from "./tracking-rollup.service";

export type TrackingRetentionOutcome = {
	rolled: number;
	removed: number;
	complete: boolean;
	visitors: number;
	counters: number;
};

@Injectable()
export class TrackingRetentionService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly rollups: TrackingRollupService,
		private readonly counters: TrackingCounterService,
	) {}

	async run(before: Date): Promise<TrackingRetentionOutcome> {
		const organizations = await organizationIds(this.db);
		const outcome: TrackingRetentionOutcome = {
			rolled: 0,
			removed: 0,
			complete: true,
			visitors: 0,
			counters: 0,
		};

		for (const organizationId of organizations) {
			const tenant = await runInTenant(organizationId, async () => {
				const rolled = await this.rollups.run(before);
				const events = await this.sweepEvents(before);
				const visitors = await this.sweepVisitors(before);
				const counters = await this.counters.sweep();

				return {
					rolled,
					removed: events.removed,
					complete: events.complete,
					visitors,
					counters,
				};
			});

			outcome.rolled += tenant.rolled;
			outcome.removed += tenant.removed;
			outcome.complete = outcome.complete && tenant.complete;
			outcome.visitors += tenant.visitors;
			outcome.counters += tenant.counters;
		}

		return outcome;
	}

	private async sweepEvents(
		before: Date,
	): Promise<{ removed: number; complete: boolean }> {
		return scopedTransaction(async (tx) => {
			let removed = 0;

			for (let pass = 0; pass < TRACKING_RETENTION.sweep.maxPasses; pass += 1) {
				const deleted = await this.deleteEvents(tx, before);

				removed += deleted;
				if (deleted < TRACKING_RETENTION.sweep.batchSize) {
					return { removed, complete: true };
				}
			}

			return { removed, complete: false };
		});
	}

	private async deleteEvents(
		tx: Prisma.TransactionClient,
		before: Date,
	): Promise<number> {
		return tx.$executeRaw`
			DELETE FROM "trackedEvent"
			WHERE "id" IN (
				SELECT "id" FROM "trackedEvent"
				WHERE "occurredAt" < ${before}
				LIMIT ${TRACKING_RETENTION.sweep.batchSize}
			);
		`;
	}

	private async sweepVisitors(before: Date): Promise<number> {
		return scopedTransaction(
			(tx) =>
				tx.$executeRaw`
					DELETE FROM "trackedVisitor"
					WHERE "contactId" IS NULL
						AND "lastSeen" < ${before}
						AND NOT EXISTS (
							SELECT 1 FROM "trackedEvent"
							WHERE "trackedEvent"."visitorId" = "trackedVisitor"."id"
						);
				`,
		);
	}
}
