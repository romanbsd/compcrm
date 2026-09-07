import { currentOrganizationId } from "@crm/db/tenant-context";
import { scopedTransaction } from "@crm/db/tenant-scope";
import { windowExpiry } from "@crm/db/tracking";
import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class TrackingCounterService {
	private readonly logger = new Logger(TrackingCounterService.name);

	async take(key: string, limit: number, amount = 1): Promise<boolean> {
		if (amount <= 0) return true;
		if (amount > limit) return false;

		try {
			const organizationId = currentOrganizationId();
			const charged = await scopedTransaction(
				(tx) =>
					tx.$queryRaw<{ value: number }[]>`
					INSERT INTO "trackingCounter" ("organizationId", "key", "value", "expiresAt")
					VALUES (${organizationId}, ${key}, ${amount}, ${windowExpiry(key)})
					ON CONFLICT ("organizationId", "key") DO UPDATE
						SET "value" = "trackingCounter"."value" + ${amount}
						WHERE "trackingCounter"."organizationId" = ${organizationId}
							AND "trackingCounter"."value" + ${amount} <= ${limit}
					RETURNING "value";
				`,
			);

			return charged.length > 0;
		} catch (error) {
			this.logger.error(
				{ message: "Tracking counter could not be read — refusing the write" },
				error instanceof Error ? error.stack : String(error),
			);

			return false;
		}
	}

	async release(key: string, amount = 1): Promise<void> {
		try {
			const organizationId = currentOrganizationId();
			await scopedTransaction(
				(tx) =>
					tx.$executeRaw`
					UPDATE "trackingCounter"
					SET "value" = GREATEST("value" - ${amount}, 0)
					WHERE "organizationId" = ${organizationId} AND "key" = ${key};
				`,
			);
		} catch (error) {
			this.logger.error(
				{ message: "Tracking counter could not be released" },
				error instanceof Error ? error.stack : String(error),
			);
		}
	}

	async sweep(): Promise<number> {
		const removed = await scopedTransaction((tx) =>
			tx.trackingCounter.deleteMany({
				where: { expiresAt: { lt: new Date() } },
			}),
		);

		return removed.count;
	}
}
