import handleCrmRequest from "../exports/handle_crm_request";
import ping from "../exports/ping";
import { ExportToolNotFoundError } from "./errors";
import type { AnyExportToolDefinition } from "./types";

export const exportTools = {
	handle_crm_request: handleCrmRequest,
	ping,
} as const;

export function exportTool(name: string): AnyExportToolDefinition {
	switch (name) {
		case "handle_crm_request":
			return handleCrmRequest as AnyExportToolDefinition;
		case "ping":
			return ping as AnyExportToolDefinition;
		default:
			throw new ExportToolNotFoundError(name);
	}
}
