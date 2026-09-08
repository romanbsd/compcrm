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
import { AssetError } from "./asset-error";
import { assetRestMeta } from "./asset-openapi";
import {
	assetDeletionSchema,
	assetDetailSchema,
	assetDownloadSchema,
	assetListSchema,
	customerAssetListArgs,
	projectAssetInput,
	projectAssetListInput,
	projectUploadCreateInput,
	projectUploadInput,
	uploadCancellationSchema,
	uploadConfirmationSchema,
	uploadGrantSchema,
	uploadStateSchema,
} from "./assets.contracts";
import { AssetsService } from "./assets.service";

@Router({ alias: "assets" })
@UseMiddlewares(AuthMiddleware)
export class AssetsRouter {
	constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}

	@Mutation({
		input: projectUploadCreateInput,
		output: uploadGrantSchema,
		meta: assetRestMeta("POST", "/v1/projects/{projectId}/asset-uploads"),
	})
	createUpload(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof projectUploadCreateInput>,
	) {
		const { projectId, ...body } = input;
		return this.assets.createUpload(
			{ type: "USER", userId: ctx.user.id },
			projectId,
			body,
			idempotencyKey(ctx),
		);
	}

	@Query({
		input: projectUploadInput,
		output: uploadStateSchema,
		meta: assetRestMeta(
			"GET",
			"/v1/projects/{projectId}/asset-uploads/{uploadId}",
		),
	})
	getUpload(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof projectUploadInput>,
	) {
		return this.assets.getUpload(
			{ type: "USER", userId: ctx.user.id },
			input.projectId,
			input.uploadId,
		);
	}

	@Mutation({
		input: projectUploadInput,
		output: uploadGrantSchema,
		meta: assetRestMeta(
			"POST",
			"/v1/projects/{projectId}/asset-uploads/{uploadId}/url",
		),
	})
	renewUpload(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof projectUploadInput>,
	) {
		return this.assets.renewUpload(
			{ type: "USER", userId: ctx.user.id },
			input.projectId,
			input.uploadId,
			idempotencyKey(ctx),
		);
	}

	@Mutation({
		input: projectUploadInput,
		output: uploadConfirmationSchema,
		meta: assetRestMeta(
			"POST",
			"/v1/projects/{projectId}/asset-uploads/{uploadId}/confirm",
		),
	})
	confirmUpload(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof projectUploadInput>,
	) {
		return this.assets.confirmUpload(
			{ type: "USER", userId: ctx.user.id },
			input.projectId,
			input.uploadId,
			idempotencyKey(ctx),
		);
	}

	@Mutation({
		input: projectUploadInput,
		output: uploadCancellationSchema,
		meta: assetRestMeta(
			"DELETE",
			"/v1/projects/{projectId}/asset-uploads/{uploadId}",
		),
	})
	cancelUpload(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof projectUploadInput>,
	) {
		return this.assets.cancelUpload(
			{ type: "USER", userId: ctx.user.id },
			input.projectId,
			input.uploadId,
			idempotencyKey(ctx),
		);
	}

	@Query({
		input: customerAssetListArgs,
		output: assetListSchema,
		meta: assetRestMeta("GET", "/v1/customers/{customerId}/assets"),
	})
	listCustomerAssets(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof customerAssetListArgs>,
	) {
		const { customerId, ...query } = input;
		return this.assets.listCustomerAssets(
			{ type: "USER", userId: ctx.user.id },
			customerId,
			query,
		);
	}

	@Query({
		input: projectAssetListInput,
		output: assetListSchema,
		meta: assetRestMeta("GET", "/v1/projects/{projectId}/assets"),
	})
	listProjectAssets(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof projectAssetListInput>,
	) {
		const { projectId, ...query } = input;
		return this.assets.listProjectAssets(
			{ type: "USER", userId: ctx.user.id },
			projectId,
			query,
		);
	}

	@Query({
		input: projectAssetInput,
		output: assetDetailSchema,
		meta: assetRestMeta("GET", "/v1/projects/{projectId}/assets/{assetId}"),
	})
	getAsset(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof projectAssetInput>,
	) {
		return this.assets.getAsset(
			{ type: "USER", userId: ctx.user.id },
			input.projectId,
			input.assetId,
		);
	}

	@Query({
		input: projectAssetInput,
		output: assetDownloadSchema,
		meta: assetRestMeta(
			"GET",
			"/v1/projects/{projectId}/assets/{assetId}/download",
		),
	})
	downloadAsset(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof projectAssetInput>,
	) {
		return this.assets.downloadAsset(
			{ type: "USER", userId: ctx.user.id },
			input.projectId,
			input.assetId,
		);
	}

	@Mutation({
		input: projectAssetInput,
		output: assetDeletionSchema,
		meta: assetRestMeta("DELETE", "/v1/projects/{projectId}/assets/{assetId}"),
	})
	deleteAsset(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof projectAssetInput>,
	) {
		return this.assets.deleteAsset(
			{ type: "USER", userId: ctx.user.id },
			input.projectId,
			input.assetId,
			idempotencyKey(ctx),
		);
	}
}

function idempotencyKey(ctx: AuthedTrpcContext): string {
	const key = ctx.req?.header("Idempotency-Key");
	if (!key || !/^[\x20-\x7e]{1,128}$/.test(key)) {
		throw new AssetError(
			400,
			"VALIDATION_ERROR",
			"A valid Idempotency-Key header is required.",
		);
	}
	return key;
}
