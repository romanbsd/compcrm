import { digestJson, validateJsonBounded } from "@agent-xmpp/core";
import {
	buildAcceptedResult,
	buildAgentDirectory,
	buildAgentInfo,
	buildGatewayInfo,
	buildManifestResult,
	buildPingResponse,
	buildSchemaResult,
	buildTaskResultResponse,
	buildTaskStateResponse,
	buildToolCollectionInfo,
	buildToolInfo,
	buildToolItems,
	DISCO_INFO_NS,
	DISCO_ITEMS_NS,
	type Element,
	hiddenObjectError,
	isPingRequest,
	ProtocolError,
	parseManifestRequest,
	parseSchemaRequest,
	parseTaskCancellation,
	parseTaskInput,
	parseTaskInvocation,
	parseTaskRecoveryRequest,
	protocolErrorIq,
	toolFromNode,
	toolsNode,
	xml,
} from "@agent-xmpp/gateway";
import {
	AGENT_TASK_NS,
	type AgentTaskRecord,
	bareJid,
	type RegisteredAgent,
	terminalTaskStates,
} from "@agent-xmpp/protocol";
import { ulid } from "ulid";
import { z } from "zod";

import { XMPP_EXPORT } from "./config";
import {
	type PostgresXmppTaskStore,
	XmppTaskConflictError,
} from "./task-store";

export interface XmppIqHandlerOptions {
	readonly componentJid: string;
	readonly agent: RegisteredAgent;
	readonly store: PostgresXmppTaskStore;
	readonly allowedCallerDomains: ReadonlySet<string>;
	readonly destructiveCallers: ReadonlySet<string>;
	onAccepted(task: AgentTaskRecord): void;
	onCancel(task: AgentTaskRecord, reason?: string): Promise<void>;
}

export function createXmppIqHandler(options: XmppIqHandlerOptions) {
	return async (stanza: Element): Promise<Element | null> => {
		try {
			return await routeIq(stanza, options);
		} catch (error) {
			if (error instanceof ProtocolError) {
				return protocolErrorIq(stanza, error);
			}
			if (error instanceof XmppTaskConflictError) {
				return protocolErrorIq(
					stanza,
					new ProtocolError("conflict", error.message),
				);
			}
			return protocolErrorIq(
				stanza,
				new ProtocolError("internal-server-error", "Request processing failed"),
			);
		}
	};
}

async function routeIq(
	stanza: Element,
	options: XmppIqHandlerOptions,
): Promise<Element | null> {
	if (
		stanza.name !== "iq" ||
		!["get", "set"].includes(String(stanza.attrs.type))
	) {
		return null;
	}
	const from = String(stanza.attrs.from ?? "");
	const caller = bareJid(from);
	const callerDomain = caller.split("@")[1] ?? caller;
	if (!options.allowedCallerDomains.has(callerDomain)) {
		throw hiddenObjectError();
	}
	const to = bareJid(String(stanza.attrs.to ?? ""));
	if (
		isPingRequest(stanza) &&
		(to === options.componentJid || to === options.agent.manifest.agent.jid)
	) {
		return buildPingResponse(stanza);
	}
	if (to === options.componentJid) return routeGateway(stanza, options);
	if (to !== options.agent.manifest.agent.jid) throw hiddenObjectError();
	return routeAgent(stanza, options, caller);
}

function routeGateway(
	stanza: Element,
	options: XmppIqHandlerOptions,
): Element | null {
	const info = stanza.getChild("query", DISCO_INFO_NS);
	const items = stanza.getChild("query", DISCO_ITEMS_NS);
	if (info && !info.attrs.node)
		return buildGatewayInfo(stanza, options.componentJid);
	if (items && !items.attrs.node) {
		return buildAgentDirectory(stanza, options.componentJid, [options.agent]);
	}
	return null;
}

async function routeAgent(
	stanza: Element,
	options: XmppIqHandlerOptions,
	caller: string,
): Promise<Element | null> {
	const invocation = parseTaskInvocation(stanza);
	if (invocation) return acceptInvocation(stanza, invocation, options, caller);
	const cancellation = parseTaskCancellation(stanza);
	if (cancellation) return cancelTask(stanza, cancellation, options, caller);
	if (parseTaskInput(stanza)) {
		throw new ProtocolError(
			"unexpected-request",
			"Task input is not supported",
		);
	}
	const recovery = parseTaskRecoveryRequest(stanza);
	if (recovery) {
		const task = await options.store.getForCaller(
			recovery.taskId,
			caller,
			options.agent.manifest.agent.jid,
		);
		if (!task) throw hiddenObjectError();
		if (recovery.kind === "result" && !terminalTaskStates.has(task.state)) {
			throw new ProtocolError("unexpected-request", "Task is not terminal");
		}
		return recovery.kind === "state"
			? buildTaskStateResponse(stanza, task)
			: buildTaskResultResponse(stanza, task);
	}
	const info = stanza.getChild("query", DISCO_INFO_NS);
	const items = stanza.getChild("query", DISCO_ITEMS_NS);
	const manifestRequest = parseManifestRequest(stanza);
	const schemaRequest = parseSchemaRequest(stanza);
	const version = options.agent.manifest.agent.version;
	if (info && !info.attrs.node) return buildAgentInfo(stanza, options.agent);
	if (info?.attrs.node === toolsNode(version)) {
		return buildToolCollectionInfo(stanza, options.agent);
	}
	if (items?.attrs.node === toolsNode(version)) {
		return buildToolItems(stanza, options.agent);
	}
	if (info?.attrs.node) {
		const selected = toolFromNode(String(info.attrs.node));
		if (!selected || selected.version !== version) throw hiddenObjectError();
		const tool = options.agent.tools.find(
			(candidate) => candidate.name === selected.name,
		);
		if (!tool) throw hiddenObjectError();
		return buildToolInfo(stanza, options.agent, tool);
	}
	if (manifestRequest) {
		if (manifestRequest.version && manifestRequest.version !== version)
			throw hiddenObjectError();
		return buildManifestResult(stanza, options.agent);
	}
	if (schemaRequest) {
		if (
			schemaRequest.version !== version ||
			schemaRequest.manifestHash !== options.agent.manifestHash
		) {
			throw new ProtocolError("conflict", "Manifest selection conflict");
		}
		const tool = options.agent.tools.find(
			(candidate) => candidate.name === schemaRequest.tool,
		);
		if (!tool) throw hiddenObjectError();
		return buildSchemaResult(
			stanza,
			options.agent,
			tool,
			schemaRequest.direction,
		);
	}
	return null;
}

