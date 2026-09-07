import { describe, expect, it } from "bun:test";
import { currentOrganizationId, runInTenant } from "@crm/db/tenant-context";
import type { ScopedDb } from "@crm/db/tenant-scope";
import { configHash, type TrackingConfig } from "@crm/db/tracking";
import type { Cache } from "cache-manager";
import { TrackingConfigService } from "../src/tracking/tracking-config.service";
import type { TrackingSiteLocatorService } from "../src/tracking/tracking-site-locator.service";

const ORG_A = "organization-a";
const ORG_B = "organization-b";
const SITE_A = "cmp_aaaaaaaa";
const SITE_B = "cmp_bbbbbbbb";

function trackingConfig(siteId: string): TrackingConfig {
	return {
		siteId,
		crossDomain: false,
		limitToDomains: false,
		cookieSubdomains: false,
		secureCookies: true,
		honourDnt: true,
		cookieDays: 30,
		hosts: [],
	};
}

function setting(siteId: string) {
	return {
		trackingSiteId: siteId,
		trackingCrossDomain: false,
		trackingLimitToDomains: false,
		trackingCookieSubdomains: false,
		trackingSecureCookies: true,
		trackingHonourDnt: true,
		trackingCookieDays: 30,
		trackingPaused: false,
		trackingConfigHash: configHash(trackingConfig(siteId)),
	};
}

describe("TrackingConfigService cache", () => {
	it("keeps compiled configurations separate by organization", async () => {
		const settings = new Map([
			[ORG_A, setting(SITE_A)],
			[ORG_B, setting(SITE_B)],
		]);
		const entries = new Map<string, unknown>();
		const scopedDb = {
			appSetting: {
				findUnique: async () => settings.get(currentOrganizationId()),
			},
			trackedDomain: { findMany: async () => [] },
		} as unknown as ScopedDb;
		const cache = {
			get: async (key: string) => entries.get(key),
			set: async (key: string, value: unknown) => entries.set(key, value),
			del: async (key: string) => entries.delete(key),
		} as unknown as Cache;
		const service = new TrackingConfigService(
			scopedDb,
			cache,
			{} as TrackingSiteLocatorService,
		);

		const first = await runInTenant(ORG_A, () => service.compiled());
		const second = await runInTenant(ORG_B, () => service.compiled());

		expect(first?.config.siteId).toBe(SITE_A);
		expect(second?.config.siteId).toBe(SITE_B);
		expect([...entries.keys()].sort()).toEqual([
			`tracking:config:${ORG_A}`,
			`tracking:config:${ORG_B}`,
		]);
	});
});
