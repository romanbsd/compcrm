import { ExportCancelledError, normalizeExportToolError } from "./errors";
import { exportTool } from "./registry";
import { validateSchema } from "./schema";
import type { ExportToolContext } from "./types";
import { type ExportJsonValue, exportJsonValueSchema } from "./wire";

export async function executeExportTool(
	name: string,
	rawInput: ExportJsonValue,
	ctx: ExportToolContext,
): Promise<ExportJsonValue> {
	const definition = exportTool(name);
	if (ctx.abortSignal.aborted) throw new ExportCancelledError();
	const input = await validateSchema(
		definition.inputSchema,
		rawInput,
		"Invalid export tool input",
		"INVALID_ARGUMENTS",
	);
	try {
		const output = await definition.execute(input, ctx);
		const jsonOutput = exportJsonValueSchema.parse(output);
		if (!definition.outputSchema) return jsonOutput;
		const validated = await validateSchema(
			definition.outputSchema,
			jsonOutput,
			"Invalid export tool output",
			"OUTPUT_VALIDATION_FAILED",
		);
		return exportJsonValueSchema.parse(validated);
	} catch (error) {
		throw normalizeExportToolError(
			error instanceof Error
				? error
				: new Error("Export tool threw a non-error value", { cause: error }),
		);
	}
}
