import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import { TrackingCounterService } from "../src/tracking/tracking-counter.service";
import { TrackingRetentionService } from "../src/tracking/tracking-retention.service";
import { TrackingRollupService } from "../src/tracking/tracking-rollup.service";
import { createTenantRows } from "@crm/db/test-support";

const suffix = process.env.TEST_RUN_ID ?? crypto.randomUUID();
const organizationA = `tracking-retention-a-${suffix}`;
const organizationB = `tracking-retention-b-${suffix}`;
const orphanA = `tracking-orphan-a-${suffix}`;
const orphanB = `tracking-orphan-b-${suffix}`;
const linkedVisitor = `tracking-linked-${suffix}`;
const recentVisitor = `tracking-recent-${suffix}`;
const old = new Date("2025-01-02T12:00:00.000Z");
const day = new Date("2025-01-02T00:00:00.000Z");
const recent = new Date();
let linkedContactId = "";

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: organizationA,
				name: "Tracking Retention A",
				slug: organizationA,
				createdAt: recent,
			},
			{
				id: organizationB,
				name: "Tracking Retention B",
				slug: organizationB,
				createdAt: recent,
			},
		],
	});
	const contact = await runInTenant(organizationA, () =>
		scopedDb.contact.create({
			data: {
				organizationId: organizationA,
				firstName: "Tracked",
				email: `tracked-${suffix}@example.test`,
			},
			select: { id: true },
		}),
	);
	linkedContactId = contact.id;

	await createTenantRows(
		[
			{
				id: orphanA,
				organizationId: organizationA,
				firstSeen: old,
				lastSeen: old,
			},
			{
				id: orphanB,
				organizationId: organizationB,
				firstSeen: old,
				lastSeen: old,
			},
			{
				id: linkedVisitor,
				organizationId: organizationA,
				contactId: linkedContactId,
				firstSeen: old,
				lastSeen: old,
			},
			{
				id: recentVisitor,
				organizationId: organizationB,
				firstSeen: recent,
				lastSeen: recent,
			},
		],
		(data) => scopedDb.trackedVisitor.create({ data: data as never }),
	);
	await createTenantRows(
		[
			{
				organizationId: organizationA,
				visitorId: orphanA,
				type: "page_view",
				host: "a.example.test",
				path: "/pricing",
				occurredAt: old,
			},
			{
				organizationId: organizationA,
				visitorId: orphanA,
				type: "page_view",
				host: "a.example.test",
				path: "/pricing",
				occurredAt: old,
			},
			{
				organizationId: organizationA,
				visitorId: orphanA,
				type: "click",
				host: "a.example.test",
				path: "/pricing",
				occurredAt: old,
			},
			{
				organizationId: organizationB,
				visitorId: orphanB,
				type: "page_view",
				host: "b.example.test",
				path: "/demo",
				occurredAt: old,
			},
			{
				organizationId: organizationB,
				visitorId: recentVisitor,
				type: "page_view",
				host: "b.example.test",
				path: "/recent",
				occurredAt: recent,
			},
		],
		(data) => scopedDb.trackedEvent.create({ data: data as never }),
	);
	await runInTenant(organizationA, () =>
		scopedDb.trackedPageDaily.create({
			data: {
				organizationId: organizationA,
				day,
				host: "a.example.test",
				path: "/pricing",
				views: 1,
				visitors: 0,
			},
		}),
	);
	await createTenantRows(
		[
			{
				organizationId: organizationA,
				key: `expired-${suffix}`,
				value: 1,
				expiresAt: old,
			},
			{
				organizationId: organizationB,
				key: `expired-${suffix}`,
				value: 1,
				expiresAt: old,
			},
			{
				organizationId: organizationA,
				key: `current-${suffix}`,
				value: 1,
				expiresAt: new Date(recent.getTime() + 60 * 60 * 1000),
			},
			{
				organizationId: organizationB,
				key: `current-${suffix}`,
				value: 1,
				expiresAt: new Date(recent.getTime() + 60 * 60 * 1000),
			},
		],
		(data) => scopedDb.trackingCounter.create({ data: data as never }),
	);
});

afterAll(async () => {
	await db.organization.deleteMany({
		where: { id: { in: [organizationA, organizationB] } },
	});
});

describe("tracking retention across workspaces", () => {
	it("rolls up and removes each workspace's expired tracking data", async () => {
		const retention = new TrackingRetentionService(
			db,
			new TrackingRollupService(),
			new TrackingCounterService(),
		);

		const outcome = await retention.run(new Date("2025-02-01T00:00:00.000Z"));
		const [
			dailyA,
			dailyB,
			oldEventsA,
			oldEventsB,
			recentEvents,
			visitorsA,
			visitorsB,
			countersA,
			countersB,
		] = await Promise.all([
			runInTenant(organizationA, () =>
				scopedDb.trackedPageDaily.findUnique({
					where: {
						organizationId_day_host_path: {
							organizationId: organizationA,
							day,
							host: "a.example.test",
							path: "/pricing",
						},
					},
					select: { views: true, visitors: true },
				}),
			),
			runInTenant(organizationB, () =>
				scopedDb.trackedPageDaily.findUnique({
					where: {
						organizationId_day_host_path: {
							organizationId: organizationB,
							day,
							host: "b.example.test",
							path: "/demo",
						},
					},
					select: { views: true, visitors: true },
				}),
			),
			runInTenant(organizationA, () =>
				scopedDb.trackedEvent.count({ where: { visitorId: orphanA } }),
			),
			runInTenant(organizationB, () =>
				scopedDb.trackedEvent.count({ where: { visitorId: orphanB } }),
			),
			runInTenant(organizationB, () =>
				scopedDb.trackedEvent.count({
					where: { visitorId: recentVisitor },
				}),
			),
			runInTenant(organizationA, () =>
				scopedDb.trackedVisitor.findMany({
					where: { id: { in: [orphanA, linkedVisitor] } },
					select: { id: true },
				}),
			),
			runInTenant(organizationB, () =>
				scopedDb.trackedVisitor.findMany({
					where: { id: orphanB },
					select: { id: true },
				}),
			),
			runInTenant(organizationA, () =>
				scopedDb.trackingCounter.findMany({
					select: { key: true },
				}),
			),
			runInTenant(organizationB, () =>
				scopedDb.trackingCounter.findMany({
					select: { key: true },
				}),
			),
		]);
		const oldEvents = oldEventsA + oldEventsB;
		const visitors = [...visitorsA, ...visitorsB];
		const counters = [...countersA, ...countersB];

		expect(outcome.rolled).toBeGreaterThanOrEqual(2);
		expect(outcome.removed).toBeGreaterThanOrEqual(4);
		expect(outcome.complete).toBe(true);
		expect(outcome.visitors).toBeGreaterThanOrEqual(2);
		expect(outcome.counters).toBeGreaterThanOrEqual(2);
		expect(dailyA).toEqual({ views: 2, visitors: 1 });
		expect(dailyB).toEqual({ views: 1, visitors: 1 });
		expect(oldEvents).toBe(0);
		expect(recentEvents).toBe(1);
		expect(visitors).toEqual([{ id: linkedVisitor }]);
		expect(counters).toEqual([
			{ key: `current-${suffix}` },
			{ key: `current-${suffix}` },
		]);
	});
});
