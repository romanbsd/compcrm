import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import {
	builderContext,
	saveBuilderDraft,
	writeBuilderArtifact,
} from "../agent/lib/builder-runtime";
import { tenantTransaction } from "@crm/db/tenant-scope";

const suffix = crypto.randomUUID();
const ORG_A = `builder-runtime-tenant-a-${suffix}`;
const ORG_B = `builder-runtime-tenant-b-${suffix}`;
const USER_ID = `builder-runtime-user-${suffix}`;

let conversationId = "";
let agentId = "";

const draft = {
	name: "Tenant pipeline summary",
	description: "Summarize the tenant pipeline.",
	instructions:
		"When manually triggered, read the approved workspace records and return one concise pipeline summary without changing CRM records.",
	triggers: [
		{
			type: "MANUAL" as const,
			name: "Manual",
			summary: "Run when a teammate requests a pipeline summary.",
		},
	],
	recordScope: "WORKSPACE" as const,
	resources: [],
	actions: [
		{
			type: "run.summary" as const,
			provider: "crm" as const,
			summary: "Write a pipeline summary.",
		},
	],
	access: ["Read workspace CRM records"],
};

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: ORG_A,
				name: "Builder Runtime Tenant A",
				slug: ORG_A,
				createdAt: new Date(),
			},
			{
				id: ORG_B,
				name: "Builder Runtime Tenant B",
				slug: ORG_B,
				createdAt: new Date(),
			},
		],
	});
	await db.user.create({
		data: {
			id: USER_ID,
			name: "Builder Runtime User",
			email: `${USER_ID}@example.test`,
		},
	});
	conversationId = await tenantTransaction(ORG_A, async (tx) => {
		const conversation = await tx.agentConversation.create({
			data: { kind: "BUILDER", userId: USER_ID },
			select: { id: true },
		});
		return conversation.id;
	});
});

afterAll(async () => {
	await tenantTransaction(ORG_A, async (tx) => {
		await tx.agentBuilderArtifact.deleteMany({
			where: { conversationId },
		});
		if (agentId) {
			await tx.agentAuditEvent.deleteMany({ where: { agentId } });
			await tx.agentTrigger.deleteMany({ where: { agentId } });
			await tx.agentDefinition.updateMany({
				where: { id: agentId },
				data: { currentVersionId: null },
			});
			await tx.agentVersion.deleteMany({ where: { agentId } });
			await tx.agentDefinition.deleteMany({ where: { id: agentId } });
		}
		await tx.agentConversation.deleteMany({ where: { id: conversationId } });
	});
	await db.user.deleteMany({ where: { id: USER_ID } });
	await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
});

describe("builder runtime tenant scope", () => {
	it("persists builder output for its tenant and rejects another tenant", async () => {
		await expect(
			writeBuilderArtifact(
				ORG_B,
				conversationId,
				USER_ID,
				"agent/instructions.md",
				`${draft.instructions}\n`,
			),
		).rejects.toThrow("This builder conversation is unavailable.");

		const artifact = await writeBuilderArtifact(
			ORG_A,
			conversationId,
			USER_ID,
			"agent/instructions.md",
			`${draft.instructions}\n`,
		);
		expect(artifact).toMatchObject({ saved: true, revision: 1 });

		await expect(
			saveBuilderDraft(ORG_B, conversationId, USER_ID, draft),
		).rejects.toThrow("This builder conversation is unavailable.");

		const saved = await saveBuilderDraft(ORG_A, conversationId, USER_ID, draft);
		if (!saved.saved) throw new Error("Tenant draft was not saved");
		agentId = saved.agentId;

		await expect(
			builderContext(ORG_B, conversationId, USER_ID),
		).rejects.toThrow("This builder conversation is unavailable.");
		const context = await builderContext(ORG_A, conversationId, USER_ID);
		expect(context).toMatchObject({
			conversation: { id: conversationId, title: draft.name },
			existingDraft: {
				id: saved.agentId,
				name: draft.name,
				versions: [{ id: saved.versionId, number: 1, status: "READY" }],
			},
		});

		const persisted = await tenantTransaction(ORG_A, async (tx) => ({
			definition: await tx.agentDefinition.findUnique({
				where: { id: saved.agentId },
				select: { organizationId: true },
			}),
			version: await tx.agentVersion.findUnique({
				where: { id: saved.versionId },
				select: { organizationId: true },
			}),
			artifacts: await tx.agentBuilderArtifact.findMany({
				where: { conversationId },
				orderBy: { path: "asc" },
				select: { organizationId: true, path: true, status: true },
			}),
			triggers: await tx.agentTrigger.findMany({
				where: { agentId: saved.agentId },
				select: { organizationId: true, type: true },
			}),
			auditEvents: await tx.agentAuditEvent.findMany({
				where: { agentId: saved.agentId },
				orderBy: { type: "asc" },
				select: { organizationId: true, type: true },
			}),
		}));

		expect(persisted.definition).toEqual({ organizationId: ORG_A });
		expect(persisted.version).toEqual({ organizationId: ORG_A });
		expect(persisted.artifacts).toHaveLength(3);
		expect(persisted.artifacts).toEqual(
			expect.arrayContaining([
				{
					organizationId: ORG_A,
					path: "agent/README.md",
					status: "READY",
				},
				{
					organizationId: ORG_A,
					path: "agent/instructions.md",
					status: "READY",
				},
				{
					organizationId: ORG_A,
					path: "agent/manifest.json",
					status: "READY",
				},
			]),
		);
		expect(persisted.triggers).toEqual([
			{ organizationId: ORG_A, type: "MANUAL" },
		]);
		expect(persisted.auditEvents).toEqual([
			{ organizationId: ORG_A, type: "agent.created" },
			{ organizationId: ORG_A, type: "version.created" },
		]);

		const otherTenantRows = await tenantTransaction(ORG_B, async (tx) =>
			Promise.all([
				tx.agentConversation.count({
					where: { id: conversationId, organizationId: ORG_B },
				}),
				tx.agentBuilderArtifact.count({
					where: { conversationId, organizationId: ORG_B },
				}),
				tx.agentDefinition.count({
					where: { id: saved.agentId, organizationId: ORG_B },
				}),
				tx.agentVersion.count({
					where: { id: saved.versionId, organizationId: ORG_B },
				}),
			]),
		);
		expect(otherTenantRows).toEqual([0, 0, 0, 0]);
	});
});
