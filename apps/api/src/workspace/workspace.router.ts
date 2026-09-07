import { workspaceGate } from "@crm/validation/workspace-gate";
import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type {
	AuthedTrpcContext,
	SessionTrpcContext,
} from "../trpc/context.types";
import {
	AuthMiddleware,
	SessionMiddleware,
} from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	memberListInput,
	memberListOutput,
	setMemberRoleInput,
	updateWorkspaceInput,
	workspaceMemberOutput,
	workspaceOutput,
} from "./workspace.contracts";
import { WorkspaceService } from "./workspace.service";

@Router({ alias: "workspace" })
export class WorkspaceRouter {
	constructor(
		@Inject(WorkspaceService) private readonly workspace: WorkspaceService,
	) {}

	@Query({
		output: workspaceOutput,
		meta: restMeta("GET", "/workspace", ["Workspace"]),
	})
	@UseMiddlewares(AuthMiddleware)
	async get(@Ctx() ctx: AuthedTrpcContext) {
		return this.workspace.get(ctx.user.id);
	}

	@Query({ output: workspaceGate })
	@UseMiddlewares(SessionMiddleware)
	async gate(@Ctx() ctx: SessionTrpcContext) {
		return this.workspace.gate(
			ctx.user.id,
			ctx.session.session.activeOrganizationId,
		);
	}

	@Query({
		input: memberListInput,
		output: memberListOutput,
		meta: restMeta("POST", "/workspace/members/search", ["Workspace"]),
	})
	@UseMiddlewares(AuthMiddleware)
	async members(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof memberListInput>,
	) {
		return this.workspace.members(ctx.user.id, input);
	}

	@Mutation({
		input: updateWorkspaceInput,
		output: workspaceOutput,
		meta: restMeta("PATCH", "/workspace", ["Workspace"]),
	})
	@UseMiddlewares(AuthMiddleware)
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof updateWorkspaceInput>,
	) {
		return this.workspace.update(ctx.user.id, input);
	}

	@Mutation({
		input: setMemberRoleInput,
		output: workspaceMemberOutput,
		meta: restMeta("PATCH", "/workspace/members/{memberId}/role", [
			"Workspace",
		]),
	})
	@UseMiddlewares(AuthMiddleware)
	async setMemberRole(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setMemberRoleInput>,
	) {
		return this.workspace.setMemberRole(ctx.user.id, input);
	}
}
