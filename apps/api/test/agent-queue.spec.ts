import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import { AgentQueueService } from "../src/agent/agent-queue.service";
import { tenantBound } from "@crm/db/test-support";
import { ensureTestWorkspace } from "./workspace.fixture";

const suffix = process.env.TEST_RUN_ID ?? "agent-queue-spec";
const email = `badge-${suffix}@example.test`;
const name = `Badge Co ${suffix}`;
const kind = "test-queue-badge";
const organizationId = `agent-queue-organization-${suffix}`;

const rawQueue = new AgentQueueService(scopedDb as never);
const queue = tenantBound(organizationId, rawQueue);

const DAY_MS = 86_400_000;

let contactId: string;
let companyId: string;

async function clean() {
	await runInTenant(organizationId, async () => {
		await scopedDb.agentTask.deleteMany({ where: { kind } });
		await scopedDb.contact.deleteMany({ where: { email } });
		await scopedDb.company.deleteMany({ where: { name } });
	});
	await db.organization.deleteMany({ where: { id: organizationId } });
}

beforeAll(async () => {
	await clean();
	await ensureTestWorkspace(organizationId, organizationId);

	await runInTenant(organizationId, async () => {
		const contact = await scopedDb.contact.create({
			data: {
				organizationId,
				firstName: "Badge",
				lastName: "Later",
				email,
			},
			select: { id: true },
		});
		const company = await scopedDb.company.create({
			data: { organizationId, name },
			select: { id: true },
		});

		contactId = contact.id;
		companyId = company.id;

		await scopedDb.agentTask.create({
			data: {
				organizationId,
				kind,
				reason: "recheck in three months",
				dueAt: new Date(Date.now() + 90 * DAY_MS),
				budget: 4,
				contactId,
			},
		});

		await scopedDb.agentTask.create({
			data: {
				organizationId,
				kind,
				reason: "due now",
				dueAt: new Date(Date.now() - 60_000),
				budget: 4,
				companyId,
			},
		});
	});
});

afterAll(clean);

describe("the queued badge", () => {
	it("ignores a recheck booked for a later date", async () => {
		expect(await queue.queuedContacts([contactId])).not.toContain(contactId);
		expect(await queue.isQueued({ contactId })).toBe(false);
	});

	it("marks work that is due now", async () => {
		expect(await queue.queuedCompanies([companyId])).toContain(companyId);
		expect(await queue.isQueued({ companyId })).toBe(true);
	});

	it("asks for nothing when given no records", async () => {
		expect((await queue.queuedContacts([])).size).toBe(0);
		expect((await queue.queuedCompanies([])).size).toBe(0);
	});
});
