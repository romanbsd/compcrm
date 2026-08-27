import type { ExportToolDefinition } from "./types";

export type DefinedExportTool<I, O> = ExportToolDefinition<I, O>;

export function defineExportTool<I, O>(
	definition: ExportToolDefinition<I, O>,
): DefinedExportTool<I, O> {
	return Object.freeze(definition);
}
