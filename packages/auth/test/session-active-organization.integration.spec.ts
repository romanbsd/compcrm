import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { auth } from "../src/auth";

const suffix = process.env.TEST_RUN_ID ?? "session-active-org-spec";

let userId: string;
let orgId: string;

const clear = async () => {
	await db.session.deleteMany({
		where: { userId: { startsWith: `${suffix}-` } },
	});
	await db.member.deleteMany({
		where: { userId: { startsWith: `${suffix}-` } },
	});
	await db.organization.deleteMany({
		where: { id: { startsWith: `${suffix}-` } },
	});
	await db.user.deleteMany({ where: { id: { startsWith: `${suffix}-` } } });
};

beforeEach(async () => {
	await clear();

	const user = await db.user.create({
		data: {
			id: `${suffix}-user`,
			name: "Test",
			email: `${suffix}@example.test`,
		},
		select: { id: true },
	});
	userId = user.id;

	const org = await db.organization.create({
		data: {
			id: `${suffix}-org`,
			name: "Org",
			slug: `${suffix}-org`,
			createdAt: new Date(),
		},
		select: { id: true },
	});
	orgId = org.id;

	await db.member.create({
		data: {
			id: `${suffix}-member`,
			organizationId: orgId,
			userId,
			role: "owner",
			createdAt: new Date(),
		},
	});
});

afterAll(clear);

describe("session create hook", () => {
	it("sets activeOrganizationId to the user's membership via the internal adapter", async () => {
		const context = await auth.$context;
		const created = await context.internalAdapter.createSession(userId);

		expect(created.activeOrganizationId).toBe(orgId);
	});
});
