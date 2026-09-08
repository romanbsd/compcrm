import type { OpenAPIObject } from "trpc-to-openapi";
import { z } from "zod";
import { type RestMethod, restMeta } from "../trpc/openapi";
import { assetErrorEnvelopeSchema } from "./assets.contracts";

const requestHeaders = z.object({
	"X-Request-Id": z.string().max(128).optional(),
});
const mutationHeaders = requestHeaders.extend({
	"Idempotency-Key": z
		.string()
		.min(1)
		.max(128)
		.regex(/^[\x20-\x7e]+$/),
});

export function assetRestMeta(method: RestMethod, path: `/${string}`) {
	const meta = restMeta(method, path, ["Assets"]);
	if (meta.openapi) {
		meta.openapi.requestHeaders =
			method === "GET" ? requestHeaders : mutationHeaders;
		meta.openapi.responseHeaders = z.object({
			"Cache-Control": z.literal("private, no-store"),
			"X-Request-Id": z.string(),
		});
		meta.openapi.errorResponses = [400, 401, 403, 404, 409, 413, 429, 500, 503];
	}
	return meta;
}

export function describeAssetErrors(document: OpenAPIObject): void {
	for (const [path, methods] of Object.entries(document.paths ?? {})) {
		if (
			!/^\/v1\/(?:projects|customers)\/\{[^}]+\}\/(?:assets|asset-uploads)(?:\/|$)/.test(
				path,
			)
		)
			continue;
		for (const method of ["get", "post", "delete"] as const) {
			const responses = methods[method]?.responses;
			if (!responses) continue;
			for (const [status, response] of Object.entries(responses)) {
				if (Number(status) < 400 || "$ref" in response) continue;
				response.content = {
					"application/json": {
						schema: z.toJSONSchema(assetErrorEnvelopeSchema),
					},
				};
			}
		}
	}
}
