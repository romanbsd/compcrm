import type { SendFn, SendPayload, Session } from "eve/channels";

import { ExportAgentRunError, ExportCancelledError } from "./errors";
import { toJsonSchema, validateSchema } from "./schema";
import type {
	ExportAgentRequest,
	ExportAgentResult,
	StandardSchemaV1,
} from "./types";
import { type ExportInvocation, exportJsonValueSchema } from "./wire";

type ExportSession = Pick<Session, "id" | "cancel" | "getEventStream">;

export function createEveExportSend(
	send: SendFn,
	invocation: ExportInvocation,
	abortSignal: AbortSignal,
): <T>(request: ExportAgentRequest<T>) => Promise<ExportAgentResult<T>> {
	return async <T>(request: ExportAgentRequest<T>) => {
		if (abortSignal.aborted) throw new ExportCancelledError();
		const payload: SendPayload = {
			message: request.message,
			context:
				request.clientContext === undefined
					? undefined
					: [JSON.stringify(request.clientContext)],
			outputSchema: request.outputSchema
				? toJsonSchema(request.outputSchema)
				: undefined,
		};
		const options = {
			auth: {
				authenticator: "xmpp-agent-gateway",
				principalType: "agent",
				principalId: invocation.caller ?? "xmpp-agent-gateway",
				attributes: {
					requestId: invocation.requestId,
					operation: invocation.operation,
				},
			},
			continuationToken: invocation.requestId,
			mode: request.taskMode === false ? "conversation" : "task",
			title: request.title,
		} as const;
		const session = await send(payload, options);
		let cancellation: ReturnType<ExportSession["cancel"]> | undefined;
		const cancel = () =>
			(cancellation ??= session.cancel().catch(() => ({
				status: "no_active_turn" as const,
			})));
		abortSignal.addEventListener("abort", cancel, { once: true });
		try {
			if (abortSignal.aborted) {
				await cancel();
				throw new ExportCancelledError();
			}
			return await collectAgentResult(session, request.outputSchema);
		} finally {
			abortSignal.removeEventListener("abort", cancel);
		}
	};
}

export async function collectAgentResult<T>(
	session: ExportSession,
	schema?: StandardSchemaV1<unknown, T>,
): Promise<ExportAgentResult<T>> {
	const stream = await session.getEventStream();
	const reader = stream.getReader();
	try {
		for (;;) {
			const item = await reader.read();
			if (item.done) break;
			const event = item.value;
			if (event.type === "result.completed") {
				const raw = exportJsonValueSchema.parse(event.data?.result);
				const value = schema
					? await validateSchema(
							schema,
							raw,
							"Invalid agent result",
							"OUTPUT_VALIDATION_FAILED",
						)
					: (raw as T);
				return { sessionId: session.id, value };
			}
			if (event.type === "turn.cancelled") {
				throw new ExportCancelledError();
			}
			if (event.type === "turn.failed" || event.type === "session.failed") {
				throw new ExportAgentRunError(
					String(event.data?.message ?? "Eve agent run failed"),
					event.data,
				);
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
	throw new ExportAgentRunError("Eve session ended without a result");
}
