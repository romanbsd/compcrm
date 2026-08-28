import { z } from "zod";

import { defineExportTool } from "../export-tools/define-export-tool";

const resultSchema = z.object({
	summary: z.string().min(1),
	actionsTaken: z.array(
		z.object({
			type: z.string().min(1),
			description: z.string().min(1),
		}),
	),
});

export default defineExportTool({
	description:
		"Process a bounded CRM request with the agent's normal evidence and action tools.",
	inputSchema: z.object({
		request: z.string().trim().min(1).max(2_000),
		record: z
			.object({
				type: z.enum(["contact", "company", "deal"]),
				id: z.string().trim().min(1).max(120),
			})
			.optional(),
	}),
	outputSchema: resultSchema,
	annotations: {
		title: "Handle CRM request",
		idempotent: false,
		readOnly: false,
		destructive: true,
		longRunning: true,
	},
	async execute(input, ctx) {
		await ctx.progress({
			stage: "reasoning",
			percent: 10,
			message: "Processing CRM request",
		});
		const target = input.record
			? `${input.record.type} ${input.record.id}`
			: "the relevant CRM records";
		const result = await ctx.send({
			taskMode: true,
			title: "Remote CRM request",
			message: [
				`Process this external request about ${target}.`,
				input.request,
				"Use normal CRM evidence rules and available tools.",
				"Report only actions that completed successfully.",
				"Return a concise summary and the actions taken.",
			].join("\n\n"),
			outputSchema: resultSchema,
			clientContext: {
				requestId: ctx.invocation.requestId,
				caller: ctx.invocation.caller ?? null,
				operation: ctx.invocation.operation,
			},
		});
		await ctx.progress({
			stage: "complete",
			percent: 100,
			message: "CRM request complete",
		});
		return result.value;
	},
});
