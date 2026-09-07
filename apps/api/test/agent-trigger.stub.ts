import type { Prisma } from "@crm/db";
import { scopedTransaction } from "@crm/db/tenant-scope";
import type { CrmEventInput } from "../src/agent/agent-trigger.service";

export function withDiscardedCrmEvents<Result>(
	work: (
		tx: Prisma.TransactionClient,
		emit: (input: CrmEventInput) => Promise<void>,
	) => Promise<Result>,
): Promise<Result> {
	return scopedTransaction((tx) => work(tx, async () => undefined));
}
