import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { resolveTenantForSlug } from "../lib/tenant-gate";

const suffix = process.env.TEST_RUN_ID ?? `tenant-gate-${Date.now()}`;
const ORG_ID = `${suffix}-org`;
const MEMBER_USER_ID = `${suffix}-member`;
const STRANGER_USER_ID = `${suffix}-stranger`;
const MEMBER_USER_EMAIL = `${MEMBER_USER_ID}@example.com`;
const STRANGER_USER_EMAIL = `${STRANGER_USER_ID}@example.com`;
const MEMBER_ROW_ID = `${suffix}-member-row`;
const SLUG = `${suffix}-slug`;

beforeAll(async () => {
	await db.organization.create({
		data: {
			id: ORG_ID,
			name: "Tenant gate org",
			slug: SLUG,
			createdAt: new Date(),
		},
	});

	await db.user.createMany({
		data: [
			{ id: MEMBER_USER_ID, name: "Member", email: MEMBER_USER_EMAIL },
			{ id: STRANGER_USER_ID, name: "Stranger", email: STRANGER_USER_EMAIL },
		],
	});

	await db.member.create({
		data: {
			id: MEMBER_ROW_ID,
			organizationId: ORG_ID,
			userId: MEMBER_USER_ID,
			role: "owner",
			createdAt: new Date(),
		},
	});
});

afterAll(async () => {
	await db.member.deleteMany({
		where: { organizationId: ORG_ID },
	});

	await db.user.deleteMany({
		where: {
			id: { in: [MEMBER_USER_ID, STRANGER_USER_ID] },
		},
	});

	await db.organization.deleteMany({
		where: { id: ORG_ID },
	});
});

describe("resolveTenantForSlug", () => {
	it("returns not-found for a slug with no matching organization", async () => {
		const result = await resolveTenantForSlug(
			"no-such-tenant-gate-slug",
			MEMBER_USER_ID,
		);

		expect(result.status).toBe("not-found");
	});

	it("returns forbidden for a real organization the user does not belong to", async () => {
		const result = await resolveTenantForSlug(SLUG, STRANGER_USER_ID);

		expect(result.status).toBe("forbidden");
	});

	it("returns ok and needsActiveOrgSwitch for a member whose active org differs", async () => {
		const result = await resolveTenantForSlug(
			SLUG,
			MEMBER_USER_ID,
			`${suffix}-other-org`,
		);

		expect(result).toEqual({
			status: "ok",
			organization: { id: ORG_ID, name: "Tenant gate org", slug: SLUG },
			organizations: [{ id: ORG_ID, name: "Tenant gate org", slug: SLUG }],
			needsActiveOrgSwitch: true,
		});
	});

	it("returns ok and does not need switch when session already active there", async () => {
		const result = await resolveTenantForSlug(SLUG, MEMBER_USER_ID, ORG_ID);

		expect(result).toEqual({
			status: "ok",
			organization: { id: ORG_ID, name: "Tenant gate org", slug: SLUG },
			organizations: [{ id: ORG_ID, name: "Tenant gate org", slug: SLUG }],
			needsActiveOrgSwitch: false,
		});
	});
});
