import type { SendPayload } from "eve/channels";

import type {
	ExportInvocation,
	ExportJsonObject,
	ExportProgress,
} from "./wire";

export interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly "~standard": {
		readonly version: 1;
		readonly vendor: string;
		validate(
			value: Input,
		): StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
	};
}

export type StandardSchemaResult<T> =
	| { readonly value: T; readonly issues?: undefined }
	| { readonly issues: readonly StandardSchemaIssue[] };

export interface StandardSchemaIssue {
	readonly message: string;
	readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

export interface ExportToolAnnotations {
	readonly title?: string;
	readonly idempotent?: boolean;
	readonly readOnly?: boolean;
	readonly destructive?: boolean;
	readonly longRunning?: boolean;
}

export interface ExportAgentRequest<T> {
	readonly message: NonNullable<SendPayload["message"]>;
	readonly outputSchema?: StandardSchemaV1<unknown, T>;
	readonly title?: string;
	readonly taskMode?: boolean;
	readonly clientContext?: ExportJsonObject;
}

export interface ExportAgentResult<T> {
	readonly sessionId: string;
	readonly value: T;
}

export interface ExportToolContext {
	readonly abortSignal: AbortSignal;
	readonly invocation: ExportInvocation;
	progress(update: ExportProgress): Promise<void>;
	send<T = unknown>(
		request: ExportAgentRequest<T>,
	): Promise<ExportAgentResult<T>>;
}

export interface ExportToolDefinition<I, O> {
	readonly description: string;
	readonly inputSchema: StandardSchemaV1<unknown, I>;
	readonly outputSchema?: StandardSchemaV1<unknown, O>;
	readonly annotations?: ExportToolAnnotations;
	execute(input: I, ctx: ExportToolContext): Promise<O> | O;
}

export type AnyExportToolDefinition = ExportToolDefinition<unknown, unknown>;

export type JsonSchema = NonNullable<SendPayload["outputSchema"]>;

export interface ExportToolManifestEntry {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: JsonSchema;
	outputSchema?: JsonSchema;
	annotations?: ExportToolAnnotations;
}
