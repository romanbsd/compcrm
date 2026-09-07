import { describe, expect } from "bun:test";
import {
	DEFAULT_AGENT_MODEL,
	readAgentModel as readAgentModelWithoutTenant,
	writeAgentModel as writeAgentModelWithoutTenant,
} from "@crm/db/settings";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb as db } from "@crm/db/tenant-scope";
import { selectedModel as selectedModelWithoutTenant } from "../agent/lib/model";
import {
	tenantAfterAll,
	tenantAfterEach,
	tenantBeforeAll,
	tenantBeforeEach,
	tenantTest,
} from "@crm/db/test-support";

const testPrefix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const organizationId = `model-test-org-${testPrefix}`;
const it = tenantTest(organizationId);
const beforeAll = tenantBeforeAll(organizationId);
const beforeEach = tenantBeforeEach(organizationId);
const afterEach = tenantAfterEach(organizationId);
const afterAll = tenantAfterAll(organizationId);
const readAgentModel: typeof readAgentModelWithoutTenant = (client) =>
	runInTenant(organizationId, () => readAgentModelWithoutTenant(client));
const writeAgentModel: typeof writeAgentModelWithoutTenant = (client, input) =>
	runInTenant(organizationId, () =>
		writeAgentModelWithoutTenant(client, input),
	);
const selectedModel: typeof selectedModelWithoutTenant = () =>
	runInTenant(organizationId, selectedModelWithoutTenant);

async function clear() {
	await db.appSetting.deleteMany({ where: { organizationId } });
}

beforeAll(async () => {
	await db.organization.create({
		data: {
			id: organizationId,
			name: `Model test ${testPrefix}`,
			slug: `model-test-${testPrefix}`,
			createdAt: new Date(),
		},
	});
});

beforeEach(clear);
afterEach(clear);

afterAll(async () => {
	await db.organization.delete({ where: { id: organizationId } });
});

describe("the configured model", () => {
	it("falls back when nothing has ever been chosen", async () => {
		const setting = await readAgentModel(db);

		expect(setting.id).toBe(DEFAULT_AGENT_MODEL.id);
		expect(setting.isDefault).toBe(true);

		expect(await selectedModel()).toBeNull();
	});

	it("returns the chosen model with its own context window", async () => {
		await writeAgentModel(db, {
			id: "anthropic/claude-sonnet-5",
			contextWindowTokens: 200_000,
		});

		expect(await selectedModel()).toEqual({
			model: "anthropic/claude-sonnet-5",
			modelContextWindowTokens: 200_000,
		});
	});

	it("goes back to the fallback when the choice is cleared", async () => {
		await writeAgentModel(db, {
			id: "anthropic/claude-sonnet-5",
			contextWindowTokens: 200_000,
		});
		await writeAgentModel(db, null);

		expect(await selectedModel()).toBeNull();
		expect((await readAgentModel(db)).isDefault).toBe(true);
	});

	it("keeps one row rather than accumulating one per change", async () => {
		await writeAgentModel(db, { id: "openai/gpt-5.5", contextWindowTokens: 1 });
		await writeAgentModel(db, { id: "zai/glm-5.2", contextWindowTokens: 2 });

		expect(await db.appSetting.count({ where: { organizationId } })).toBe(1);
		expect((await readAgentModel(db)).id).toBe("zai/glm-5.2");
	});
});
