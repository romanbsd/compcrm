import { z } from "zod";

import { defineExportTool } from "../export-tools/define-export-tool";

export default defineExportTool({
	description: "Confirm that the CRM agent export endpoint is available.",
	inputSchema: z.object({}),
	outputSchema: z.object({
		status: z.literal("ok"),
		requestId: z.string(),
	}),
	annotations: {
		title: "Ping CRM agent",
		idempotent: true,
		readOnly: true,
		destructive: false,
		longRunning: false,
	},
	execute(_input, ctx) {
		return { status: "ok" as const, requestId: ctx.invocation.requestId };
	},
});
