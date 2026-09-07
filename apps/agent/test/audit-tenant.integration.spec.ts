import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import audit from "../agent/hooks/audit";
import { tenantTransaction } from "@crm/db/tenant-scope";

const suffix = crypto.randomUUID();
const ORG_A = `audit-tenant-org-a-${suffix}`;
const EVENT_ID = `audit-tenant-event-${suffix}`;
const SESSION_ID = `audit-tenant-session-${suffix}`;

type AuditHandler = (
	event: {
		type: string;
		data: object;
		meta: { id: string; at: string };
	},
	ctx: {
		session: {
			id: string;
			auth: {
				current: { attributes: Record<string, string> };
				initiator: null;
			};
		};
	},
) => Promise<void>;

const handler = audit.events["*"] as unknown as AuditHandler;

beforeAll(async () => {
	await db.organization.createMany({
		data: {
			id: ORG_A,
			name: "Audit Tenant A",
			slug: ORG_A,
			createdAt: new Date(),
		},
	});
});

afterAll(async () => {
	await tenantTransaction(ORG_A, (tx) =>
		tx.agentEvent.deleteMany({ where: { id: EVENT_ID } }),
	);
	await db.organization.delete({ where: { id: ORG_A } });
});

describe("audit tenant scope", () => {
	it("persists an event through its session tenant", async () => {
		const emittedAt = new Date().toISOString();
		const data = { message: "Tenant A audit event" };

		await handler(
			{
				type: "message.completed",
				data,
				meta: { id: EVENT_ID, at: emittedAt },
			},
			{
				session: {
					id: SESSION_ID,
					auth: {
						current: { attributes: { organizationId: ORG_A } },
						initiator: null,
					},
				},
			},
		);

		const event = await tenantTransaction(ORG_A, (tx) =>
			tx.agentEvent.findUnique({ where: { id: EVENT_ID } }),
		);

		expect(event).toMatchObject({
			id: EVENT_ID,
			organizationId: ORG_A,
			sessionId: SESSION_ID,
			type: "message.completed",
			data,
		});
	});
});
