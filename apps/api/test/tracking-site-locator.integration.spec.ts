import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import { isSiteId } from "@crm/db/tracking";
import type { Cache } from "cache-manager";
import { TrackingConfigService } from "../src/tracking/tracking-config.service";
import { TrackingSiteLocatorService } from "../src/tracking/tracking-site-locator.service";
import { tenantBound } from "@crm/db/test-support";

const suffix = process.env.TEST_RUN_ID ?? crypto.randomUUID();
const organizationId = `tracking-site-locator-${suffix}`;

beforeAll(async () => {
	await db.organization.create({
		data: {
			id: organizationId,
			name: "Tracking Site Locator",
			slug: organizationId,
			createdAt: new Date(),
		},
	});
});

afterAll(async () => {
	await db.organization.delete({ where: { id: organizationId } });
});

describe("tracking site locator", () => {
	it("replaces the public locator atomically when the site id rotates", async () => {
		const entries = new Map<string, unknown>();
		const cache = {
			get: async (key: string) => entries.get(key),
			set: async (key: string, value: unknown) => entries.set(key, value),
			del: async (key: string) => entries.delete(key),
		} as unknown as Cache;
		const locator = new TrackingSiteLocatorService(db);
		const raw = new TrackingConfigService(scopedDb as never, cache, locator);
		const service = tenantBound(organizationId, raw);

		const first = await service.rotateSiteId();
		const second = await service.rotateSiteId();
		const [setting, locators] = await Promise.all([
			runInTenant(organizationId, () =>
				scopedDb.appSetting.findUnique({
					where: { organizationId },
					select: { trackingSiteId: true },
				}),
			),
			db.trackingSiteLocator.findMany({
				where: { organizationId },
				select: { siteId: true },
			}),
		]);

		expect(isSiteId(first)).toBe(true);
		expect(isSiteId(second)).toBe(true);
		expect(second).not.toBe(first);
		expect(await locator.resolve(first)).toBeNull();
		expect(await locator.resolve(second)).toBe(organizationId);
		expect(setting?.trackingSiteId).toBe(second);
		expect(locators).toEqual([{ siteId: second }]);
	});
});
