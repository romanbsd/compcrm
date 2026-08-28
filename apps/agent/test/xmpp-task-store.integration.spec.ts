import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { XMPP_EXPORT } from "../src/xmpp/config";
import { PostgresXmppTaskStore } from "../src/xmpp/task-store";

const suffix = crypto.randomUUID();
const organizationId = `xmpp-store-${suffix}`;
const otherOrganizationId = `xmpp-store-other-${suffix}`;
const store = new PostgresXmppTaskStore(organizationId);

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: organizationId,
				name: "XMPP Store Test",
				slug: organizationId,
				createdAt: new Date(),
			},
			{
				id: otherOrganizationId,
				name: "XMPP Store Other Test",
				slug: otherOrganizationId,
				createdAt: new Date(),
			},
		],
	});
});

afterAll(async () => {
	await db.organization.deleteMany({
		where: { id: { in: [organizationId, otherOrganizationId] } },
	});
	await db.$disconnect();
});

describe("PostgreSQL XMPP task state", () => {
	it("replays identical requests and rejects changed requests", async () => {
		const first = await store.admit(admission("replay", "fingerprint-a"));
		const replay = await store.admit(admission("replay", "fingerprint-a"));

		expect(first.replay).toBe(false);
		expect(replay.replay).toBe(true);
		expect(replay.task.taskId).toBe(first.task.taskId);

		await expect(
			store.admit(admission("replay", "fingerprint-b")),
		).rejects.toThrow("replay conflict");
	});

	it("enforces organization ownership and optimistic revisions", async () => {
		const admitted = await store.admit(admission("transition", "transition"));
		const running = await store.transition(admitted.task.taskId, 0, {
			state: "RUNNING",
			progress: { stage: "started" },
		});

		expect(running.state).toBe("running");
		expect(running.revision).toBe(1);
		expect(
			await new PostgresXmppTaskStore(otherOrganizationId).get(
				admitted.task.taskId,
			),
		).toBeNull();
		await expect(
			store.transition(admitted.task.taskId, 0, { state: "COMPLETED" }),
		).rejects.toThrow("revision conflict");
	});

	it("fails interrupted work and deletes expired terminal rows", async () => {
		const interrupted = await store.admit(
			admission("interrupted", "interrupted"),
		);
		const expired = await store.admit(
			admission("expired", "expired", new Date(Date.now() - 1_000)),
		);
		await store.transition(expired.task.taskId, 0, { state: "COMPLETED" });

		const recoveringStore = new PostgresXmppTaskStore(
			organizationId,
			"recovering-owner",
		);
		expect(await recoveringStore.failInterrupted()).toBe(0);
		expect((await store.get(interrupted.task.taskId))?.state).toBe("accepted");
		expect(
			await recoveringStore.failInterrupted(
				new Date(Date.now() + XMPP_EXPORT.task.leaseMs),
			),
		).toBeGreaterThanOrEqual(1);
		expect((await store.get(interrupted.task.taskId))?.state).toBe("failed");
		expect(await store.deleteExpired()).toBe(1);
		expect(await store.get(expired.task.taskId)).toBeNull();
	});
});

function admission(requestId: string, fingerprint: string, retainUntil?: Date) {
	return {
		id: crypto.randomUUID(),
		requestId,
		callerJid: "caller@example.test",
		notificationJid: "caller@example.test/device",
		targetJid: "assistant@agents.example.test",
		tool: "ping",
		apiVersion: "1.0.0",
		manifestHash: "manifest",
		fingerprint,
		arguments: { message: requestId },
		retainUntil: retainUntil ?? new Date(Date.now() + 60_000),
	};
}
