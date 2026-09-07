import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import { runDirect } from "../agent/lib/dispatch";
import { claimDue, type LeasedTask } from "../agent/lib/tasks";

const suffix = crypto.randomUUID();
const ORG_A = `dispatch-tenant-org-a-${suffix}`;
const ORG_B = `dispatch-tenant-org-b-${suffix}`;
const TASK_KIND = `dispatch-tenant-test-${suffix}`;

let companyAId = "";
let companyBId = "";
let taskAId = "";
let taskBId = "";

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: ORG_A,
				name: "Org A",
				slug: `dispatch-tenant-org-a-${suffix}`,
				createdAt: new Date(),
			},
			{
				id: ORG_B,
				name: "Org B",
				slug: `dispatch-tenant-org-b-${suffix}`,
				createdAt: new Date(),
			},
		],
		skipDuplicates: true,
	});

	const dueAt = new Date(Date.now() - 1000);
	const [companyA, companyB] = await Promise.all([
		runInTenant(ORG_A, () =>
			scopedDb.company.create({
				data: { organizationId: ORG_A, name: "Acme A" },
				select: { id: true },
			}),
		),
		runInTenant(ORG_B, () =>
			scopedDb.company.create({
				data: { organizationId: ORG_B, name: "Acme B" },
				select: { id: true },
			}),
		),
	]);
	companyAId = companyA.id;
	companyBId = companyB.id;

	const [taskA, taskB] = await Promise.all([
		runInTenant(ORG_A, () =>
			scopedDb.agentTask.create({
				data: {
					organizationId: ORG_A,
					companyId: companyAId,
					kind: TASK_KIND,
					reason: "test",
					dueAt,
					budget: 4,
				},
				select: { id: true },
			}),
		),
		runInTenant(ORG_B, () =>
			scopedDb.agentTask.create({
				data: {
					organizationId: ORG_B,
					companyId: companyBId,
					kind: TASK_KIND,
					reason: "test",
					dueAt,
					budget: 4,
				},
				select: { id: true },
			}),
		),
	]);
	taskAId = taskA.id;
	taskBId = taskB.id;
});

afterAll(async () => {
	await Promise.all([
		runInTenant(ORG_A, () =>
			scopedDb.agentTask.deleteMany({ where: { id: taskAId } }),
		),
		runInTenant(ORG_B, () =>
			scopedDb.agentTask.deleteMany({ where: { id: taskBId } }),
		),
		runInTenant(ORG_A, () =>
			scopedDb.company.deleteMany({ where: { id: companyAId } }),
		),
		runInTenant(ORG_B, () =>
			scopedDb.company.deleteMany({ where: { id: companyBId } }),
		),
	]);
	await db.organization.deleteMany({
		where: { id: { in: [ORG_A, ORG_B] } },
	});
});

async function writeTenantMarker(task: LeasedTask): Promise<void> {
	if (!task.companyId) throw new Error("Test task has no company.");

	await scopedDb.company.update({
		where: { id: task.companyId },
		data: { description: `handled by ${task.organizationId}` },
	});
}

describe("runDirect across orgs", () => {
	it("claims both tasks, keeps data in tenant scope, and never leaks reads", async () => {
		const claimed = await claimDue(10, { only: [TASK_KIND] });
		expect(claimed).toHaveLength(2);

		const organizationById = new Map(
			claimed.map((task) => [task.id, task.organizationId]),
		);
		expect(organizationById.get(taskAId)).toBe(ORG_A);
		expect(organizationById.get(taskBId)).toBe(ORG_B);
		expect(organizationById.get(taskAId)).not.toBe(
			organizationById.get(taskBId),
		);

		const claimedA = claimed.find((task) => task.id === taskAId);
		const claimedB = claimed.find((task) => task.id === taskBId);
		if (!claimedA || !claimedB)
			throw new Error("Both test tasks must be claimable.");

		await Promise.all([
			runDirect(claimedB, writeTenantMarker),
			runDirect(claimedA, writeTenantMarker),
		]);

		const [companyA, companyB] = await Promise.all([
			runInTenant(ORG_A, () =>
				scopedDb.company.findUnique({
					where: { id: companyAId },
					select: { description: true, organizationId: true },
				}),
			),
			runInTenant(ORG_B, () =>
				scopedDb.company.findUnique({
					where: { id: companyBId },
					select: { description: true, organizationId: true },
				}),
			),
		]);

		expect(companyA?.organizationId).toBe(ORG_A);
		expect(companyB?.organizationId).toBe(ORG_B);
		expect(companyA?.description).toBe(`handled by ${ORG_A}`);
		expect(companyB?.description).toBe(`handled by ${ORG_B}`);

		const [taskInWrongOrgA, taskInWrongOrgB] = await Promise.all([
			runInTenant(ORG_A, () =>
				scopedDb.agentTask.findUnique({ where: { id: taskBId } }),
			),
			runInTenant(ORG_B, () =>
				scopedDb.agentTask.findUnique({ where: { id: taskAId } }),
			),
		]);
		expect(taskInWrongOrgA).toBeNull();
		expect(taskInWrongOrgB).toBeNull();

		const [companyInWrongOrgA, companyInWrongOrgB] = await Promise.all([
			runInTenant(ORG_A, () =>
				scopedDb.company.findUnique({ where: { id: companyBId } }),
			),
			runInTenant(ORG_B, () =>
				scopedDb.company.findUnique({ where: { id: companyAId } }),
			),
		]);
		expect(companyInWrongOrgA).toBeNull();
		expect(companyInWrongOrgB).toBeNull();
	});
});
