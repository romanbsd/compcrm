import type {
	AgentTaskError,
	AgentTaskRecord,
	McpToolResult,
} from "@agent-xmpp/protocol";
import { db, Prisma, type XmppAgentTaskState } from "@crm/db";
import { z } from "zod";

const storedTaskResult = z.object({
	content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
	structuredContent: z.record(z.string(), z.unknown()).optional(),
});

const storedTaskError = z.object({
	code: z.string(),
	message: z.string(),
	retryable: z.boolean(),
});

export interface AdmitXmppTask {
	readonly id: string;
	readonly requestId: string;
	readonly callerJid: string;
	readonly notificationJid: string;
	readonly targetJid: string;
	readonly tool: string;
	readonly apiVersion: string;
	readonly manifestHash: string;
	readonly fingerprint: string;
	readonly arguments: Prisma.InputJsonValue;
	readonly deadline?: Date;
	readonly retainUntil: Date;
}

export interface XmppTaskTransition {
	readonly state?: XmppAgentTaskState;
	readonly progress?: Prisma.InputJsonValue;
	readonly result?: Prisma.InputJsonValue;
	readonly error?: Prisma.InputJsonValue;
	readonly summary?: string;
	readonly eveSessionId?: string;
}

export class XmppTaskConflictError extends Error {
	constructor(readonly kind: "replay" | "revision") {
		super(`XMPP task ${kind} conflict`);
	}
}

export class PostgresXmppTaskStore {
	constructor(readonly organizationId: string) {}

	async admit(
		input: AdmitXmppTask,
	): Promise<{ task: AgentTaskRecord; replay: boolean }> {
		const replayKey = {
			organizationId: this.organizationId,
			callerJid: input.callerJid,
			targetJid: input.targetJid,
			requestId: input.requestId,
		};
		const where = {
			organizationId_callerJid_targetJid_requestId: replayKey,
		};
		const existing = await db.xmppAgentTask.findUnique({
			where: {
				...where,
			},
		});
		if (existing) return this.replay(existing, input.fingerprint);
		try {
			const created = await db.xmppAgentTask.create({
				data: { ...input, organizationId: this.organizationId },
			});
			return { task: taskRecord(created), replay: false };
		} catch (error) {
			if (
				!(error instanceof Prisma.PrismaClientKnownRequestError) ||
				error.code !== "P2002"
			) {
				throw error;
			}
			const concurrent = await db.xmppAgentTask.findUniqueOrThrow({
				where,
			});
			return this.replay(concurrent, input.fingerprint);
		}
	}

	async get(id: string): Promise<AgentTaskRecord | null> {
		const task = await db.xmppAgentTask.findFirst({
			where: { id, organizationId: this.organizationId },
		});
		return task ? taskRecord(task) : null;
	}

	async getForCaller(
		id: string,
		callerJid: string,
		targetJid: string,
	): Promise<AgentTaskRecord | null> {
		const task = await db.xmppAgentTask.findFirst({
			where: {
				id,
				organizationId: this.organizationId,
				callerJid,
				targetJid,
			},
		});
		return task ? taskRecord(task) : null;
	}

	async transition(
		id: string,
		expectedRevision: number,
		transition: XmppTaskTransition,
	): Promise<AgentTaskRecord> {
		const updated = await db.xmppAgentTask.updateMany({
			where: {
				id,
				organizationId: this.organizationId,
				revision: expectedRevision,
			},
			data: {
				...transition,
				revision: { increment: 1 },
			},
		});
		if (updated.count !== 1) throw new XmppTaskConflictError("revision");
		return taskRecord(
			await db.xmppAgentTask.findFirstOrThrow({
				where: { id, organizationId: this.organizationId },
			}),
		);
	}

	async failInterrupted(): Promise<number> {
		const result = await db.xmppAgentTask.updateMany({
			where: {
				organizationId: this.organizationId,
				state: { in: ["ACCEPTED", "RUNNING", "CANCELLING"] },
			},
			data: {
				state: "FAILED",
				revision: { increment: 1 },
				error: {
					code: "gateway-restarted",
					message: "The XMPP gateway restarted before the task completed",
					retryable: true,
				},
			},
		});
		return result.count;
	}

	async deleteExpired(now = new Date()): Promise<number> {
		const result = await db.xmppAgentTask.deleteMany({
			where: {
				organizationId: this.organizationId,
				retainUntil: { lt: now },
				state: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
			},
		});
		return result.count;
	}

	private replay(task: Prisma.XmppAgentTaskModel, fingerprint: string) {
		if (task.fingerprint !== fingerprint) {
			throw new XmppTaskConflictError("replay");
		}
		return { task: taskRecord(task), replay: true };
	}
}

const taskStates = {
	ACCEPTED: "accepted",
	RUNNING: "running",
	CANCELLING: "cancelling",
	COMPLETED: "completed",
	FAILED: "failed",
	CANCELLED: "cancelled",
} satisfies Record<XmppAgentTaskState, AgentTaskRecord["state"]>;

function taskRecord(task: Prisma.XmppAgentTaskModel): AgentTaskRecord {
	const record: AgentTaskRecord = {
		taskId: task.id,
		requestId: task.requestId,
		callerJid: task.callerJid,
		notificationJid: task.notificationJid,
		targetJid: task.targetJid,
		tenantId: task.organizationId,
		tool: task.tool,
		apiVersion: task.apiVersion,
		manifestHash: task.manifestHash,
		arguments: task.arguments,
		state: taskStates[task.state],
		revision: task.revision,
		fingerprint: task.fingerprint,
		createdAt: task.createdAt.toISOString(),
		updatedAt: task.updatedAt.toISOString(),
		retainUntil: task.retainUntil.toISOString(),
	};
	if (task.deadline) record.deadline = task.deadline.toISOString();
	if (task.result) {
		record.result = storedTaskResult.parse(task.result) satisfies McpToolResult;
	}
	if (task.error) {
		record.error = storedTaskError.parse(task.error) satisfies AgentTaskError;
	}
	if (task.summary) record.summary = task.summary;
	return record;
}
