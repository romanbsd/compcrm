import type { Db } from "@crm/db";
import { isSiteId } from "@crm/db/tracking";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

@Injectable()
export class TrackingSiteLocatorService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async resolve(siteId: string): Promise<string | null> {
		if (!isSiteId(siteId)) return null;

		const site = await this.db.trackingSiteLocator.findUnique({
			where: { siteId },
			select: { organizationId: true },
		});

		return site?.organizationId ?? null;
	}
}
