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
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { restMeta } from "../trpc/openapi";
import {
	dealAttachContactInput,
	dealBulkInput,
	dealBulkOwnerInput,
	dealBulkResultOutput,
	dealBulkStageInput,
	dealContactAttachOutput,
	dealContactLinkOutput,
	dealContactOptionsOutput,
	dealContactRoleInput,
	dealContactRoleOutput,
	dealContactsInput,
	dealCreateInput,
	dealCreateOutput,
	dealDetachContactInput,
	dealDetailOutput,
	dealIdInput,
	dealListInput,
	dealListOutput,
	dealMutateOutput,
	dealSetStageOutput,
	dealUpdateArgs,
	setStageInput,
} from "./deals.contracts";
import { DealsService } from "./deals.service";

@Router({ alias: "deals" })
@UseMiddlewares(AuthMiddleware)
export class DealsRouter {
	constructor(@Inject(DealsService) private readonly deals: DealsService) {}

	@Query({
		input: dealListInput,
		output: dealListOutput,
		meta: restMeta("POST", "/deals/search", ["Projects"]),
	})
	async list(@Input() input: z.infer<typeof dealListInput>) {
		return this.deals.list(input);
	}

	@Query({
		input: dealIdInput,
		output: dealDetailOutput,
		meta: restMeta("GET", "/deals/{id}", ["Projects"]),
	})
	async byId(@Input("id") id: string) {
		return this.deals.byId(id);
	}

	@Mutation({
		input: dealCreateInput,
		output: dealCreateOutput,
		meta: restMeta("POST", "/deals", ["Projects"]),
	})
	async create(@Input() input: z.infer<typeof dealCreateInput>) {
		return this.deals.create(input);
	}

	@Mutation({
		input: dealUpdateArgs,
		output: dealMutateOutput,
		meta: restMeta("PATCH", "/deals/{id}", ["Projects"]),
	})
	async update(@Input() input: z.infer<typeof dealUpdateArgs>) {
		return this.deals.update(input.id, input.data);
	}

	@Mutation({
		input: dealIdInput,
		output: dealMutateOutput,
		meta: restMeta("POST", "/deals/{id}/archive", ["Projects"]),
	})
	async archive(@Input("id") id: string) {
		return this.deals.archive(id);
	}

	@Mutation({
		input: dealIdInput,
		output: dealMutateOutput,
		meta: restMeta("POST", "/deals/{id}/restore", ["Projects"]),
	})
	async restore(@Input("id") id: string) {
		return this.deals.restore(id);
	}

	@Mutation({
		input: dealIdInput,
		output: dealMutateOutput,
		meta: restMeta("DELETE", "/deals/{id}", ["Projects"]),
	})
	async purge(@Input("id") id: string) {
		return this.deals.purge(id);
	}

	@Mutation({
		input: setStageInput,
		output: dealSetStageOutput,
		meta: restMeta("PATCH", "/deals/{id}/stage", ["Projects"]),
	})
	async setStage(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setStageInput>,
	) {
		return this.deals.setStage(input, ctx.user.id);
	}

	@Query({
		input: dealContactsInput,
		output: dealContactOptionsOutput,
		meta: restMeta("GET", "/deals/{dealId}/contact-options", ["Projects"]),
	})
	async contactOptions(@Input("dealId") dealId: string) {
		return this.deals.contactOptions(dealId);
	}

	@Mutation({
		input: dealAttachContactInput,
		output: dealContactAttachOutput,
		meta: restMeta("POST", "/deals/{dealId}/contacts", ["Projects"]),
	})
	async attachContact(@Input() input: z.infer<typeof dealAttachContactInput>) {
		return this.deals.attachContact(input);
	}

	@Mutation({
		input: dealDetachContactInput,
		output: dealContactLinkOutput,
		meta: restMeta("DELETE", "/deals/{dealId}/contacts/{contactId}", [
			"Projects",
		]),
	})
	async detachContact(@Input() input: z.infer<typeof dealDetachContactInput>) {
		return this.deals.detachContact(input);
	}

	@Mutation({
		input: dealContactRoleInput,
		output: dealContactRoleOutput,
		meta: restMeta("PATCH", "/deals/{dealId}/contacts/{contactId}/role", [
			"Projects",
		]),
	})
	async setContactRole(@Input() input: z.infer<typeof dealContactRoleInput>) {
		return this.deals.setContactRole(input);
	}

	@Mutation({
		input: dealBulkOwnerInput,
		output: dealBulkResultOutput,
		meta: restMeta("POST", "/deals/bulk-assign-owner", ["Projects"]),
	})
	async bulkAssignOwner(@Input() input: z.infer<typeof dealBulkOwnerInput>) {
		return this.deals.bulkAssignOwner(input);
	}

	@Mutation({
		input: dealBulkStageInput,
		output: dealBulkResultOutput,
		meta: restMeta("POST", "/deals/bulk-set-stage", ["Projects"]),
	})
	async bulkSetStage(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dealBulkStageInput>,
	) {
		return this.deals.bulkSetStage(input, ctx.user.id);
	}

	@Mutation({
		input: dealBulkInput,
		output: dealBulkResultOutput,
		meta: restMeta("POST", "/deals/bulk-archive", ["Projects"]),
	})
	async bulkArchive(@Input("ids") ids: string[]) {
		return this.deals.bulkArchive(ids);
	}

	@Mutation({
		input: dealBulkInput,
		output: dealBulkResultOutput,
		meta: restMeta("POST", "/deals/bulk-restore", ["Projects"]),
	})
	async bulkRestore(@Input("ids") ids: string[]) {
		return this.deals.bulkRestore(ids);
	}

	@Mutation({
		input: dealBulkInput,
		output: dealBulkResultOutput,
		meta: restMeta("POST", "/deals/bulk-purge", ["Projects"]),
	})
	async bulkPurge(@Input("ids") ids: string[]) {
		return this.deals.bulkPurge(ids);
	}
}
