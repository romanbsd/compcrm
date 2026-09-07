import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "./client";
import { runInTenant } from "./tenant-context";
import { scopedDb } from "./tenant-scope";

const ORG_A = "test-track-org-a";
const ORG_B = "test-track-org-b";

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{ id: ORG_A, name: "Org A", slug: "track-org-a", createdAt: new Date() },
			{ id: ORG_B, name: "Org B", slug: "track-org-b", createdAt: new Date() },
		],
		skipDuplicates: true,
	});
});

afterAll(async () => {
	for (const organizationId of [ORG_A, ORG_B]) {
		await runInTenant(organizationId, () =>
			scopedDb.trackedDomain.deleteMany(),
		);
	}
	await db.organization.deleteMany({
		where: { id: { in: [ORG_A, ORG_B] } },
	});
});

describe("tracking tenant scoping", () => {
	it("lets two tenants each track the same host", async () => {
		const host = "shared-client-site.com";

		const a = await runInTenant(ORG_A, () =>
			scopedDb.trackedDomain.create({ data: { host } }),
		);
		const b = await runInTenant(ORG_B, () =>
			scopedDb.trackedDomain.create({ data: { host } }),
		);

		expect(a.host).toBe(host);
		expect(b.host).toBe(host);
	});
});
