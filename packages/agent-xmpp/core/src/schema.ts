import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import {
	type AgentApiManifest,
	assertUnicodeScalarString,
	DEFAULT_JSON_LIMITS,
	isApiVersion,
	isNormalizedEndpointJid,
	isToolName,
	isXep0082DateTime,
	type JsonSchema,
	parseStrictJson,
	type RegisteredTool,
	XMPP_TOOL_EXTENSION_KEY,
} from "@agent-xmpp/protocol";
import EVENT_SCHEMA_DOCUMENT from "@agent-xmpp/protocol/schema/event.schema.json" with {
	type: "json",
};
import MANIFEST_SCHEMA_DOCUMENT from "@agent-xmpp/protocol/schema/manifest.schema.json" with {
	type: "json",
};
import {
	Ajv2020,
	type ErrorObject,
	type ValidateFunction,
} from "ajv/dist/2020.js";

export const MANIFEST_MAX_BYTES = 1_048_576;
export const SCHEMA_MAX_BYTES = 262_144;
export const SCHEMA_MAX_DEPTH = 64;
export const SCHEMA_MAX_NODES = 10_000;
export const SCHEMA_MAX_PATTERN_BYTES = 4_096;
export const SCHEMA_MAX_PENDING_VALIDATIONS = 64;

export class SchemaResourceLimitError extends Error {}

const MANIFEST_SCHEMA = MANIFEST_SCHEMA_DOCUMENT as JsonSchema;
const EVENT_SCHEMA = EVENT_SCHEMA_DOCUMENT as JsonSchema;

const ajv = new Ajv2020({
	strict: true,
	allErrors: true,
	validateSchema: true,
	unicodeRegExp: true,
	ownProperties: true,
});
ajv.addFormat("uri", {
	type: "string",
	validate(value: string): boolean {
		try {
			return new URL(value).protocol.length > 1;
		} catch {
			return false;
		}
	},
});
ajv.addFormat("date-time", isXep0082DateTime);
const manifestValidator = ajv.compile(MANIFEST_SCHEMA);
const validatorCache = new Map<string, ValidateFunction>();
const SCHEMA_WORKER_COUNT = 2;
const SCHEMA_WORKER_FAILURE_LIMIT = 3;
const DEFAULT_SCHEMA_TIMEOUT_MS = 500;

interface WorkerRequest {
	id: number;
	schemaHash: string;
	schema: JsonSchema;
	value: unknown;
}

interface WorkerResponse {
	id: number;
	errors?: string[];
	failure?: string;
}

interface PendingValidation {
	request: WorkerRequest;
	timeoutMs: number;
	resolve: (errors: string[]) => void;
	reject: (error: Error) => void;
}

interface SchemaWorkerSlot {
	worker: Worker;
	pending?: PendingValidation;
	timer?: ReturnType<typeof setTimeout>;
}

let nextValidationId = 1;
let consecutiveWorkerFailures = 0;
const validationQueue: PendingValidation[] = [];
const schemaWorkers: SchemaWorkerSlot[] = [];

/** RFC 8785 JSON Canonicalization Scheme serialization. */
export function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") {
		assertUnicodeScalarString(value);
		return JSON.stringify(value);
	}
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("non-finite JSON number");
		return Object.is(value, -0) ? "0" : JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		const object = value as Record<string, unknown>;
		return `{${Object.keys(object)
			.sort()
			.map((key) => `${canonicalJson(key)}:${canonicalJson(object[key])}`)
			.join(",")}}`;
	}
	throw new Error(`unsupported JSON value: ${typeof value}`);
}

/** XEP-0300 SHA-256 value: standard padded Base64, without an algorithm prefix. */
export function digestJson(value: unknown): string {
	return createHash("sha256")
		.update(canonicalJson(value), "utf8")
		.digest("base64");
}

