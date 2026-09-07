import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "./client";
import { queueSlackInventorySync, SLACK_INVENTORY } from "./slack-inventory";
import { runInTenant } from "./tenant-context";
import { scopedTransaction } from "./tenant-scope";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const organizationId = `slack-inventory-${suffix}`;

beforeAll(async () => {
	await db.organization.create({
		data: {
			id: organizationId,
			name: `Slack inventory ${suffix}`,
			slug: organizationId,
			createdAt: new Date(),
		},
	});
});

afterAll(async () => {
	await runInTenant(organizationId, () =>
		scopedTransaction((tx) =>
			tx.agentTask.deleteMany({ where: { organizationId } }),
		),
	);
	await db.organization.delete({ where: { id: organizationId } });
});

describe("Slack inventory queue", () => {
	it("enters the organization tenant before creating work", async () => {
		const reason = `Refresh Slack inventory ${suffix}`;

		await queueSlackInventorySync(reason, organizationId);

		const task = await runInTenant(organizationId, () =>
			scopedTransaction((tx) =>
				tx.agentTask.findFirst({
					where: { organizationId, kind: SLACK_INVENTORY.kind },
				}),
			),
		);

		expect(task?.organizationId).toBe(organizationId);
		expect(task?.reason).toBe(reason);
	});

	it("keeps one recent task for the organization", async () => {
		await queueSlackInventorySync(`Duplicate ${suffix}`, organizationId);

		const count = await runInTenant(organizationId, () =>
			scopedTransaction((tx) =>
				tx.agentTask.count({
					where: { organizationId, kind: SLACK_INVENTORY.kind },
				}),
			),
		);

		expect(count).toBe(1);
	});
});
