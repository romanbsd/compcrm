import {
	EmbeddedXmppGateway,
	type GatewayRuntimeMailbox,
	type TaskWireEvent,
} from "@agent-xmpp/gateway";
import {
	type AgentTaskError,
	type AgentTaskEventType,
	type AgentTaskRecord,
	type McpToolResult,
	terminalTaskStates,
} from "@agent-xmpp/protocol";
import { ulid } from "ulid";

import {
	type ExportJsonValue,
	type ExportStreamEvent,
	exportInvocationRequestSchema,
	exportStreamEventSchema,
	jsonObjectSchema,
} from "../export-tools/wire";
import { loadXmppHostConfig, XMPP_EXPORT } from "./config";
import { createXmppIqHandler } from "./iq-handler";
import { createXmppManifest } from "./manifest";
import { PostgresXmppTaskStore } from "./task-store";

export async function startXmppGatewayHost(): Promise<{
	close(): Promise<void>;
}> {
	const config = loadXmppHostConfig();
	const store = new PostgresXmppTaskStore(config.organizationId);
	const agent = createXmppManifest({
		jid: config.gateway.defaultAgentJid,
		organizationId: config.organizationId,
		version: config.agentVersion,
	});
	const controllers = new Map<string, AbortController>();
	let gateway: EmbeddedXmppGateway;
	const emit = async (
		task: AgentTaskRecord,
		type: AgentTaskEventType,
		payload: TaskWireEvent["payload"],
	) => {
		await gateway.deliverTaskEvent({
			taskId: task.taskId,
			eventId: ulid(),
			revision: task.revision,
			type,
			from: task.targetJid,
			to: task.notificationJid || task.callerJid,
			payload,
		});
	};
	const run = async (initial: AgentTaskRecord) => {
		const controller = new AbortController();
		controllers.set(initial.taskId, controller);
		let task = initial;
		try {
			task = await store.transition(task.taskId, task.revision, {
				state: "RUNNING",
			});
			await emit(task, "status", {
				state: "running",
				updatedAt: task.updatedAt,
			});
			const response = await fetch(
				new URL("/internal/xmpp/export-tools/invoke", config.agentUrl),
				{
					method: "POST",
					headers: {
						authorization: `Bearer ${config.bridgeSecret}`,
						"content-type": "application/json",
					},
					body: JSON.stringify(
						exportInvocationRequestSchema.parse({
							requestId: task.taskId,
							operation: task.tool,
							arguments: task.arguments,
							caller: task.callerJid,
						}),
					),
					signal: controller.signal,
				},
			);
			if (!response.ok || !response.body) {
				throw new Error(`Eve export endpoint returned ${response.status}`);
			}
			for await (const event of readNdjson(response.body)) {
				if (event.type === "progress") {
					task = await store.transition(task.taskId, task.revision, {
						progress: jsonObjectSchema.parse(event.update),
					});
					await emit(task, "progress", event.update);
					continue;
				}
				if (event.type === "error") {
					if (event.error.code === "CANCELLED") {
						throw new DOMException(event.error.message, "AbortError");
					}
					throw new ExportEndpointError(event.error.code, event.error.message);
				}
				const result = mcpResult(event.value);
				const transition = {
					state: "COMPLETED",
					result: jsonObjectSchema.parse(result),
					eveSessionId: event.sessionId,
				} as const;
				task = await store.transition(task.taskId, task.revision, transition);
				await emit(task, "completed", { result });
				return;
			}
			throw new Error("Eve export endpoint ended without a result");
		} catch (error) {
			const current = await store.get(initial.taskId);
			if (!current || terminalTaskStates.has(current.state)) return;
			if (
				(error instanceof DOMException && error.name === "AbortError") ||
				current.state === "cancelling"
			) {
				task = await store.transition(current.taskId, current.revision, {
					state: "CANCELLED",
				});
				await emit(task, "cancelled", { reason: "Task cancelled" });
				return;
			}
			const failure: AgentTaskError = {
				code:
					error instanceof ExportEndpointError ? error.code : "gateway-error",
				message:
					error instanceof Error ? error.message : "Task execution failed",
				retryable: !(error instanceof ExportEndpointError),
			};
			task = await store.transition(current.taskId, current.revision, {
				state: "FAILED",
				error: jsonObjectSchema.parse(failure),
			});
			await emit(task, "failed", { error: failure });
		} finally {
			controllers.delete(initial.taskId);
		}
	};
	const iqHandler = createXmppIqHandler({
		componentJid: config.gateway.componentJid,
		agent,
		store,
		allowedCallerDomains: config.allowedCallerDomains,
		destructiveCallers: config.destructiveCallers,
		onAccepted: (task) => void run(task),
		onCancel: async (task) => {
			controllers.get(task.taskId)?.abort();
		},
	});
	const mailbox: GatewayRuntimeMailbox = {
		async deliverInbound() {},
		async deliverFormResponse() {},
		async deliverTaskEvent(_event: TaskWireEvent) {},
	};
	gateway = new EmbeddedXmppGateway(config.gateway, mailbox, {
		onIqGet: iqHandler,
		resolveVirtualAgent: (jid) =>
			jid === agent.manifest.agent.jid
				? {
						jid,
						name: agent.manifest.agent.title ?? agent.manifest.agent.name,
					}
				: null,
	});
	await store.failInterrupted();
	await gateway.start();
	const sweep = setInterval(
		() => void store.deleteExpired(),
		XMPP_EXPORT.gateway.sweepMs,
	);
	sweep.unref?.();
	return {
		async close() {
			clearInterval(sweep);
			for (const controller of controllers.values()) controller.abort();
			await gateway.stop();
		},
	};
}

async function* readNdjson(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ExportStreamEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let pending = "";
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			pending += decoder.decode(chunk.value, { stream: true });
			for (;;) {
				const boundary = pending.indexOf("\n");
				if (boundary < 0) break;
				const line = pending.slice(0, boundary);
				pending = pending.slice(boundary + 1);
				if (line) yield exportStreamEventSchema.parse(JSON.parse(line));
			}
		}
		pending += decoder.decode();
		if (pending.trim()) {
			yield exportStreamEventSchema.parse(JSON.parse(pending));
		}
	} finally {
		reader.releaseLock();
	}
}

function mcpResult(value: ExportJsonValue): McpToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value) }],
		structuredContent: jsonObjectSchema.parse(value),
	};
}

class ExportEndpointError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}
