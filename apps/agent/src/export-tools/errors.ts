import type { StandardSchemaIssue } from "./types";

export type ExportToolErrorCode =
	| "EXPORT_TOOL_NOT_FOUND"
	| "INVALID_ARGUMENTS"
	| "EXECUTION_FAILED"
	| "AGENT_RUN_FAILED"
	| "CANCELLED"
	| "OUTPUT_VALIDATION_FAILED";

export class ExportToolError extends Error {
	constructor(
		message: string,
		readonly code: ExportToolErrorCode,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = new.target.name;
	}
}

export class ExportToolNotFoundError extends ExportToolError {
	constructor(readonly operation: string) {
		super(`Export tool not found: ${operation}`, "EXPORT_TOOL_NOT_FOUND");
	}
}

export class ExportToolValidationError extends ExportToolError {
	constructor(
		message: string,
		readonly issues: readonly StandardSchemaIssue[],
		code: Extract<
			ExportToolErrorCode,
			"INVALID_ARGUMENTS" | "OUTPUT_VALIDATION_FAILED"
		>,
	) {
		super(message, code);
	}
}

export class ExportToolExecutionError extends ExportToolError {
	constructor(cause: unknown) {
		super("Export tool execution failed", "EXECUTION_FAILED", {
			cause,
		});
	}
}

export class ExportAgentRunError extends ExportToolError {
	constructor(message: string, cause?: unknown) {
		super(message, "AGENT_RUN_FAILED", { cause });
	}
}

export class ExportCancelledError extends ExportToolError {
	constructor() {
		super("Export invocation was cancelled", "CANCELLED");
	}
}

export function normalizeExportToolError(error: Error): ExportToolError {
	if (error instanceof ExportToolError) return error;
	if (
		error instanceof DOMException &&
		(error.name === "AbortError" || error.name === "TimeoutError")
	) {
		return new ExportCancelledError();
	}
	return new ExportToolExecutionError(error);
}
