import { oauthScopeFailure, requiredCrmScope } from "@crm/auth";
import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import type { BaseTrpcContext } from "../context.types";

@Injectable()
export class OAuthScopeMiddleware implements TRPCMiddleware {
	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const principal = ctx.principal;
		if (principal?.credentialKind !== "oauth") return opts.next();

		const requiredScope = requiredCrmScope(opts.type === "mutation");
		const failure = oauthScopeFailure(principal.scopes, requiredScope);
		if (failure) {
			ctx.req?.res?.setHeader("WWW-Authenticate", failure.challenge);
			throw new TRPCError({
				code: "FORBIDDEN",
				message: failure.message,
			});
		}

		return opts.next();
	}
}
