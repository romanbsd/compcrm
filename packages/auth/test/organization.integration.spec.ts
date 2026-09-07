import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import {
	activeWorkspaceRoleOf,
	resolveActiveOrganization,
	workspaceRoleOf,
} from "../src/organization";

const suffix = process.env.TEST_RUN_ID ?? "organization-spec";

const emailOf = (label: string) => `${label}.${suffix}@example.test`;

let userId: string;
let orgAId: string;
let orgBId: string;

const seedUser = async (label: string): Promise<string> => {
	const user = await db.user.create({
		data: { id: `${suffix}-${label}`, name: label, email: emailOf(label) },
		select: { id: true },
	});
	return user.id;
};

const seedOrg = async (label: string): Promise<string> => {
	const org = await db.organization.create({
		data: {
			id: `${suffix}-${label}`,
			name: label,
			slug: `${suffix}-${label}`,
			createdAt: new Date(),
		},
		select: { id: true },
	});
	return org.id;
};

const addMember = async (
	organizationId: string,
	memberUserId: string,
	role: string,
	createdAt: Date,
) => {
	await db.member.create({
		data: {
			id: `${suffix}-${organizationId}-${memberUserId}`,
			organizationId,
			userId: memberUserId,
			role,
			createdAt,
		},
	});
};

const clear = async () => {
	await db.member.deleteMany({
		where: { userId: { startsWith: `${suffix}-` } },
	});
	await db.organization.deleteMany({
		where: { id: { startsWith: `${suffix}-` } },
	});
	await db.user.deleteMany({
		where: { email: { endsWith: `.${suffix}@example.test` } },
	});
};

beforeEach(async () => {
	await clear();
	userId = await seedUser("user");
	orgAId = await seedOrg("org-a");
	orgBId = await seedOrg("org-b");
});

afterAll(clear);

describe("resolveActiveOrganization", () => {
	it("returns null for a user with no membership anywhere", async () => {
		expect(await resolveActiveOrganization(userId)).toBeNull();
	});

	it("returns the user's sole organization", async () => {
		await addMember(orgAId, userId, "member", new Date("2026-01-01T00:00:00Z"));

		expect(await resolveActiveOrganization(userId)).toBe(orgAId);
	});

	it("returns the earliest-joined organization when the user belongs to several", async () => {
		await addMember(orgBId, userId, "member", new Date("2026-02-01T00:00:00Z"));
		await addMember(orgAId, userId, "member", new Date("2026-01-01T00:00:00Z"));

		expect(await resolveActiveOrganization(userId)).toBe(orgAId);
	});

	it("does not create any organization or membership as a side effect", async () => {
		await resolveActiveOrganization(userId);

		const memberCount = await db.member.count({ where: { userId } });
		expect(memberCount).toBe(0);
	});
});

describe("workspaceRoleOf", () => {
	it("returns the role for the given user in the given organization", async () => {
		await addMember(orgAId, userId, "admin", new Date());

		expect(await workspaceRoleOf(userId, orgAId)).toBe("admin");
	});

	it("returns null when the user is not a member of that organization", async () => {
		await addMember(orgAId, userId, "admin", new Date());

		expect(await workspaceRoleOf(userId, orgBId)).toBeNull();
	});

	it("keeps roles isolated across a user's two organizations", async () => {
		await addMember(orgAId, userId, "owner", new Date());
		await addMember(orgBId, userId, "member", new Date());

		expect(await workspaceRoleOf(userId, orgAId)).toBe("owner");
		expect(await workspaceRoleOf(userId, orgBId)).toBe("member");
	});
});

describe("activeWorkspaceRoleOf", () => {
	it("reads the role from the active organization", async () => {
		await addMember(orgAId, userId, "admin", new Date());
		await addMember(orgBId, userId, "member", new Date());

		expect(await runInTenant(orgAId, () => activeWorkspaceRoleOf(userId))).toBe(
			"admin",
		);
		expect(await runInTenant(orgBId, () => activeWorkspaceRoleOf(userId))).toBe(
			"member",
		);
	});
});
