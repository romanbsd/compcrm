import { PRIORITY } from "./agent-tasks";
import { lockIdempotencyKey } from "./idempotency";
import { runInTenant } from "./tenant-context";
import { scopedTransaction } from "./tenant-scope";
import { organizationIds } from "./tenants";

const MINUTE_MS = 60_000;

export const SLACK_INVENTORY = {
	kind: "slack-people-match",
	lock: "slack-inventory",
	priority: PRIORITY.slackPeople,
	budget: 1,
	throttleMs: 15 * MINUTE_MS,
} as const;

export async function queueSlackInventorySync(
	reason: string,
	organizationId?: string,
): Promise<void> {
	const since = new Date(Date.now() - SLACK_INVENTORY.throttleMs);
	const organizations = organizationId
		? [organizationId]
		: await organizationIds();

	for (const organizationId of organizations) {
		try {
			await runInTenant(organizationId, () =>
				scopedTransaction(async (tx) => {
					await lockIdempotencyKey(
						tx,
						`${SLACK_INVENTORY.lock}:${organizationId}`,
					);

					const recent = await tx.agentTask.findFirst({
						where: {
							kind: SLACK_INVENTORY.kind,
							OR: [{ finishedAt: null }, { createdAt: { gt: since } }],
						},
						select: { id: true },
					});
					if (recent) return;

					await tx.agentTask.create({
						data: {
							kind: SLACK_INVENTORY.kind,
							reason,
							priority: SLACK_INVENTORY.priority,
							budget: SLACK_INVENTORY.budget,
							dueAt: new Date(),
						},
					});
				}),
			);
		} catch {}
	}
}
