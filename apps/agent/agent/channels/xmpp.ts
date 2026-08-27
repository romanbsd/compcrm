import { defineChannel, GET, POST } from "eve/channels";
import {
	ExportToolValidationError,
	normalizeExportToolError,
} from "../../src/export-tools/errors";
import { createEveExportSend } from "../../src/export-tools/eve-adapter";
import { executeExportTool } from "../../src/export-tools/executor";
import { exportToolManifest } from "../../src/export-tools/manifest";
import { schemaIssues } from "../../src/export-tools/schema";
import {
	type ExportStreamEvent,
	exportInvocationRequestSchema,
	exportStreamEventSchema,
} from "../../src/export-tools/wire";

function authorized(request: Request): boolean {
	const secret = process.env.AGENT_BRIDGE_SECRET;
	return (
		Boolean(secret) &&
		request.headers.get("authorization") === `Bearer ${secret}`
	);
}

function denied(): Response {
	return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export default defineChannel({
	routes: [
		GET("/internal/xmpp/export-tools/manifest", async (request) => {
			if (!authorized(request)) return denied();
			return Response.json({ tools: exportToolManifest() });
		}),
		POST("/internal/xmpp/export-tools/invoke", async (request, { send }) => {
			if (!authorized(request)) return denied();
			const parsed = exportInvocationRequestSchema.safeParse(
				await request.json(),
			);
			if (!parsed.success) {
				return Response.json(
					{ error: "Invalid invocation", issues: parsed.error.issues },
					{ status: 400 },
				);
			}
			const invocation = {
				requestId: parsed.data.requestId,
				operation: parsed.data.operation,
				caller: parsed.data.caller,
			};
			const encoder = new TextEncoder();
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					let sessionId: string | undefined;
					const write = (value: ExportStreamEvent) => {
						controller.enqueue(
							encoder.encode(
								`${JSON.stringify(exportStreamEventSchema.parse(value))}\n`,
							),
						);
					};
					const eveSend = createEveExportSend(send, invocation, request.signal);
					void executeExportTool(parsed.data.operation, parsed.data.arguments, {
						abortSignal: request.signal,
						invocation,
						progress: async (update) => write({ type: "progress", update }),
						send: async (agentRequest) => {
							const result = await eveSend(agentRequest);
							sessionId = result.sessionId;
							return result;
						},
					})
						.then((value) => write({ type: "result", value, sessionId }))
						.catch((cause) => {
							const error = normalizeExportToolError(
								cause instanceof Error
									? cause
									: new Error("Export tool threw a non-error value", {
											cause,
										}),
							);
							write({
								type: "error",
								error: {
									code: error.code,
									message: error.message,
									issues:
										error instanceof ExportToolValidationError
											? [...schemaIssues(error.issues)]
											: undefined,
								},
							});
						})
						.finally(() => controller.close());
				},
			});
			return new Response(stream, {
				headers: { "content-type": "application/x-ndjson; charset=utf-8" },
			});
		}),
	],
});
