import { randomUUID } from "node:crypto";
import type { TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import { z } from "zod";
import { AssetError } from "./asset-error";
import { assetErrorEnvelopeSchema } from "./assets.contracts";

const domainFailure = assetErrorEnvelopeSchema.shape.error
	.omit({ requestId: true })
	.partial({ retryable: true });
const rawMutationNumbers = z.object({
	sizeBytes: z.number().optional(),
	durationMilliseconds: z.number().nullable().optional(),
});
type AssetFailure = {
	status: number;
	body: {
		error: z.infer<typeof domainFailure> & {
			requestId: string;
			retryable: boolean;
		};
	};
};
type AssetRequestState = { requestId: string; failure?: AssetFailure };
const requests = new WeakMap<Request, AssetRequestState>();

export function prepareAssetRestResponse(req: Request, res: Response): void {
	if (
		!/^\/v1\/(?:projects|customers)\/[^/]+\/(?:asset-uploads|assets)(?:\/|$)/.test(
			req.path,
		)
	)
		return;
	const supplied = req.header("X-Request-Id");
	const requestId =
		supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
			? supplied
			: randomUUID();
	const state: AssetRequestState = { requestId };
	requests.set(req, state);
	res.setHeader("Cache-Control", "private, no-store");
	res.setHeader("X-Request-Id", requestId);
	res.end = new Proxy(res.end, {
		apply(end, response, args) {
			requests.delete(req);
			if (!state.failure) return Reflect.apply(end, response, args);
			res.statusCode = state.failure.status;
			res.removeHeader("Content-Length");
			if (state.failure.status === 429) res.setHeader("Retry-After", "60");
			return Reflect.apply(end, response, [JSON.stringify(state.failure.body)]);
		},
	});
}

export function validateAssetRestRequest(req: Request): void {
	if (!requests.has(req)) return;
	const url = new URL(req.originalUrl, "http://localhost");
	const forbiddenQuery = ["customerId", "uploadId", "assetId"];
	if (!/^\/rest\/v1\/customers\/[^/]+\/assets\/?$/.test(url.pathname))
		forbiddenQuery.push("projectId");
	if (forbiddenQuery.some((key) => url.searchParams.has(key))) {
		throw new AssetError(
			400,
			"VALIDATION_ERROR",
			"Path identifiers cannot appear in the query.",
		);
	}
	if (req.method === "POST") {
		if (url.search)
			throw new AssetError(
				400,
				"VALIDATION_ERROR",
				"Upload mutations do not accept query parameters.",
			);
		const body = z.record(z.string(), z.json()).safeParse(req.body);
		if (
			!body.success ||
			["projectId", "uploadId", "assetId", "customerId"].some(
				(key) => key in body.data,
			)
		) {
			throw new AssetError(
				400,
				"VALIDATION_ERROR",
				"Send a JSON object without path identifiers.",
			);
		}
		if (!rawMutationNumbers.safeParse(body.data).success) {
			throw new AssetError(
				400,
				"VALIDATION_ERROR",
				"Byte counts and durations must use JSON numbers.",
			);
		}
	}
	if (
		(req.method === "DELETE" || req.method === "GET") &&
		(req.headers["transfer-encoding"] ||
			Number(req.header("content-length") ?? 0) > 0)
	) {
		throw new AssetError(
			400,
			"VALIDATION_ERROR",
			"This operation does not accept a request body.",
		);
	}
}

export function recordAssetRestError(req: Request, error: TRPCError): void {
	const state = requests.get(req);
	if (!state) return;
	const cause = error.cause;
	if (cause instanceof AssetError) {
		const parsed = domainFailure.safeParse(cause.getResponse());
		if (parsed.success) {
			state.failure = {
				status: cause.getStatus(),
				body: {
					error: {
						...parsed.data,
						requestId: state.requestId,
						retryable: parsed.data.retryable ?? false,
					},
				},
			};
			return;
		}
	}
	const failure = fallbackFailure(error);
	state.failure = {
		status: failure.status,
		body: {
			error: {
				code: failure.code,
				message: failure.message,
				requestId: state.requestId,
				retryable: false,
			},
		},
	};
	if (error.code === "BAD_REQUEST" && cause instanceof z.ZodError) {
		state.failure.body.error.details = {
			fields: cause.issues.map((issue) => ({
				field: issue.path.join("."),
				message: issue.message,
			})),
		};
	}
}

function fallbackFailure(error: TRPCError) {
	switch (error.code) {
		case "UNAUTHORIZED":
			return {
				status: 401,
				code: "AUTH_REQUIRED",
				message: "Authentication is required.",
			};
		case "FORBIDDEN":
			return {
				status: 403,
				code: "FORBIDDEN",
				message: "This operation is not permitted.",
			};
		case "NOT_FOUND":
			return {
				status: 404,
				code: "RESOURCE_NOT_FOUND",
				message: "The resource was not found.",
			};
		case "BAD_REQUEST":
		case "PARSE_ERROR":
		case "UNSUPPORTED_MEDIA_TYPE":
		case "PAYLOAD_TOO_LARGE":
			return {
				status: 400,
				code: "VALIDATION_ERROR",
				message: "The request metadata is invalid.",
			};
		default:
			return {
				status: 500,
				code: "INTERNAL_ERROR",
				message: "The operation failed. Check its status before retrying.",
			};
	}
}
