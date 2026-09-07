import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type Db, db as globalDb } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { tenantContext } from "@crm/db/test-support";
import { ensureTestWorkspace } from "./workspace.fixture";

const suffix = process.env.TEST_RUN_ID ?? "company-requested-spec";
const name = `Requested Co ${suffix}`;
const reason = `A rep asked for a fresh look (${suffix})`;
const organizationId = `${suffix}-organization`;
const db = scopedDb as unknown as Db;

const agent = new AgentTriggerService(db);

let companyId: string;
let bridgeSecret: string | undefined;

const inTenant = tenantContext(organizationId);

async function clean() {
	if (companyId) await db.agentTask.deleteMany({ where: { companyId } });
	await db.company.deleteMany({ where: { name } });
	await globalDb.organization.deleteMany({ where: { id: organizationId } });
}

beforeAll(() =>
	inTenant(async () => {
		bridgeSecret = process.env.AGENT_BRIDGE_SECRET;
		process.env.AGENT_BRIDGE_SECRET = "";

		await ensureTestWorkspace(organizationId, "Company Requested Workspace");
		await db.company.deleteMany({ where: { name } });
		const company = await db.company.create({
			data: {
				organizationId,
				name,
				domain: `requested-${suffix}.test`.toLowerCase(),
			},
			select: { id: true },
		});
		companyId = company.id;
	}),
);

afterAll(() =>
	inTenant(async () => {
		await clean();

		if (bridgeSecret === undefined) {
			delete process.env.AGENT_BRIDGE_SECRET;
		} else {
			process.env.AGENT_BRIDGE_SECRET = bridgeSecret;
		}
	}),
);

describe("asking for a fresh look", () => {
	it("says what it actually queued", () =>
		inTenant(async () => {
			expect(
				await runInTenant(organizationId, () =>
					agent.companyRequested(companyId, reason),
				),
			).toBe(true);

			expect(
				await runInTenant(organizationId, () =>
					agent.companyRequested(companyId, reason),
				),
			).toBe(false);

			await db.agentTask.updateMany({
				where: { companyId, reason, finishedAt: null },
				data: { finishedAt: new Date(), outcome: "done" },
			});

			expect(
				await runInTenant(organizationId, () =>
					agent.companyRequested(companyId, reason),
				),
			).toBe(true);
		}));
});
