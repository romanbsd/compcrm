import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "./client";
import { DEFAULT_REPORTING_CURRENCY } from "./currency";
import type { Prisma } from "./generated/prisma/client";
import {
	DEFAULT_AGENT_MODEL,
	readAgentModel,
	readContextDevKey,
	readRatesRefreshedAt,
	readReportingCurrency,
	writeAgentModel,
	writeContextDevKey,
	writeRatesRefreshedAt,
	writeReportingCurrency,
} from "./settings";
import { runInTenant, TenantContextError } from "./tenant-context";
import { scopedTransaction } from "./tenant-scope";

const testPrefix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ORG_A = `settingsfn-org-a-${testPrefix}`;
const ORG_B = `settingsfn-org-b-${testPrefix}`;

const inTenant = <T>(
	organizationId: string,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
) => runInTenant(organizationId, () => scopedTransaction(work));

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: ORG_A,
				name: `Org A ${testPrefix}`,
				slug: `settingsfn-org-a-${testPrefix}`,
				createdAt: new Date(),
			},
			{
				id: ORG_B,
				name: `Org B ${testPrefix}`,
				slug: `settingsfn-org-b-${testPrefix}`,
				createdAt: new Date(),
			},
		],
		skipDuplicates: true,
	});
});

afterAll(async () => {
	for (const organizationId of [ORG_A, ORG_B]) {
		await inTenant(organizationId, (tx) => tx.appSetting.deleteMany());
	}
	await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
});

describe("settings readers/writers outside any tenant context", () => {
	it("throw TenantContextError rather than reading anyone's row", async () => {
		await expect(readAgentModel(db)).rejects.toThrow(TenantContextError);
		await expect(readContextDevKey(db)).rejects.toThrow(TenantContextError);
		await expect(readReportingCurrency(db)).rejects.toThrow(TenantContextError);
		await expect(readRatesRefreshedAt(db)).rejects.toThrow(TenantContextError);
	});
});

describe("settings readers/writers inside tenant context", () => {
	it("keeps the agent model choice isolated per organization", async () => {
		await inTenant(ORG_A, (tx) =>
			writeAgentModel(tx, {
				id: "openai/gpt-5.5",
				contextWindowTokens: 1,
			}),
		);

		const inA = await inTenant(ORG_A, (tx) => readAgentModel(tx));
		const inB = await inTenant(ORG_B, (tx) => readAgentModel(tx));

		expect(inA.id).toBe("openai/gpt-5.5");
		expect(inA.isDefault).toBe(false);
		expect(inB.isDefault).toBe(true);
		expect(inB.id).toBe(DEFAULT_AGENT_MODEL.id);
	});

	it("keeps the Context.dev key isolated per organization", async () => {
		await inTenant(ORG_A, (tx) => writeContextDevKey(tx, "key-a"));

		expect(await inTenant(ORG_A, (tx) => readContextDevKey(tx))).toBe("key-a");
		expect(await inTenant(ORG_B, (tx) => readContextDevKey(tx))).toBeNull();
	});

	it("keeps the reporting currency isolated per organization", async () => {
		await inTenant(ORG_A, (tx) => writeReportingCurrency(tx, "EUR"));

		expect(await inTenant(ORG_A, (tx) => readReportingCurrency(tx))).toBe(
			"EUR",
		);
		expect(await inTenant(ORG_B, (tx) => readReportingCurrency(tx))).toBe(
			DEFAULT_REPORTING_CURRENCY,
		);
	});

	it("keeps the rates-refreshed timestamp isolated per organization", async () => {
		const at = new Date("2026-08-01T00:00:00.000Z");
		await inTenant(ORG_A, (tx) => writeRatesRefreshedAt(tx, at));

		expect(await inTenant(ORG_A, (tx) => readRatesRefreshedAt(tx))).toEqual(at);
		expect(await inTenant(ORG_B, (tx) => readRatesRefreshedAt(tx))).toBeNull();
	});
});