export function assertJsonValueBounded(
	value: unknown,
	maxBytes: number,
	label = "JSON value",
): void {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
		throw new Error("JSON byte limit must be a positive integer");
	const pending: Array<{ value: unknown; depth: number }> = [
		{ value, depth: 0 },
	];
	const visited = new WeakSet<object>();
	let members = 0;
	while (pending.length > 0) {
		const current = pending.pop()!;
		if (current.depth > DEFAULT_JSON_LIMITS.maxDepth) {
			throw new SchemaResourceLimitError(
				`${label} exceeds JSON depth ${DEFAULT_JSON_LIMITS.maxDepth}`,
			);
		}
		if (typeof current.value === "string") {
			if (
				Buffer.byteLength(current.value, "utf8") >
				DEFAULT_JSON_LIMITS.maxStringBytes
			) {
				throw new SchemaResourceLimitError(
					`${label} contains an oversized JSON string`,
				);
			}
			continue;
		}
		if (current.value === null || typeof current.value !== "object") continue;
		if (visited.has(current.value))
			throw new Error(`${label} contains a cyclic value`);
		visited.add(current.value);
		const entries = Array.isArray(current.value)
			? current.value.map((item) => [undefined, item] as const)
			: Object.entries(current.value as Record<string, unknown>);
		members += entries.length;
		if (members > DEFAULT_JSON_LIMITS.maxMembers) {
			throw new SchemaResourceLimitError(`${label} exceeds JSON member limit`);
		}
		for (const [key, child] of entries) {
			if (
				key !== undefined &&
				Buffer.byteLength(key, "utf8") > DEFAULT_JSON_LIMITS.maxStringBytes
			) {
				throw new SchemaResourceLimitError(
					`${label} contains an oversized JSON member name`,
				);
			}
			pending.push({ value: child, depth: current.depth + 1 });
		}
	}
	const encoded = JSON.stringify(value);
	if (encoded === undefined) throw new Error(`${label} is not a JSON value`);
	if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
		throw new SchemaResourceLimitError(`${label} exceeds ${maxBytes} bytes`);
	}
}

export function parseManifestJson(text: string): AgentApiManifest {
	return validateManifest(
		parseStrictJson(text, { maxBytes: MANIFEST_MAX_BYTES }),
	);
}

