import { describe, expect, it } from "bun:test";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import type { Db } from "@crm/db";
import { currentOrganizationId } from "@crm/db/tenant-context";
import type { ScopedDb } from "@crm/db/tenant-scope";
import { configHash, type TrackingConfig } from "@crm/db/tracking";
import type { Cache } from "cache-manager";
import type { Response } from "express";
import { TrackingController } from "../src/tracking/tracking.controller";
import { TrackingConfigService } from "../src/tracking/tracking-config.service";
import type { TrackingIngestService } from "../src/tracking/tracking-ingest.service";
import { TrackingSiteLocatorService } from "../src/tracking/tracking-site-locator.service";

const ORG_A = "organization-a";
const ORG_B = "organization-b";
const SITE_A = "cmp_aaaaaaaa";
const SITE_B = "cmp_bbbbbbbb";

function config(siteId: string) {
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

describe("public tracking tenant context", () => {
	it("rejects a malformed site id before database lookup", async () => {
		let queried = false;
		const locator = new TrackingSiteLocatorService({
			trackingSiteLocator: {
				findUnique: async () => {
					queried = true;
					return null;
				},
			},
		} as unknown as Db);

		expect(await locator.resolve("not-a-site")).toBeNull();
		expect(queried).toBe(false);
	});

	it("runs ingest inside the organization resolved from the site id", async () => {
		let acceptedOrganizationId: string | undefined;
		const locator = new TrackingSiteLocatorService({
			trackingSiteLocator: {
				findUnique: async () => ({ organizationId: ORG_A }),
			},
		} as unknown as Db);
		const controller = new TrackingController(
			locator,
			{} as TrackingConfigService,
			{
				accept: async () => {
					acceptedOrganizationId = currentOrganizationId();
				},
			} as unknown as TrackingIngestService,
		);
		const request = Readable.from([
			Buffer.from(
				JSON.stringify({ siteId: SITE_A, visitorId: "visitor", events: [] }),
			),
		]) as unknown as IncomingMessage;
		const response = { setHeader: () => undefined } as unknown as Response;

		await controller.collect(request, response);

		expect(acceptedOrganizationId).toBe(ORG_A);
	});

	it("keeps public configurations separate by organization", async () => {
		const settings = new Map([
			[ORG_A, config(SITE_A)],
			[ORG_B, config(SITE_B)],
		]);
		const cached = new Map<string, unknown>();
		const locator = new TrackingSiteLocatorService({
			trackingSiteLocator: {
				findUnique: async ({ where }: { where: { siteId: string } }) => ({
					organizationId: where.siteId === SITE_A ? ORG_A : ORG_B,
				}),
			},
		} as unknown as Db);
		const service = new TrackingConfigService(
			{
				appSetting: {
					findUnique: async () => settings.get(currentOrganizationId()),
				},
				trackedDomain: { findMany: async () => [] },
			} as unknown as ScopedDb,
			{
				get: async (key: string) => cached.get(key),
				set: async (key: string, value: unknown) => cached.set(key, value),
				del: async (key: string) => cached.delete(key),
			} as unknown as Cache,
			locator,
		);

		const [first, second] = await Promise.all([
			service.forSite(SITE_A),
			service.forSite(SITE_B),
		]);

		expect(first?.config.siteId).toBe(SITE_A);
		expect(second?.config.siteId).toBe(SITE_B);
		expect(cached.size).toBe(2);
	});
});
