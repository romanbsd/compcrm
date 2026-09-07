import { describe, expect, it } from "bun:test";
import type { Session } from "@crm/auth";
import type { Db } from "@crm/db";
import { tryCurrentOrganizationId } from "@crm/db/tenant-context";
import { TRPCError } from "@trpc/server";
import type { RequestPrincipal } from "../src/auth/request-principal";
import type { BaseTrpcContext } from "../src/trpc/context.types";
import {
	AuthMiddleware,
	SessionMiddleware,
} from "../src/trpc/middlewares/auth.middleware";

const member = { findUnique: async () => ({ id: "member-1" }) };
const middleware = new AuthMiddleware({ member } as unknown as Db);
const removedMemberMiddleware = new AuthMiddleware({
	member: { findUnique: async () => null },
} as unknown as Db);
const sessionMiddleware = new SessionMiddleware();

function principal(
	credentialKind: RequestPrincipal["credentialKind"],
	organizationId: string | null,
): RequestPrincipal {
	const session =
		credentialKind === "session"
			? ({
					user: { id: "user-1" },
					session: { activeOrganizationId: organizationId },
				} as Session)
			: null;

	return {
		credentialKind,
		user: { id: "user-1" } as RequestPrincipal["user"],
		clientId: credentialKind === "oauth" ? "client-1" : null,
		scopes: new Set(),
		session,
		organizationId,
		expiresAt: null,
	};
}

function context(value: RequestPrincipal | null): BaseTrpcContext {
	return { principal: value, session: value?.session ?? null };
}

function options(ctx: BaseTrpcContext) {
	return {
		ctx,
		next: async ({ ctx: nextCtx }: { ctx: unknown }) => ({ ctx: nextCtx }),
	} as never;
}

describe("AuthMiddleware", () => {
	it("rejects an unauthenticated request", async () => {
		await expect(middleware.use(options(context(null)))).rejects.toMatchObject(
			new TRPCError({ code: "UNAUTHORIZED" }),
		);
	});

	it("rejects a principal without an active organization", async () => {
		await expect(
			middleware.use(options(context(principal("session", null)))),
		).rejects.toMatchObject(new TRPCError({ code: "FORBIDDEN" }));
	});

	for (const credentialKind of ["session", "apiKey", "oauth"] as const) {
		it(`establishes tenant context for ${credentialKind}`, async () => {
			let activeOrganizationId: string | undefined;
			const ctx = context(principal(credentialKind, "org-a"));
			const result = await middleware.use({
				ctx,
				next: async ({ ctx: nextCtx }: { ctx: unknown }) => {
					activeOrganizationId = tryCurrentOrganizationId();
					return { ctx: nextCtx };
				},
			} as never);

			expect(activeOrganizationId).toBe("org-a");
			expect(result).toMatchObject({
				ctx: { organizationId: "org-a", user: { id: "user-1" } },
			});
			expect(tryCurrentOrganizationId()).toBeUndefined();
		});
	}

	it("rejects a principal removed from its organization", async () => {
		await expect(
			removedMemberMiddleware.use(
				options(context(principal("oauth", "org-a"))),
			),
		).rejects.toMatchObject(new TRPCError({ code: "FORBIDDEN" }));
	});
});

describe("SessionMiddleware", () => {
	it("allows a signed-in user without an active organization", async () => {
		const ctx = context(principal("session", null));

		expect(await sessionMiddleware.use(options(ctx))).toMatchObject({
			ctx: { user: { id: "user-1" }, session: ctx.session },
		});
	});

	it("rejects API keys and OAuth tokens", async () => {
		for (const kind of ["apiKey", "oauth"] as const) {
			await expect(
				sessionMiddleware.use(options(context(principal(kind, "org-a")))),
			).rejects.toMatchObject(new TRPCError({ code: "UNAUTHORIZED" }));
		}
	});
});
