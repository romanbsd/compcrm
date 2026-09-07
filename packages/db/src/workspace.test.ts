import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "./client";
import type { Prisma } from "./generated/prisma/client";
import { runInTenant, TenantContextError } from "./tenant-context";
import { scopedTransaction } from "./tenant-scope";
import {
	readWorkspaceIdentity,
	readWorkspaceProfile,
	writeWorkspaceProfile,
} from "./workspace";

const testPrefix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ORG_A = `workspacefn-org-a-${testPrefix}`;
const ORG_B = `workspacefn-org-b-${testPrefix}`;

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
				slug: `workspacefn-org-a-${testPrefix}`,
				website: "https://a.example.com",
				createdAt: new Date(),
			},
			{
				id: ORG_B,
				name: `Org B ${testPrefix}`,
				slug: `workspacefn-org-b-${testPrefix}`,
				website: "https://b.example.com",
				createdAt: new Date(),
			},
		],
		skipDuplicates: true,
	});
});

afterAll(async () => {
	for (const organizationId of [ORG_A, ORG_B]) {
		await inTenant(organizationId, (tx) => tx.workspaceProfile.deleteMany());
	}
	await db.organization.deleteMany({
		where: { id: { in: [ORG_A, ORG_B] } },
	});
});

describe("workspace readers/writers outside any tenant context", () => {
	it("throw TenantContextError rather than reading anyone's profile", async () => {
		await expect(readWorkspaceProfile(db)).rejects.toThrow(TenantContextError);
		await expect(readWorkspaceIdentity(db)).rejects.toThrow(TenantContextError);
	});
});

describe("workspace readers/writers inside tenant context", () => {
	it("keeps the workspace profile isolated per organization", async () => {
		await inTenant(ORG_A, (tx) =>
			writeWorkspaceProfile(tx, {
				website: "https://a.example.com",
				narrative: "Sells compliance automation to mid-market SaaS.",
				sections: {
					sells: "Compliance automation",
					sellsTo: "Mid-market SaaS",
				},
			}),
		);

		const inA = await inTenant(ORG_A, (tx) => readWorkspaceProfile(tx));
		const inB = await inTenant(ORG_B, (tx) => readWorkspaceProfile(tx));

		expect(inA?.narrative).toBe(
			"Sells compliance automation to mid-market SaaS.",
		);
		expect(inB).toBeNull();
	});

	it("resolves readWorkspaceIdentity to the active organization, not a fixed one", async () => {
		const identityA = await inTenant(ORG_A, (tx) => readWorkspaceIdentity(tx));
		const identityB = await inTenant(ORG_B, (tx) => readWorkspaceIdentity(tx));

		expect(identityA?.name).toBe(`Org A ${testPrefix}`);
		expect(identityA?.website).toBe("https://a.example.com");
		expect(identityB?.name).toBe(`Org B ${testPrefix}`);
		expect(identityB?.website).toBe("https://b.example.com");
	});

	it("keeps stale profile handling tenant-local", async () => {
		await inTenant(ORG_A, (tx) =>
			writeWorkspaceProfile(tx, {
				website: "https://stale-a.example.com",
				narrative: "Legacy profile URL",
				sections: { sells: "Legacy sells", sellsTo: "Legacy sells-to" },
			}),
		);
		await inTenant(ORG_B, (tx) =>
			writeWorkspaceProfile(tx, {
				website: "https://b.example.com",
				narrative: "Active profile URL",
				sections: { sells: "Compliance", sellsTo: "Small teams" },
			}),
		);

		await db.organization.update({
			where: { id: ORG_A },
			data: { website: "https://renamed-a.example.com" },
		});

		const inA = await inTenant(ORG_A, (tx) => readWorkspaceIdentity(tx));
		const inB = await inTenant(ORG_B, (tx) => readWorkspaceIdentity(tx));

		expect(inA?.profile).toBeNull();
		expect(inB?.profile).not.toBeNull();
		expect(inB?.profile?.website).toBe("https://b.example.com");
	});
});
