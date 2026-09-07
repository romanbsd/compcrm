import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, type Prisma } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import type { ScopedDb } from "@crm/db/tenant-scope";
import { scopedDb } from "@crm/db/tenant-scope";
import { ConflictException } from "@nestjs/common";
import { AgentQueueService } from "../src/agent/agent-queue.service";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { CompanyDirectoryService } from "../src/companies/company-directory.service";
import { ContactsService } from "../src/contacts/contacts.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { FieldsService } from "../src/fields/fields.service";

const suffix = process.env.TEST_RUN_ID ?? "contacts-tenant-scope-spec";
const orgAId = `${suffix}-org-a`;
const orgBId = `${suffix}-org-b`;
const sharedEmail = `shared-${suffix}@example.test`;
const scoped = scopedDb as unknown as ScopedDb;

const agent = {
	withCrmEvents: (
		work: (tx: Prisma.TransactionClient, emit: unknown) => unknown,
	) =>
		scopedDb.$transaction(
			async (tx) =>
				await work(
					tx as unknown as Prisma.TransactionClient,
					async () => undefined,
				),
		),
	companyCreated: async () => undefined,
	contactCreated: async () => undefined,
} as unknown as AgentTriggerService;

const directory = new CompanyDirectoryService(agent);
const queue = new AgentQueueService(scoped);
const stamp = new ActivityStampService(scoped);
const fields = new FieldsService(scoped, agent);
const contacts = new ContactsService(
	scoped,
	directory,
	agent,
	queue,
	stamp,
	fields,
);

async function clear(): Promise<void> {
	await db.contact.deleteMany({
		where: { organizationId: { in: [orgAId, orgBId] } },
	});
	await db.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
}

beforeAll(async () => {
	await clear();
	await db.organization.createMany({
		data: [
			{ id: orgAId, name: "Org A", slug: orgAId, createdAt: new Date() },
			{ id: orgBId, name: "Org B", slug: orgBId, createdAt: new Date() },
		],
	});
});

afterAll(clear);

describe("ContactsService.create under tenant scope", () => {
	it("allows one email address in separate organizations", async () => {
		const inA = await runInTenant(orgAId, () =>
			contacts.create({ firstName: "A", email: sharedEmail } as never),
		);
		const inB = await runInTenant(orgBId, () =>
			contacts.create({ firstName: "B", email: sharedEmail } as never),
		);

		expect(inA.id).not.toBe(inB.id);
	});

	it("rejects duplicate email addresses in one organization", async () => {
		await expect(
			runInTenant(orgAId, () =>
				contacts.create({ firstName: "A Again", email: sharedEmail } as never),
			),
		).rejects.toThrow(ConflictException);
	});
});
