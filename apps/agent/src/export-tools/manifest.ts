import { exportTools } from "./registry";
import { toJsonSchema } from "./schema";
import type { ExportToolManifestEntry } from "./types";

export function exportToolManifest(): readonly ExportToolManifestEntry[] {
	return Object.entries(exportTools).map(([name, definition]) => {
		const entry: ExportToolManifestEntry = {
			name,
			description: definition.description,
			inputSchema: toJsonSchema(definition.inputSchema),
		};
		if (definition.outputSchema) {
			entry.outputSchema = toJsonSchema(definition.outputSchema);
		}
		if (definition.annotations) entry.annotations = definition.annotations;
		return entry;
	});
}
