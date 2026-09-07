import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { scopedDb } from "@crm/db/tenant-scope";
import { TrackingService } from "../src/tracking/tracking.service";
import type { TrackingConfigService } from "../src/tracking/tracking-config.service";
import { createTenantRows, tenantBound } from "@crm/db/test-support";

const suffix = process.env.TEST_RUN_ID ?? crypto.randomUUID();
const userId = `tracking-sources-user-${suffix}`;
const organizationA = `tracking-sources-a-${suffix}`;
const organizationB = `tracking-sources-b-${suffix}`;
const contactA = `tracking-sources-contact-a-${suffix}`;
const contactB = `tracking-sources-contact-b-${suffix}`;
const visitorA = `tracking-sources-visitor-a-${suffix}`;
const visitorB = `tracking-sources-visitor-b-${suffix}`;
const occurredAt = new Date("2026-08-01T12:00:00.000Z");

beforeAll(async () => {
	await db.user.create({
		data: {
			id: userId,
			name: "Tracking Sources User",
			email: `${userId}@example.test`,
			emailVerified: true,
		},
	});
	await db.organization.createMany({
		data: [
			{
				id: organizationA,
				name: "Tracking Sources A",
				slug: organizationA,
				createdAt: occurredAt,
			},
			{
				id: organizationB,
				name: "Tracking Sources B",
				slug: organizationB,
				createdAt: occurredAt,
			},
		],
	});
	await db.member.createMany({
		data: [
			{
				id: `tracking-sources-member-a-${suffix}`,
				organizationId: organizationA,
				userId,
				role: "owner",
				createdAt: occurredAt,
			},
			{
				id: `tracking-sources-member-b-${suffix}`,
				organizationId: organizationB,
				userId,
				role: "owner",
				createdAt: occurredAt,
			},
		],
	});
	await createTenantRows(
		[
			{
				id: contactA,
				organizationId: organizationA,
				firstName: "Source A",
			},
			{
				id: contactB,
				organizationId: organizationB,
				firstName: "Source B",
			},
		],
		(data) => scopedDb.contact.create({ data: data as never }),
	);
	await createTenantRows(
		[
			{
				id: visitorA,
				organizationId: organizationA,
				contactId: contactA,
				firstSource: "Google",
				firstMedium: "organic",
				firstSeen: occurredAt,
				lastSeen: occurredAt,
			},
			{
				id: visitorB,
				organizationId: organizationB,
				contactId: contactB,
				firstSource: "Google",
				firstMedium: "organic",
				firstSeen: occurredAt,
				lastSeen: occurredAt,
			},
		],
		(data) => scopedDb.trackedVisitor.create({ data: data as never }),
	);
	await createTenantRows(
		[
			{
				organizationId: organizationA,
				visitorId: visitorA,
				type: "page_view",
				host: "a.example.test",
				path: "/one",
				source: "Google",
				medium: "organic",
				occurredAt,
			},
			{
				organizationId: organizationA,
				visitorId: visitorA,
				type: "page_view",
				host: "a.example.test",
				path: "/two",
				source: "Newsletter",
				medium: "email",
				occurredAt,
			},
			{
				organizationId: organizationB,
				visitorId: visitorB,
				type: "page_view",
				host: "b.example.test",
				path: "/one",
				source: "Google",
				medium: "organic",
				occurredAt,
			},
			{
				organizationId: organizationB,
				visitorId: visitorB,
				type: "page_view",
				host: "b.example.test",
				path: "/two",
				source: "Google",
				medium: "organic",
				occurredAt,
			},
		],
		(data) => scopedDb.trackedEvent.create({ data: data as never }),
	);
});

afterAll(async () => {
	await db.organization.deleteMany({
		where: { id: { in: [organizationA, organizationB] } },
	});
	await db.user.delete({ where: { id: userId } });
});

describe("tracking sources across workspaces", () => {
	it("returns only the active workspace source totals", async () => {
		const raw = new TrackingService(
			scopedDb as never,
			{} as TrackingConfigService,
		);
		const service = tenantBound(organizationA, raw);

		const sources = await service.sources(userId);

		expect(sources).toEqual([
			{ source: "Google", medium: "organic", views: 1, contacts: 1 },
			{ source: "Newsletter", medium: "email", views: 1, contacts: 0 },
		]);
	});
});
