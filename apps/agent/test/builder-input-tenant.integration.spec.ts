import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { persistBuilderInputRequest } from "../agent/lib/builder-input";
import { builderToken } from "../agent/lib/custom-agent-dispatch";
import { tenantTransaction } from "@crm/db/tenant-scope";

const suffix = crypto.randomUUID();
const ORG_A = `builder-input-tenant-a-${suffix}`;
const ORG_B = `builder-input-tenant-b-${suffix}`;
const USER_ID = `builder-input-user-${suffix}`;
const SESSION_ID = `builder-input-session-${suffix}`;

let conversationId = "";

function event(requestId: string, prompt: string) {
	return {
		requests: [
			{
				kind: "question" as const,
				requestId,
				prompt,
				action: {
					kind: "tool-call" as const,
					callId: `call-${requestId}`,
					toolName: "ask_question",
					input: { prompt },
				},
				display: "text" as const,
			},
		],
		sequence: 1,
		stepIndex: 0,
		turnId: `turn-${requestId}`,
	};
}

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: ORG_A,
				name: "Builder Input Tenant A",
				slug: ORG_A,
				createdAt: new Date(),
			},
			{
				id: ORG_B,
				name: "Builder Input Tenant B",
				slug: ORG_B,
				createdAt: new Date(),
			},
		],
	});
	await db.user.create({
		data: {
			id: USER_ID,
			name: "Builder Input User",
			email: `${USER_ID}@example.test`,
		},
	});
	conversationId = await tenantTransaction(ORG_A, async (tx) => {
		const conversation = await tx.agentConversation.create({
			data: {
				kind: "BUILDER",
				userId: USER_ID,
				sessionId: SESSION_ID,
			},
			select: { id: true },
		});
		return conversation.id;
	});
});

afterAll(async () => {
	await tenantTransaction(ORG_A, (tx) =>
		tx.agentConversation.deleteMany({ where: { id: conversationId } }),
	);
	await db.user.delete({ where: { id: USER_ID } });
	await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
});

describe("builder input tenant scope", () => {
	it("persists input for its tenant and rejects another tenant", async () => {
		const accepted = event("accepted", "Which channel?");
		const rejected = event("rejected", "Which stage?");

		expect(
			await persistBuilderInputRequest(
				accepted,
				undefined,
				ORG_A,
				conversationId,
			),
		).toBe(true);
		expect(
			await persistBuilderInputRequest(
				rejected,
				undefined,
				ORG_B,
				conversationId,
			),
		).toBe(false);

		const persisted = await tenantTransaction(ORG_A, async (tx) => ({
			conversation: await tx.agentConversation.findUnique({
				where: { id: conversationId },
				select: { continuationToken: true, pendingInputRequest: true },
			}),
			accepted: await tx.agentEvent.findUnique({
				where: { id: `builder-input:${conversationId}:accepted` },
				select: { organizationId: true, data: true },
			}),
			rejectedCount: await tx.agentEvent.count({
				where: { id: `builder-input:${conversationId}:rejected` },
			}),
		}));

		expect(persisted.conversation).toEqual({
			continuationToken: builderToken(conversationId),
			pendingInputRequest: accepted.requests[0],
		});
		expect(persisted.accepted).toEqual({
			organizationId: ORG_A,
			data: accepted,
		});
		expect(persisted.rejectedCount).toBe(0);
	});
});
