import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { AgentQueueService } from "../src/agent/agent-queue.service";

const suffix = process.env.TEST_RUN_ID ?? crypto.randomUUID();
const organizationA = `mt-queue-a-${suffix}`;
const organizationB = `mt-queue-b-${suffix}`;
const companyId = `mt-queue-company-${suffix}`;

let moduleFixture: TestingModule | undefined;
let queue: AgentQueueService;

beforeAll(async () => {
	const { AppModule } = await import("../src/app.module");

	moduleFixture = await Test.createTestingModule({
		imports: [AppModule],
	}).compile();
	queue = moduleFixture.get(AgentQueueService);

	await db.organization.createMany({
		data: [
			{
				id: organizationA,
				name: "Queue Organization A",
				slug: organizationA,
				createdAt: new Date(),
			},
			{
				id: organizationB,
				name: "Queue Organization B",
				slug: organizationB,
				createdAt: new Date(),
			},
		],
	});
	await runInTenant(organizationA, () =>
		scopedDb.agentTask.create({
			data: {
				organizationId: organizationA,
				kind: "tenant-isolation",
				reason: "focused integration test",
				companyId,
				dueAt: new Date(Date.now() - 1_000),
			},
		}),
	);
});

afterAll(async () => {
	await moduleFixture?.close();
	await db.organization.deleteMany({
		where: { id: { in: [organizationA, organizationB] } },
	});
});

describe("cross-tenant AgentTask isolation through Nest services", () => {
	it("hides another organization's queued company", async () => {
		const queuedInA = await runInTenant(organizationA, () =>
			queue.isQueued({ companyId }),
		);
		const queuedInB = await runInTenant(organizationB, () =>
			queue.isQueued({ companyId }),
		);

		expect(queuedInA).toBe(true);
		expect(queuedInB).toBe(false);
	});
});
