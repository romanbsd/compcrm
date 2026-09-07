import type { Db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import { InjectDatabase } from "../../database/database.constants";
import { setRequestUserId } from "../../logging/request-context";
import type {
	AuthedTrpcContext,
	BaseTrpcContext,
	SessionTrpcContext,
} from "../context.types";

function authenticatedSession(ctx: BaseTrpcContext): SessionTrpcContext {
	const session = ctx.session;
	const principal = ctx.principal;
	if (!session || !principal || principal.credentialKind !== "session") {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}

	setRequestUserId(principal.user.id);
	return { ...ctx, principal, session, user: principal.user };
}

@Injectable()
export class SessionMiddleware implements TRPCMiddleware {
	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		return opts.next({
			ctx: authenticatedSession(opts.ctx as BaseTrpcContext),
		});
	}
}

@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const principal = ctx.principal;
		if (!principal) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}

		const user = principal.user;
		setRequestUserId(user.id);

		const organizationId = principal.organizationId;
		if (!organizationId) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "You have no active organization.",
			});
		}

		const membership = await this.db.member.findUnique({
			where: { organizationId_userId: { organizationId, userId: user.id } },
			select: { id: true },
		});
		if (!membership) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "You are not a member of the active organization.",
			});
		}

		const nextCtx: AuthedTrpcContext = {
			...ctx,
			principal,
			user,
			organizationId,
		};
		return runInTenant(organizationId, () => opts.next({ ctx: nextCtx }));
	}
}
