import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "./client";
import { Prisma } from "./generated/prisma/client";
import { runInTenant, TenantContextError } from "./tenant-context";
import { scopedDb, scopedTransaction } from "./tenant-scope";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ORG_A = `sso-scope-org-a-${suffix}`;
const ORG_B = `sso-scope-org-b-${suffix}`;
const PROVIDER_A = `sso-scope-provider-a-${suffix}`;
const PROVIDER_B = `sso-scope-provider-b-${suffix}`;

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: ORG_A,
				name: `SSO Scope A ${suffix}`,
				slug: ORG_A,
				createdAt: new Date(),
			},
			{
				id: ORG_B,
				name: `SSO Scope B ${suffix}`,
				slug: ORG_B,
				createdAt: new Date(),
			},
		],
	});
});

afterAll(async () => {
	for (const organizationId of [ORG_A, ORG_B]) {
		await runInTenant(organizationId, () =>
			scopedTransaction((tx) => tx.ssoProvider.deleteMany()),
		);
	}
	await db.organization.deleteMany({
		where: { id: { in: [ORG_A, ORG_B] } },
	});
});

describe("SsoProvider tenant scoping", () => {
	it("requires organizationId at the database level", async () => {
		await expect(
			Promise.resolve(
				db.$executeRaw(
					Prisma.sql`INSERT INTO "ssoProvider" ("id", "issuer", "providerId", "domain") VALUES (${`sso-scope-no-org-${suffix}`}, ${"https://issuer.example.com"}, ${`sso-scope-no-org-${suffix}`}, ${"example.com"})`,
				),
			),
		).rejects.toThrow();
	});

	it("throws outside tenant context", async () => {
		await expect(
			Promise.resolve(scopedDb.ssoProvider.findMany()),
		).rejects.toThrow(TenantContextError);
	});

	it("defaults and isolates providers", async () => {
		await runInTenant(ORG_A, () =>
			scopedDb.ssoProvider.create({
				data: {
					id: `sso-scope-row-a-${suffix}`,
					providerId: PROVIDER_A,
					issuer: "https://issuer-a.example.com",
					domain: "a.example.com",
				},
			}),
		);
		await runInTenant(ORG_B, () =>
			scopedDb.ssoProvider.create({
				data: {
					id: `sso-scope-row-b-${suffix}`,
					providerId: PROVIDER_B,
					issuer: "https://issuer-b.example.com",
					domain: "b.example.com",
				},
			}),
		);

		const seenFromA = await runInTenant(ORG_A, () =>
			scopedDb.ssoProvider.findMany({ orderBy: { providerId: "asc" } }),
		);

		expect(seenFromA.map((row) => row.providerId)).toEqual([PROVIDER_A]);
		expect(seenFromA[0]?.organizationId).toBe(ORG_A);
	});
});