export function validateManifest(value: unknown): AgentApiManifest {
	const canonical = canonicalJson(value);
	if (Buffer.byteLength(canonical, "utf8") > MANIFEST_MAX_BYTES) {
		throw new SchemaResourceLimitError("manifest exceeds 1 MiB");
	}
	if (!manifestValidator(value))
		throw new Error(
			`invalid manifest: ${formatErrors(manifestValidator.errors)}`,
		);
	const manifest = value as AgentApiManifest;
	if (!isNormalizedEndpointJid(manifest.agent.jid)) {
		throw new Error("agent.jid must be a normalized endpoint bare JID");
	}
	if (!isApiVersion(manifest.agent.version))
		throw new Error("agent.version must be a valid API version");
	for (const [member, uri] of [
		["agent.homepage", manifest.agent.homepage],
		["agent.avatarUrl", manifest.agent.avatarUrl],
	] as const) {
		if (uri !== undefined && !isPublicProfileHttpsUri(uri)) {
			throw new Error(
				`${member} must be an absolute lowercase HTTPS URI with a non-empty host and no userinfo`,
			);
		}
	}
	const names = new Set<string>();
	for (const tool of manifest.tools) {
		assertUnicodeScalarString(tool.name);
		if (!isToolName(tool.name)) throw new Error("invalid XML tool name");
		if (names.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
		names.add(tool.name);
		preflightSchema(tool.inputSchema, `tool ${tool.name} inputSchema`);
		if (tool.outputSchema)
			preflightSchema(tool.outputSchema, `tool ${tool.name} outputSchema`);
		const extension = tool[XMPP_TOOL_EXTENSION_KEY] as
			| Record<string, unknown>
			| undefined;
		const defaultTimeout = extension?.defaultTimeoutSeconds;
		const maximumTimeout = extension?.maximumTimeoutSeconds;
		if (
			typeof defaultTimeout === "number" &&
			typeof maximumTimeout === "number" &&
			defaultTimeout > maximumTimeout
		) {
			throw new Error(
				`tool ${tool.name} default timeout exceeds maximum timeout`,
			);
		}
	}
	return manifest;
}

function isPublicProfileHttpsUri(value: string): boolean {
	if (
		!value.startsWith("https://") ||
		!/^[A-Za-z0-9\-._~:/?[\]@!$&'()*+,;=%]+$/.test(value) ||
		/%(?![0-9A-Fa-f]{2})/.test(value) ||
		!URL.canParse(value)
	) {
		return false;
	}
	const authority = value.slice("https://".length).split(/[/?]/, 1)[0]!;
	if (authority.endsWith(":")) return false;
	const uri = new URL(value);
	return (
		uri.protocol === "https:" &&
		uri.hostname.length > 0 &&
		uri.username === "" &&
		uri.password === "" &&
		uri.hash === ""
	);
}

export function registeredTools(manifest: AgentApiManifest): RegisteredTool[] {
	return manifest.tools.map((tool) => ({
		...tool,
		inputSchemaHash: digestJson(tool.inputSchema),
		outputSchemaHash: tool.outputSchema
			? digestJson(tool.outputSchema)
			: undefined,
		xmpp: tool[XMPP_TOOL_EXTENSION_KEY] as RegisteredTool["xmpp"],
	}));
}

export function validateJson(schema: JsonSchema, value: unknown): string[] {
	preflightSchema(schema, "schema");
	const hash = digestJson(schema);
	let validate = validatorCache.get(hash);
	if (!validate) {
		const compiled = ajv.compile(schema);
		validatorCache.set(hash, compiled);
		validate = compiled;
	}
	return validate(value) ? [] : (validate.errors ?? []).map(formatError);
}

/**
 * Evaluate caller-controlled schemas away from the host event loop. Workers are
 * bounded and replaced after a timeout; each worker caches validators by the
 * canonical schema hash.
 */
export function validateJsonBounded(
	schema: JsonSchema,
	value: unknown,
	timeoutMs = DEFAULT_SCHEMA_TIMEOUT_MS,
): Promise<string[]> {
	preflightSchema(schema, "schema");
	if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
		return Promise.reject(
			new Error("schema timeout must be a positive integer"),
		);
	}
	const pendingCount =
		validationQueue.length +
		schemaWorkers.filter((slot) => slot.pending).length;
	if (pendingCount >= SCHEMA_MAX_PENDING_VALIDATIONS) {
		return Promise.reject(
			new SchemaResourceLimitError("schema validation queue is full"),
		);
	}
	return new Promise<string[]>((resolve, reject) => {
		validationQueue.push({
			request: {
				id: nextValidationId++,
				schemaHash: digestJson(schema),
				schema,
				value,
			},
			timeoutMs,
			resolve,
			reject,
		});
		ensureSchemaWorkers();
		dispatchValidationQueue();
	});
}

export function validateTaskEventPayload(
	type:
		| "status"
		| "progress"
		| "input_required"
		| "completed"
		| "failed"
		| "cancelled",
	payload: unknown,
): Promise<string[]> {
	const schema: JsonSchema = { ...EVENT_SCHEMA, $ref: `#/$defs/${type}` };
	delete schema.$id;
	return validateJsonBounded(schema, payload);
}

export async function closeSchemaWorkers(): Promise<void> {
	const workers = schemaWorkers.splice(0);
	for (const slot of workers) {
		if (slot.timer) clearTimeout(slot.timer);
		slot.pending?.reject(new Error("schema validator worker closed"));
		await slot.worker.terminate();
	}
	while (validationQueue.length)
		validationQueue
			.shift()!
			.reject(new Error("schema validator worker closed"));
}

function ensureSchemaWorkers(): void {
	while (schemaWorkers.length < SCHEMA_WORKER_COUNT) {
		try {
			schemaWorkers.push(createSchemaWorker());
		} catch (error) {
			consecutiveWorkerFailures++;
			if (consecutiveWorkerFailures >= SCHEMA_WORKER_FAILURE_LIMIT) {
				rejectValidationQueue(
					error instanceof Error
						? error
						: new Error("schema validator worker failed"),
				);
				consecutiveWorkerFailures = 0;
				return;
			}
		}
	}
}

function createSchemaWorker(): SchemaWorkerSlot {
	const sourceMode = import.meta.url.endsWith(".ts");
	const worker = new Worker(
		new URL(
			sourceMode ? "./schema-worker.ts" : "./schema-worker.js",
			import.meta.url,
		),
		{
			execArgv: sourceMode ? ["--import", "tsx"] : undefined,
		},
	);
	worker.unref();
	const slot: SchemaWorkerSlot = { worker };
	worker.on("message", (response: WorkerResponse) =>
		settleWorker(slot, response),
	);
	worker.on("error", (error) => replaceWorker(slot, error));
	worker.on("exit", (code) => {
		if (schemaWorkers.includes(slot) && code !== 0) {
			replaceWorker(
				slot,
				new Error(`schema validator worker exited with code ${code}`),
			);
		}
	});
	return slot;
}

function dispatchValidationQueue(): void {
	for (const slot of schemaWorkers) {
		if (slot.pending) continue;
		const pending = validationQueue.shift();
		if (!pending) return;
		slot.pending = pending;
		slot.timer = setTimeout(() => {
			replaceWorker(
				slot,
				new SchemaResourceLimitError(
					`schema validation timed out after ${pending.timeoutMs}ms`,
				),
			);
		}, pending.timeoutMs);
		slot.timer.unref?.();
		slot.worker.postMessage(pending.request);
	}
}

function settleWorker(slot: SchemaWorkerSlot, response: WorkerResponse): void {
	const pending = slot.pending;
	if (!pending || pending.request.id !== response.id) return;
	if (slot.timer) clearTimeout(slot.timer);
	slot.timer = undefined;
	slot.pending = undefined;
	consecutiveWorkerFailures = 0;
	if (response.failure)
		pending.reject(new Error(`schema validation failed: ${response.failure}`));
	else pending.resolve(response.errors ?? []);
	dispatchValidationQueue();
}

function replaceWorker(slot: SchemaWorkerSlot, error: Error): void {
	const index = schemaWorkers.indexOf(slot);
	if (index < 0) return;
	if (slot.timer) clearTimeout(slot.timer);
	slot.pending?.reject(error);
	slot.pending = undefined;
	void slot.worker.terminate();
	schemaWorkers.splice(index, 1);
	consecutiveWorkerFailures++;
	if (consecutiveWorkerFailures >= SCHEMA_WORKER_FAILURE_LIMIT) {
		rejectValidationQueue(error);
		consecutiveWorkerFailures = 0;
		return;
	}
	if (validationQueue.length > 0) {
		ensureSchemaWorkers();
		dispatchValidationQueue();
	}
}

function rejectValidationQueue(error: Error): void {
	while (validationQueue.length) validationQueue.shift()!.reject(error);
}

export function preflightSchema(schema: JsonSchema, label: string): void {
	assertSchemaComplexity(schema, label);
	const encoded = canonicalJson(schema);
	if (Buffer.byteLength(encoded, "utf8") > SCHEMA_MAX_BYTES) {
		throw new SchemaResourceLimitError(`${label} exceeds 256 KiB`);
	}
	if (!ajv.validateSchema(schema))
		throw new Error(
			`${label} is not a valid JSON Schema: ${formatErrors(ajv.errors)}`,
		);
}

function assertSchemaComplexity(schema: JsonSchema, label: string): void {
	const pending: Array<{ value: unknown; depth: number }> = [
		{ value: schema, depth: 0 },
	];
	let nodes = 0;
	while (pending.length > 0) {
		const { value, depth } = pending.pop()!;
		if (++nodes > SCHEMA_MAX_NODES) {
			throw new SchemaResourceLimitError(
				`${label} exceeds ${SCHEMA_MAX_NODES} nodes`,
			);
		}
		if (depth > SCHEMA_MAX_DEPTH) {
			throw new SchemaResourceLimitError(
				`${label} exceeds depth ${SCHEMA_MAX_DEPTH}`,
			);
		}
		if (!value || typeof value !== "object") continue;
		const object = value as Record<string, unknown>;
		for (const keyword of ["$ref", "$dynamicRef"] as const) {
			const reference = object[keyword];
			if (typeof reference === "string" && !reference.startsWith("#")) {
				throw new Error(`${label} contains forbidden external ${keyword}`);
			}
		}
		if (object.$vocabulary && typeof object.$vocabulary === "object") {
			for (const [vocabulary, required] of Object.entries(
				object.$vocabulary as Record<string, unknown>,
			)) {
				if (
					required === true &&
					!vocabulary.startsWith("https://json-schema.org/draft/2020-12/vocab/")
				) {
					throw new Error(
						`${label} requires unsupported vocabulary ${vocabulary}`,
					);
				}
			}
		}
		if (typeof object.pattern === "string")
			assertPattern(object.pattern, label);
		if (
			object.patternProperties &&
			typeof object.patternProperties === "object"
		) {
			for (const pattern of Object.keys(
				object.patternProperties as Record<string, unknown>,
			)) {
				assertPattern(pattern, label);
			}
		}
		const children = Array.isArray(value) ? value : Object.values(object);
		for (const child of children)
			pending.push({ value: child, depth: depth + 1 });
	}
}

function assertPattern(pattern: string, label: string): void {
	if (Buffer.byteLength(pattern, "utf8") > SCHEMA_MAX_PATTERN_BYTES) {
		throw new SchemaResourceLimitError(
			`${label} contains a pattern exceeding ${SCHEMA_MAX_PATTERN_BYTES} bytes`,
		);
	}
	try {
		new RegExp(pattern, "u");
	} catch (error) {
		throw new Error(`${label} contains an invalid ECMA-262 pattern`, {
			cause: error,
		});
	}
}

function formatError(error: ErrorObject): string {
	return `${error.instancePath || "$"} ${error.message ?? error.keyword}`;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
	return (
		(errors ?? []).map(formatError).join("; ") || "schema validation failed"
	);
}
