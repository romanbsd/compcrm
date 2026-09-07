import { describe, expect } from "bun:test";
import { EnrichmentStatus } from "@crm/db";
import { scopedDb as db } from "@crm/db/tenant-scope";
import { closeTask, taskToken } from "../agent/channels/crm";
import { tenantAfterEach, tenantBeforeEach, tenantTest } from "@crm/db/test-support";

const kind = "identify";
const email = `close-task-${crypto.randomUUID()}@example.test`;
const organizationId = "workspace";
const it = tenantTest(organizationId);
const beforeEach = tenantBeforeEach(organizationId);
const afterEach = tenantAfterEach(organizationId);

const taskIds: string[] = [];

async function clear() {
	if (taskIds.length > 0) {
		await db.agentTask.deleteMany({ where: { id: { in: taskIds.splice(0) } } });
	}
	await db.contact.deleteMany({ where: { email } });
	await db.organization.upsert({
		where: { id: organizationId },
		create: {
			id: organizationId,
			name: "Workspace",
			slug: "workspace",
			createdAt: new Date(),
		},
		update: {},
	});
}

beforeEach(clear);
afterEach(clear);

async function running() {
	const contact = await db.contact.create({
		data: {
			firstName: "Close",
			email,
			organizationId,
			enrichmentStatus: EnrichmentStatus.RUNNING,
		},
		select: { id: true },
	});

	const task = await db.agentTask.create({
		data: {
			organizationId,
			kind,
			reason: "test",
			dueAt: new Date(Date.now() - 1000),
			budget: 4,
			contactId: contact.id,
			startedAt: new Date(),
			attempts: 1,
		},
		select: { id: true },
	});

	taskIds.push(task.id);

	return { contactId: contact.id, taskId: task.id };
}

describe("closeTask", () => {
	it("closes the row and marks the record complete", async () => {
		const { contactId, taskId } = await running();

		expect(await closeTask(taskToken(taskId), "ran")).toBe(true);

		const task = await db.agentTask.findUnique({ where: { id: taskId } });
		expect(task?.finishedAt).not.toBeNull();
		expect(task?.outcome).toBe("ran");

		const contact = await db.contact.findUnique({ where: { id: contactId } });
		expect(contact?.enrichmentStatus).toBe(EnrichmentStatus.COMPLETE);
		expect(contact?.enrichedAt).not.toBeNull();
	});

	it("marks the record skipped when the turn is stopped", async () => {
		const { contactId, taskId } = await running();

		expect(
			await closeTask(taskToken(taskId), "stopped", EnrichmentStatus.SKIPPED),
		).toBe(true);

		const contact = await db.contact.findUnique({ where: { id: contactId } });
		expect(contact?.enrichmentStatus).toBe(EnrichmentStatus.SKIPPED);
	});

	it("claims a task token it has already closed", async () => {
		const { taskId } = await running();

		await closeTask(taskToken(taskId), "ran");
		expect(await closeTask(taskToken(taskId), "ran again")).toBe(true);

		const task = await db.agentTask.findUnique({ where: { id: taskId } });
		expect(task?.outcome).toBe("ran");
	});

	it("leaves a token that names no task alone", async () => {
		expect(await closeTask("crm:adhoc:1234", "ran")).toBe(false);
		expect(await closeTask(undefined, "ran")).toBe(false);
	});
});