async function acceptInvocation(
	stanza: Element,
	invocation: NonNullable<ReturnType<typeof parseTaskInvocation>>,
	options: XmppIqHandlerOptions,
	caller: string,
): Promise<Element> {
	if (
		invocation.apiVersion !== options.agent.manifest.agent.version ||
		invocation.manifestHash !== options.agent.manifestHash
	) {
		throw new ProtocolError("conflict", "Manifest selection conflict");
	}
	const tool = options.agent.tools.find(
		(candidate) => candidate.name === invocation.tool,
	);
	if (!tool) throw hiddenObjectError();
	if (tool.xmpp?.approvalRequired && !options.destructiveCallers.has(caller)) {
		throw new ProtocolError("forbidden", "Tool approval is unavailable");
	}
	const errors = await validateJsonBounded(
		tool.inputSchema,
		invocation.arguments,
	);
	if (errors.length) {
		throw new ProtocolError(
			"bad-request",
			`Argument validation failed: ${errors.join("; ")}`,
		);
	}
	const now = new Date();
	const deadline = invocation.deadline
		? new Date(invocation.deadline)
		: undefined;
	if (deadline && deadline.getTime() <= now.getTime()) {
		throw new ProtocolError("not-acceptable", "Task deadline is expired");
	}
	const maximumTimeoutSeconds = tool.xmpp?.maximumTimeoutSeconds;
	if (
		deadline &&
		maximumTimeoutSeconds &&
		deadline.getTime() > now.getTime() + maximumTimeoutSeconds * 1_000
	) {
		throw new ProtocolError(
			"not-acceptable",
			"Task deadline exceeds the tool maximum",
		);
	}
	const retainUntil = new Date(
		Math.max(
			now.getTime() + XMPP_EXPORT.task.retentionMs,
			deadline?.getTime() ?? 0,
		),
	);
	const fingerprint = digestJson({
		caller,
		target: invocation.toJid,
		requestId: invocation.requestId,
		tool: invocation.tool,
		apiVersion: invocation.apiVersion,
		manifestHash: invocation.manifestHash,
		arguments: invocation.arguments,
		deadline: invocation.deadline ?? null,
	});
	const admission = {
		id: ulid(),
		requestId: invocation.requestId,
		callerJid: caller,
		notificationJid: invocation.notificationJid,
		targetJid: invocation.toJid,
		tool: invocation.tool,
		apiVersion: invocation.apiVersion,
		manifestHash: invocation.manifestHash,
		fingerprint,
		arguments: z.record(z.string(), z.json()).parse(invocation.arguments),
		retainUntil,
	};
	if (deadline) Object.assign(admission, { deadline });
	const admitted = await options.store.admit(admission);
	if (!admitted.replay) options.onAccepted(admitted.task);
	return buildAcceptedResult(
		stanza,
		{
			requestId: admitted.task.requestId,
			taskId: admitted.task.taskId,
			revision: admitted.task.revision,
			created: admitted.task.createdAt,
			retainUntil: admitted.task.retainUntil,
		},
		options.agent.manifest.agent.jid,
	);
}

async function cancelTask(
	stanza: Element,
	cancellation: NonNullable<ReturnType<typeof parseTaskCancellation>>,
	options: XmppIqHandlerOptions,
	caller: string,
): Promise<Element> {
	const task = await options.store.getForCaller(
		cancellation.taskId,
		caller,
		options.agent.manifest.agent.jid,
	);
	if (!task) throw hiddenObjectError();
	if (terminalTaskStates.has(task.state)) {
		throw new ProtocolError("unexpected-request", "Task is terminal");
	}
	if (task.revision !== cancellation.expectedRevision) {
		throw new ProtocolError("conflict", "Task revision conflict");
	}
	const cancelling = await options.store.transition(
		task.taskId,
		task.revision,
		{
			state: "CANCELLING",
		},
	);
	await options.onCancel(cancelling, cancellation.reason);
	return xml(
		"iq",
		{
			type: "result",
			id: stanza.attrs.id,
			from: options.agent.manifest.agent.jid,
			to: stanza.attrs.from,
		},
		xml("cancel-accepted", {
			xmlns: AGENT_TASK_NS,
			"task-id": cancelling.taskId,
			revision: String(cancelling.revision),
		}),
	);
}
