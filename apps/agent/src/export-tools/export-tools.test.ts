import { describe, expect, it } from "bun:test";
import type { SendFn } from "eve/channels";

import handleCrmRequest from "../exports/handle_crm_request";
import { ExportCancelledError, ExportToolValidationError } from "./errors";
import { collectAgentResult, createEveExportSend } from "./eve-adapter";
import { executeExportTool } from "./executor";
import { exportToolManifest } from "./manifest";
import type { ExportToolContext } from "./types";
import { exportInvocationRequestSchema, exportStreamEventSchema } from "./wire";

function context(
	overrides: Partial<ExportToolContext> = {},
): ExportToolContext {
	return {
		abortSignal: new AbortController().signal,
		invocation: { requestId: "req_1", operation: "ping" },
		progress: async () => {},
		send: async () => {
			throw new Error("Unexpected agent call");
		},
		...overrides,
	};
}

describe("export tools", () => {
	it("runs a deterministic export without an agent call", async () => {
		await expect(executeExportTool("ping", {}, context())).resolves.toEqual({
			status: "ok",
			requestId: "req_1",
		});
	});

	it("rejects invalid input before progress or agent work", async () => {
		const calls: string[] = [];
		const run = executeExportTool(
			"handle_crm_request",
			{ request: "" },
			context({
				progress: async () => {
					calls.push("progress");
				},
				send: async <T>() => {
					calls.push("send");
					return { sessionId: "ses_1", value: {} as T };
				},
			}),
		);
		await expect(run).rejects.toBeInstanceOf(ExportToolValidationError);
		expect(calls).toEqual([]);
	});

	it("runs agent work between progress events", async () => {
		const calls: string[] = [];
		const result = await handleCrmRequest.execute(
			{ request: "Review the current relationship" },
			context({
				progress: async (update) => {
					calls.push(update.stage ?? "");
				},
				send: async <T>() => {
					calls.push("send");
					return {
						sessionId: "ses_1",
						value: { summary: "Reviewed", actionsTaken: [] } as T,
					};
				},
			}),
		);
		expect(calls).toEqual(["reasoning", "send", "complete"]);
		expect(result).toEqual({ summary: "Reviewed", actionsTaken: [] });
	});

	it("publishes only the explicit export registry", () => {
		expect(exportToolManifest().map((tool) => tool.name)).toEqual([
			"handle_crm_request",
			"ping",
		]);
	});

	it("uses one strict wire contract for invocation and stream events", () => {
		expect(
			exportInvocationRequestSchema.safeParse({
				requestId: "req_1",
				operation: "ping",
				arguments: {},
				metadata: {},
			}).success,
		).toBe(false);
		expect(
			exportStreamEventSchema.safeParse({
				type: "result",
				value: {},
				metadata: {},
			}).success,
		).toBe(false);
	});

	it("collects a native structured Eve result", async () => {
		let streamCancelled = false;
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue({
					type: "result.completed",
					data: { result: { summary: "Done", actionsTaken: [] } },
				});
			},
			cancel() {
				streamCancelled = true;
			},
		});
		await expect(
			collectAgentResult(
				{
					id: "ses_1",
					cancel: async () => ({ status: "accepted" }),
					getEventStream: async () => stream,
				},
				handleCrmRequest.outputSchema,
			),
		).resolves.toEqual({
			sessionId: "ses_1",
			value: { summary: "Done", actionsTaken: [] },
		});
		expect(streamCancelled).toBe(true);
	});

	it("cancels when the request aborts while Eve accepts the send", async () => {
		const controller = new AbortController();
		let cancellations = 0;
		const send: SendFn = async () => {
			controller.abort();
			return {
				id: "ses_1",
				continuationToken: "xmpp:req_1",
				cancel: async () => {
					cancellations++;
					return { status: "accepted" };
				},
				getEventStream: async () => new ReadableStream(),
				getStreamTailIndex: async () => -1,
			};
		};
		const run = createEveExportSend(
			send,
			{ requestId: "req_1", operation: "ping" },
			controller.signal,
		);

		await expect(run({ message: "Run" })).rejects.toBeInstanceOf(
			ExportCancelledError,
		);
		expect(cancellations).toBe(1);
	});

	it("maps Eve cancellation to the export cancellation error", async () => {
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue({ type: "turn.cancelled" });
				controller.close();
			},
		});
		await expect(
			collectAgentResult({
				id: "ses_1",
				cancel: async () => ({ status: "accepted" }),
				getEventStream: async () => stream,
			}),
		).rejects.toBeInstanceOf(ExportCancelledError);
	});
});
