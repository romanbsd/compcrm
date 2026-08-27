import { z } from "zod";

import { ExportToolValidationError } from "./errors";
import type {
	JsonSchema,
	StandardSchemaIssue,
	StandardSchemaV1,
} from "./types";
import type { ExportJsonValue } from "./wire";

export async function validateSchema<T>(
	schema: StandardSchemaV1<unknown, T>,
	value: ExportJsonValue,
	message: string,
	code: "INVALID_ARGUMENTS" | "OUTPUT_VALIDATION_FAILED",
): Promise<T> {
	const result = await schema["~standard"].validate(value);
	if (result.issues) {
		throw new ExportToolValidationError(message, result.issues, code);
	}
	return result.value;
}

export function schemaIssues(
	issues: readonly StandardSchemaIssue[],
): ReadonlyArray<{ path: string; message: string }> {
	return issues.map((issue) => ({
		path:
			issue.path
				?.map((part) => String(part instanceof Object ? part.key : part))
				.join(".") ?? "",
		message: issue.message,
	}));
}

export function toJsonSchema(
	schema: StandardSchemaV1<unknown, unknown>,
): JsonSchema {
	if (schema instanceof z.ZodType) {
		return z.toJSONSchema(schema, { target: "draft-2020-12" }) as JsonSchema;
	}
	throw new TypeError(
		`JSON Schema export is unavailable for ${schema["~standard"].vendor}`,
	);
}
