import { currentOrganizationId, runInTenant } from "@crm/db/tenant-context";
import { type ScopedDb, scopedTransaction } from "@crm/db/tenant-scope";
import {
	configHash,
	mintSiteId,
	readTrackingConfig,
	type TrackingConfig,
} from "@crm/db/tracking";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Cache } from "cache-manager";
import { InjectScopedDatabase } from "../database/database.constants";
import { TrackingSiteLocatorService } from "./tracking-site-locator.service";

const CONFIG_TTL_MS = 5 * 60_000;

const CONFIG_KEY = "tracking:config";

export interface CompiledConfig {
	config: TrackingConfig;
	hash: string;
}

@Injectable()
export class TrackingConfigService {
	private readonly logger = new Logger(TrackingConfigService.name);

	private generation = 0;

	constructor(
		@InjectScopedDatabase() private readonly db: ScopedDb,
		@Inject(CACHE_MANAGER) private readonly cache: Cache,
		private readonly locator: TrackingSiteLocatorService,
	) {}

	async compiled(): Promise<CompiledConfig | null> {
		const cached = await this.cache.get<CompiledConfig>(this.cacheKey());
		if (cached) return cached;

		const read = this.generation;
		const config = await readTrackingConfig(this.db);
		if (!config) return null;

		const compiled = { config, hash: configHash(config) };

		if (read === this.generation && (await this.current(compiled.hash))) {
			await this.cache.set(this.cacheKey(), compiled, CONFIG_TTL_MS);
		}

		return compiled;
	}

	private async current(hash: string): Promise<boolean> {
		const row = await this.db.appSetting.findUnique({
			where: { organizationId: currentOrganizationId() },
			select: { trackingConfigHash: true },
		});

		return row?.trackingConfigHash === hash;
	}

	async forSite(siteId: string): Promise<CompiledConfig | null> {
		const organizationId = await this.locator.resolve(siteId);
		if (!organizationId) return null;

		return runInTenant(organizationId, async () => {
			const compiled = await this.compiled();
			return compiled?.config.siteId === siteId ? compiled : null;
		});
	}

	async invalidate(): Promise<void> {
		this.generation += 1;
		const written = this.generation;

		await this.cache.del(this.cacheKey());

		const config = await readTrackingConfig(this.db);

		if (!config) {
			await this.db.appSetting.updateMany({
				where: {},
				data: { trackingConfigHash: null },
			});

			return;
		}

		const hash = configHash(config);

		await this.db.appSetting.update({
			where: { organizationId: currentOrganizationId() },
			data: { trackingConfigHash: hash },
		});

		if (written !== this.generation) return;
		if (!(await this.current(hash))) return;

		await this.cache.set(this.cacheKey(), { config, hash }, CONFIG_TTL_MS);
	}

	async ensureSiteId(): Promise<string> {
		const existing = await this.db.appSetting.findUnique({
			where: { organizationId: currentOrganizationId() },
			select: { trackingSiteId: true },
		});

		if (existing?.trackingSiteId) return existing.trackingSiteId;

		const trackingSiteId = await this.writeSiteId();

		this.logger.log({ message: "Tracking site id minted" });

		return trackingSiteId;
	}

	async rotateSiteId(): Promise<string> {
		const trackingSiteId = await this.writeSiteId();

		this.logger.warn({ message: "Tracking site id rotated" });

		return trackingSiteId;
	}

	private async writeSiteId(): Promise<string> {
		const organizationId = currentOrganizationId();
		const trackingSiteId = mintSiteId();

		await scopedTransaction(async (tx) => {
			await tx.appSetting.upsert({
				where: { organizationId },
				create: { trackingSiteId },
				update: { trackingSiteId },
			});
			await tx.trackingSiteLocator.upsert({
				where: { organizationId },
				create: { organizationId, siteId: trackingSiteId },
				update: { siteId: trackingSiteId },
			});
		});
		await this.invalidate();

		return trackingSiteId;
	}

	private cacheKey(): string {
		return `${CONFIG_KEY}:${currentOrganizationId()}`;
	}
}
