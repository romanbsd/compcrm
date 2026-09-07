import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { WorkspaceService } from "../src/workspace/workspace.service";

const suffix =
	process.env.TEST_RUN_ID ?? `workspace-gate-${crypto.randomUUID()}`;
const organizationId = `${suffix}-organization`;
const userId = `${suffix}-user`;
const memberId = `${suffix}-member`;
const service = new WorkspaceService(db, {} as never);

beforeAll(async () => {
	await db.organization.create({
		data: {
			id: organizationId,
			name: "Workspace Gate",
			slug: `${suffix}-slug`,
			metadata: JSON.stringify({ onboardedAt: new Date().toISOString() }),
			createdAt: new Date(),
		},
	});
	await db.user.create({
		data: {
			id: userId,
			name: "Workspace Gate User",
			email: `${userId}@example.test`,
		},
	});
	await db.member.create({
		data: {
			id: memberId,
			organizationId,
			userId,
			role: "owner",
			createdAt: new Date(),
		},
	});
});

afterAll(async () => {
	await db.member.deleteMany({ where: { id: memberId } });
	await db.user.deleteMany({ where: { id: userId } });
	await db.organization.deleteMany({ where: { id: organizationId } });
});

describe("WorkspaceService.gate", () => {
	it("returns an explicit no-organization result", async () => {
		expect(await service.gate(userId, null)).toEqual({
			organizationId: null,
			slug: null,
			onboarded: null,
			canRename: null,
		});
	});

	it("returns the active member organization gate", async () => {
		expect(await service.gate(userId, organizationId)).toEqual({
			organizationId,
			slug: `${suffix}-slug`,
			onboarded: true,
			canRename: true,
		});
	});
});
