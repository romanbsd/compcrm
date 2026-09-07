import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, FactBand, FactStatus } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import { bucket, drainCounters, restoreCounters } from "@crm/telemetry";
import { FunnelService } from "../src/telemetry/funnel.service";
import { RollupService } from "../src/telemetry/rollup.service";
import { createTenantRows } from "@crm/db/test-support";

const suffix = process.env.TEST_RUN_ID ?? crypto.randomUUID();
const organizationA = `telemetry-rollup-a-${suffix}`;
const organizationB = `telemetry-rollup-b-${suffix}`;
const userId = `telemetry-rollup-user-${suffix}`;
const now = new Date();
const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

beforeAll(async () => {
	await db.user.create({
		data: {
			id: userId,
			name: "Telemetry Rollup Tester",
			email: `${userId}@example.test`,
			emailVerified: true,
		},
	});
	await db.organization.createMany({
		data: [
			{
				id: organizationA,
				name: "Telemetry Rollup A",
				slug: organizationA,
				createdAt: now,
			},
			{
				id: organizationB,
				name: "Telemetry Rollup B",
				slug: organizationB,
				createdAt: now,
			},
		],
	});
	await db.member.createMany({
		data: [
			{
				id: `telemetry-rollup-member-a-${suffix}`,
				organizationId: organizationA,
				userId,
				createdAt: now,
			},
			{
				id: `telemetry-rollup-member-b-${suffix}`,
				organizationId: organizationB,
				userId,
				createdAt: now,
			},
		],
	});
	await createTenantRows(
		[
			{
				organizationId: organizationA,
				agentModelId: "telemetry/model-a",
				agentModelContextWindow: 100_000,
			},
			{
				organizationId: organizationB,
				agentModelId: "telemetry/model-b",
				agentModelContextWindow: 200_000,
			},
		],
		(data) => scopedDb.appSetting.create({ data: data as never }),
	);

	const contacts = await Promise.all(
		[organizationA, organizationB].flatMap((organizationId) =>
			Array.from({ length: 5 }, (_, index) =>
				runInTenant(organizationId, () =>
					scopedDb.contact.create({
						data: {
							organizationId,
							firstName: `Telemetry ${index}`,
							email: `${organizationId}-${index}@example.test`,
						},
						select: { id: true, organizationId: true },
					}),
				),
			),
		),
	);

	const hours = [1, 100, 2, 3];
	await createTenantRows(
		contacts.slice(0, hours.length).map((contact, index) => ({
			organizationId: contact.organizationId,
			contactId: contact.id,
			field: `telemetry.${index}`,
			value: "test",
			score: 1,
			band: FactBand.VERIFIED,
			evidence: [],
			method: "telemetry.test",
			status: FactStatus.APPLIED,
			observedAt: new Date(
				now.getTime() - (hours[index] ?? 0) * 60 * 60 * 1000,
			),
			decidedAt: now,
		})),
		(data) => scopedDb.contactFact.create({ data: data as never }),
	);
	await createTenantRows(
		[organizationA, organizationB].map((organizationId, index) => ({
			organizationId,
			kind: "recheck",
			reason: "telemetry integration test",
			dueAt: now,
			startedAt: now,
			finishedAt: now,
			attempts: index * 2 + 1,
			outcome: "completed",
		})),
		(data) => scopedDb.agentTask.create({ data: data as never }),
	);
});

afterAll(async () => {
	await db.organization.deleteMany({
		where: { id: { in: [organizationA, organizationB] } },
	});
	await db.user.deleteMany({ where: { id: userId } });
});

describe("installation telemetry rollup", () => {
	it("combines raw workspace metrics inside tenant contexts", async () => {
		const existingCounters = await drainCounters();
		let gatheredCounters: Record<string, number> = {};

		try {
			const service = new RollupService(db, new FunnelService(db));
			const gather = Reflect.get(service, "gather") as (
				this: RollupService,
				since: Date,
			) => Promise<{
				properties: Record<string, unknown>;
				counters: Record<string, number>;
			}>;
			const gathered = await gather.call(service, since);
			gatheredCounters = gathered.counters;

			const [members, contactsA, contactsB, tasksA, tasksB] = await Promise.all(
				[
					db.$queryRaw<{ count: bigint }[]>`
						SELECT COUNT(DISTINCT "userId") AS count
						FROM member;
					`,
					runInTenant(organizationA, () => scopedDb.contact.count()),
					runInTenant(organizationB, () => scopedDb.contact.count()),
					runInTenant(organizationA, () =>
						scopedDb.agentTask.count({
							where: { kind: "recheck", startedAt: { gte: since } },
						}),
					),
					runInTenant(organizationB, () =>
						scopedDb.agentTask.count({
							where: { kind: "recheck", startedAt: { gte: since } },
						}),
					),
				],
			);
			const contacts = contactsA + contactsB;
			const tasks = tasksA + tasksB;
			expect(gathered.properties.members_bucket).toBe(
				bucket(Number(members[0]?.count ?? 0)),
			);
			expect(gathered.properties.contacts_bucket).toBe(bucket(contacts));
			expect(gathered.properties.tasks_claimed).toMatchObject({
				recheck: tasks,
			});
			expect(gathered.properties.agent_model_id).toBe("mixed");
			expect(gathered.properties.agent_model_context_window).toBeNull();
		} finally {
			await restoreCounters({ ...existingCounters, ...gatheredCounters });
		}
	});
});
