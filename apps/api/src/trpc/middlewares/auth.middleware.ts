import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import { setRequestUserId } from "../../logging/request-context";
import type { AuthedTrpcContext, BaseTrpcContext } from "../context.types";

@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const principal = ctx.principal;

		if (!principal) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}
		const user = principal.user;

		setRequestUserId(user.id);

		const nextCtx: AuthedTrpcContext = { ...ctx, principal, user };
		return opts.next({ ctx: nextCtx });
	}
}
