import { createHash, randomUUID } from "node:crypto";
import type {
	ArtifactModel as Artifact,
	AssetUploadModel as AssetUpload,
	Db,
	Prisma,
} from "@crm/db";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import { ASSETS } from "./asset-config";
import { AssetError } from "./asset-error";
import { enqueueAssetObjectDeletion } from "./asset-purge";
import { AssetStorageService } from "./asset-storage.service";
import {
	type AssetListInput,
	assetDeletionSchema,
	assetDownloadSchema,
	assetListInput,
	type CreateUploadInput,
	createUploadInput,
	customerAssetListInput,
	uploadCancellationSchema,
	uploadConfirmationSchema,
	uploadGrantSchema,
} from "./assets.contracts";

export type AssetActor =
	| { type: "USER"; userId: string }
	| { type: "SYSTEM"; mailboxOwnerId: string; messageId: string };
type Tx = Prisma.TransactionClient;

export function assetActorKey(actor: AssetActor) {
	return actor.type === "USER"
		? `user:${actor.userId}`
		: `mailbox:${actor.mailboxOwnerId}`;
}

function hash(value: Prisma.InputJsonValue) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function missing(): never {
	throw new AssetError(
		404,
		"RESOURCE_NOT_FOUND",
		"The record does not exist or is inaccessible.",
	);
}

export function uploadResponse(upload: AssetUpload) {
	return {
		id: upload.id,
		customerId: upload.customerId,
		projectId: upload.projectId,
		status: upload.status,
		expiresAt: upload.expiresAt.toISOString(),
		assetId: upload.assetId,
		failure: upload.failureCode
			? {
					code: upload.failureCode,
					message: upload.failureMessage ?? "File finalization failed.",
				}
			: null,
	};
}

function assetResponse(asset: Artifact & { deal: { companyId: string } }) {
	return {
		id: asset.id,
		customerId: asset.deal.companyId,
		projectId: asset.dealId,
		activityId: asset.activityId,
		fileName: asset.fileName,
		contentType: asset.contentType,
		sizeBytes: asset.sizeBytes === null ? null : Number(asset.sizeBytes),
		kind: asset.kind,
		source: asset.source,
		emailSource:
			asset.emailMessageId && asset.emailAttachmentId
				? {
						messageId: asset.emailMessageId,
						attachmentId: asset.emailAttachmentId,
					}
				: null,
		uploadedById: asset.uploadedById,
		durationMilliseconds:
			asset.durationMilliseconds === null
				? null
				: Number(asset.durationMilliseconds),
		capturedAt: asset.capturedAt?.toISOString() ?? null,
		createdAt: asset.createdAt.toISOString(),
		status: asset.status,
		deletedAt: asset.deletedAt?.toISOString() ?? null,
	};
}

@Injectable()
export class AssetsService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly storage: AssetStorageService,
	) {}

	private storageAvailable() {
		if (!this.storage.configured())
			throw new AssetError(
				503,
				"STORAGE_UNAVAILABLE",
				"File storage is not configured.",
			);
	}

	private async project(
		tx: Tx,
		actor: AssetActor,
		projectId: string,
		lock = false,
	) {
		if (lock)
			await tx.$queryRaw`SELECT "id" FROM "deal" WHERE "id" = ${projectId} FOR UPDATE`;
		const project = await tx.deal.findUnique({ where: { id: projectId } });
		if (!project) missing();
		if (actor.type === "USER") {
			if (
				!(await tx.user.findUnique({
					where: { id: actor.userId },
					select: { id: true },
				}))
			)
				missing();
		} else {
			const message = await tx.emailMessage.findUnique({
				where: { id: actor.messageId },
				include: { thread: true },
			});
			if (!message || message.syncedByUserId !== actor.mailboxOwnerId)
				missing();
			const mailboxSources: string[] = [];
			if (message.gmailMessageId) mailboxSources.push("gmail");
			if (message.outlookMessageId) mailboxSources.push("outlook");
			if (
				!(await tx.mailboxSync.findFirst({
					where: {
						userId: actor.mailboxOwnerId,
						source: { in: mailboxSources },
					},
					select: { id: true },
				}))
			)
				missing();
			if (
				message.thread.companyId !== null &&
				message.thread.companyId !== project.companyId
			) {
				throw new AssetError(
					409,
					"PROJECT_MISMATCH",
					"The email belongs to another customer.",
				);
			}
		}
		return project;
	}

	private active(project: { archivedAt: Date | null }) {
		if (project.archivedAt)
			throw new AssetError(
				409,
				"PROJECT_ARCHIVED",
				"Restore the project before uploading files.",
			);
	}

	private async mutate<T>(
		actor: AssetActor,
		projectId: string,
		operation: string,
		path: string,
		key: string,
		input: Prisma.InputJsonValue,
		schema: z.ZodType<T>,
		action: (
			tx: Tx,
			project: Awaited<ReturnType<AssetsService["project"]>>,
		) => Promise<T>,
		target?: {
			uploadId?: string;
			assetId?: string;
			activityId?: string | null;
			emailMessageId?: string;
		},
	) {
		if (!/^[\x20-\x7e]{1,128}$/.test(key ?? ""))
			throw new AssetError(
				400,
				"VALIDATION_ERROR",
				"A valid Idempotency-Key is required.",
			);
		const actorKey = assetActorKey(actor);
		const requestHash = hash(input);
		return this.db.$transaction(
			async (tx) => {
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actorKey}, 0))`;
				const project = await this.project(tx, actor, projectId, true);
				if (target?.uploadId)
					await this.upload(tx, projectId, target.uploadId, actor);
				if (target?.assetId)
					await this.asset(tx, projectId, target.assetId, actor);
				if (
					target?.activityId &&
					!(await tx.activity.findUnique({
						where: { id: target.activityId },
						select: { id: true },
					}))
				)
					missing();
				if (
					target?.emailMessageId &&
					!(await tx.emailMessage.findUnique({
						where: { id: target.emailMessageId },
						select: { id: true },
					}))
				)
					missing();
				const identity = { actorKey, operation, path, idempotencyKey: key };
				const prior = await tx.assetApiRequest.findUnique({
					where: { actorKey_operation_path_idempotencyKey: identity },
				});
				if (prior && prior.expiresAt > new Date()) {
					if (prior.requestHash !== requestHash)
						throw new AssetError(
							409,
							"IDEMPOTENCY_CONFLICT",
							"The idempotency key has different request data.",
						);
					return schema.parse(prior.responseBody);
				}
				const response = schema.parse(await action(tx, project));
				const data = {
					requestHash,
					responseStatus: 200,
					responseBody: JSON.parse(
						JSON.stringify(response),
					) as Prisma.InputJsonValue,
					expiresAt: new Date(Date.now() + ASSETS.replayMs),
				};
				await tx.assetApiRequest.upsert({
					where: { actorKey_operation_path_idempotencyKey: identity },
					create: { ...identity, ...data },
					update: data,
				});
				return response;
			},
			{ timeout: ASSETS.worker.leaseMs },
		);
	}

	private async upload(
		tx: Tx,
		projectId: string,
		uploadId: string,
		actor: AssetActor,
	) {
		const upload = await tx.assetUpload.findFirst({
			where: { id: uploadId, projectId },
		});
		if (!upload) missing();
		if (
			actor.type === "SYSTEM" &&
			(upload.emailMessageId !== actor.messageId ||
				upload.mailboxOwnerId !== actor.mailboxOwnerId)
		)
			missing();
		return upload;
	}

	private async asset(
		tx: Tx,
		projectId: string,
		assetId: string,
		actor: AssetActor,
	) {
		const asset = await tx.artifact.findFirst({
			where: { id: assetId, dealId: projectId },
			include: { deal: { select: { companyId: true } } },
		});
		if (!asset) missing();
		if (actor.type === "SYSTEM" && asset.emailMessageId !== actor.messageId)
			missing();
		return asset;
	}

	private state(upload: AssetUpload, allowed: string[]) {
		const state =
			upload.status === "PENDING" && upload.expiresAt <= new Date()
				? "EXPIRED"
				: upload.status;
		if (!allowed.includes(state))
			throw new AssetError(
				409,
				"UPLOAD_STATE_CONFLICT",
				"The upload does not permit this action.",
				{ state },
			);
	}

	private async grant(upload: AssetUpload) {
		if (upload.status !== "PENDING")
			return uploadGrantSchema.parse({
				upload: uploadResponse(upload),
				transfer: null,
			});
		this.storageAvailable();
		let url: string;
		try {
			url = await this.storage.presignPut(
				upload.bucket,
				upload.temporaryKey,
				upload.contentType,
				Number(upload.sizeBytes),
				upload.grantExpiresAt,
			);
		} catch (error) {
			if (error instanceof AssetError) throw error;
			throw new AssetError(
				503,
				"STORAGE_UNAVAILABLE",
				"File storage is temporarily unavailable.",
				undefined,
				true,
			);
		}
		return uploadGrantSchema.parse({
			upload: uploadResponse(upload),
			transfer: {
				method: "PUT",
				url,
				headers: {
					"Content-Type": upload.contentType,
					"Content-Length": upload.sizeBytes.toString(),
				},
				expiresAt: upload.grantExpiresAt.toISOString(),
				maxBytes: ASSETS.maxSingleUploadBytes,
			},
		});
	}

	private async validateActivity(
		tx: Tx,
		projectId: string,
		activityId?: string | null,
	) {
		if (!activityId) return;
		const activity = await tx.activity.findUnique({
			where: { id: activityId },
		});
		if (!activity) missing();
		if (activity.type !== "MEETING" || activity.dealId !== projectId)
			throw new AssetError(
				409,
				"PROJECT_MISMATCH",
				"The meeting belongs to another project.",
			);
	}

	async createUpload(
		actor: AssetActor,
		projectId: string,
		raw: CreateUploadInput,
		key: string,
	) {
		const parsed = createUploadInput.safeParse(raw);
		if (!parsed.success)
			throw new AssetError(
				400,
				"VALIDATION_ERROR",
				"Upload metadata is invalid.",
			);
		const input = parsed.data;
		if (
			actor.type === "SYSTEM" &&
			(input.source !== "EMAIL_ATTACHMENT" ||
				input.emailSource?.messageId !== actor.messageId)
		)
			missing();
		const metadata = {
			fileName: input.fileName,
			contentType: input.contentType,
			sizeBytes: input.sizeBytes,
			kind: input.kind,
			source: input.source,
			activityId: input.activityId ?? null,
			durationMilliseconds: input.durationMilliseconds ?? null,
			capturedAt: input.capturedAt
				? new Date(input.capturedAt).toISOString()
				: null,
			emailSource: input.emailSource ?? null,
		};
		return this.mutate(
			actor,
			projectId,
			"CREATE_UPLOAD",
			`/projects/${projectId}/asset-uploads`,
			key,
			metadata,
			uploadGrantSchema,
			async (tx, project) => {
				this.active(project);
				if (input.sizeBytes > ASSETS.maxSingleUploadBytes)
					throw new AssetError(
						413,
						"UPLOAD_TOO_LARGE",
						"The file exceeds the single-upload limit.",
						{ maxBytes: ASSETS.maxSingleUploadBytes },
					);
				await this.validateActivity(tx, projectId, input.activityId);
				const metadataHash = hash(metadata);
				let mailboxOwnerId: string | null = null;
				if (input.emailSource) {
					const message = await tx.emailMessage.findUnique({
						where: { id: input.emailSource.messageId },
						include: { thread: true },
					});
					if (!message) missing();
					if (
						message.thread.companyId &&
						message.thread.companyId !== project.companyId
					)
						throw new AssetError(
							409,
							"PROJECT_MISMATCH",
							"The email belongs to another customer.",
						);
					mailboxOwnerId = message.syncedByUserId;
					await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`source:${input.emailSource.messageId}:${input.emailSource.attachmentId}`}, 0))`;
					const source = await tx.assetEmailSource.findUnique({
						where: { messageId_attachmentId: input.emailSource },
					});
					if (source) {
						if (source.projectId !== projectId)
							throw new AssetError(
								409,
								"PROJECT_MISMATCH",
								"The attachment belongs to another project.",
							);
						if (source.deletedAt)
							throw new AssetError(
								409,
								"SOURCE_DELETED",
								"The source attachment was deleted.",
							);
						if (source.metadataHash !== metadataHash)
							throw new AssetError(
								409,
								"SOURCE_CONFLICT",
								"The source attachment has different metadata.",
							);
						const existing = await tx.assetUpload.findUnique({
							where: { id: source.uploadId },
						});
						if (
							existing &&
							["PENDING", "FINALIZING", "READY"].includes(existing.status) &&
							!(
								existing.status === "PENDING" &&
								existing.expiresAt <= new Date()
							)
						)
							return existing.status === "PENDING"
								? this.renewGrant(tx, existing)
								: this.grant(existing);
						if (existing?.status === "PENDING") {
							await tx.assetUpload.update({
								where: { id: existing.id },
								data: { status: "EXPIRED", completedAt: new Date() },
							});
							await enqueueAssetObjectDeletion(tx, {
								projectId,
								bucket: existing.bucket,
								objectKey: existing.temporaryKey,
								uploadId: existing.id,
								temporary: true,
							});
						}
					}
				}
				this.storageAvailable();
				const actorKey = assetActorKey(actor);
				const count = await tx.assetUpload.count({
					where: { actorKey, reservationReleasedAt: null },
				});
				if (count >= ASSETS.reservationLimit)
					throw new AssetError(
						429,
						"UPLOAD_CAPACITY_EXCEEDED",
						"Temporary upload capacity is full.",
						undefined,
						true,
					);
				const id = randomUUID();
				const expiresAt = new Date(Date.now() + ASSETS.intentMs);
				const grantExpiresAt = new Date(
					Math.min(Date.now() + ASSETS.uploadUrlMs, expiresAt.getTime()),
				);
				const upload = await tx.assetUpload.create({
					data: {
						id,
						projectId,
						customerId: project.companyId,
						actorKey,
						uploadedById: actor.type === "USER" ? actor.userId : null,
						mailboxOwnerId,
						fileName: input.fileName,
						contentType: input.contentType,
						sizeBytes: BigInt(input.sizeBytes),
						kind: input.kind,
						source: input.source,
						activityId: input.activityId,
						durationMilliseconds:
							input.durationMilliseconds == null
								? null
								: BigInt(input.durationMilliseconds),
						capturedAt: input.capturedAt ? new Date(input.capturedAt) : null,
						emailMessageId: input.emailSource?.messageId,
						emailAttachmentId: input.emailSource?.attachmentId,
						metadataHash,
						bucket: this.storage.bucket(),
						temporaryKey: `temporary/${id}`,
						finalKey: `assets/${randomUUID()}`,
						expiresAt,
						grantExpiresAt,
						reservationUntil: new Date(
							grantExpiresAt.getTime() + ASSETS.temporaryRetentionMs,
						),
					},
				});
				if (input.emailSource)
					await tx.assetEmailSource.upsert({
						where: { messageId_attachmentId: input.emailSource },
						create: {
							...input.emailSource,
							projectId,
							uploadId: id,
							metadataHash,
							mailboxOwnerId,
						},
						update: { uploadId: id },
					});
				return this.grant(upload);
			},
			{
				activityId: input.activityId,
				emailMessageId: input.emailSource?.messageId,
			},
		);
	}

	private async renewGrant(tx: Tx, upload: AssetUpload) {
		const grantExpiresAt = new Date(
			Math.min(Date.now() + ASSETS.uploadUrlMs, upload.expiresAt.getTime()),
		);
		return this.grant(
			await tx.assetUpload.update({
				where: { id: upload.id },
				data: {
					grantExpiresAt,
					reservationUntil: new Date(
						grantExpiresAt.getTime() + ASSETS.temporaryRetentionMs,
					),
				},
			}),
		);
	}

	async getUpload(actor: AssetActor, projectId: string, uploadId: string) {
		return this.db.$transaction(async (tx) => {
			await this.project(tx, actor, projectId, true);
			let upload = await this.upload(tx, projectId, uploadId, actor);
			if (upload.status === "PENDING" && upload.expiresAt <= new Date()) {
				upload = await tx.assetUpload.update({
					where: { id: uploadId },
					data: { status: "EXPIRED", completedAt: new Date() },
				});
				await enqueueAssetObjectDeletion(tx, {
					projectId,
					bucket: upload.bucket,
					objectKey: upload.temporaryKey,
					uploadId,
					temporary: true,
				});
			}
			return {
				upload: uploadResponse(upload),
				pollAfterSeconds: upload.status === "FINALIZING" ? 3 : null,
			};
		});
	}

	async renewUpload(
		actor: AssetActor,
		projectId: string,
		uploadId: string,
		key: string,
	) {
		return this.mutate(
			actor,
			projectId,
			"RENEW_UPLOAD",
			`/projects/${projectId}/asset-uploads/${uploadId}/url`,
			key,
			{},
			uploadGrantSchema,
			async (tx, project) => {
				this.active(project);
				const upload = await this.upload(tx, projectId, uploadId, actor);
				this.state(upload, ["PENDING"]);
				return this.renewGrant(tx, upload);
			},
			{ uploadId },
		);
	}

	async confirmUpload(
		actor: AssetActor,
		projectId: string,
		uploadId: string,
		key: string,
	) {
		return this.mutate(
			actor,
			projectId,
			"CONFIRM_UPLOAD",
			`/projects/${projectId}/asset-uploads/${uploadId}/confirm`,
			key,
			{},
			uploadConfirmationSchema,
			async (tx, project) => {
				this.active(project);
				const upload = await this.upload(tx, projectId, uploadId, actor);
				this.state(upload, ["PENDING", "FINALIZING", "READY"]);
				if (upload.status === "PENDING") {
					this.storageAvailable();
					await tx.assetUpload.update({
						where: { id: uploadId },
						data: { status: "FINALIZING", confirmedAt: new Date() },
					});
					await tx.assetStorageJob.create({
						data: {
							operationKey: `finalize:${uploadId}`,
							operation: "FINALIZE_UPLOAD",
							nextAttemptAt: new Date(),
							projectId,
							uploadId,
							bucket: upload.bucket,
							objectKey: upload.temporaryKey,
							finalKey: upload.finalKey,
						},
					});
				}
				return {
					uploadId,
					statusUrl: `/rest/v1/projects/${encodeURIComponent(projectId)}/asset-uploads/${encodeURIComponent(uploadId)}`,
				};
			},
			{ uploadId },
		);
	}

	async cancelUpload(
		actor: AssetActor,
		projectId: string,
		uploadId: string,
		key: string,
	) {
		return this.mutate(
			actor,
			projectId,
			"CANCEL_UPLOAD",
			`/projects/${projectId}/asset-uploads/${uploadId}`,
			key,
			{},
			uploadCancellationSchema,
			async (tx) => {
				const upload = await this.upload(tx, projectId, uploadId, actor);
				this.state(upload, ["PENDING", "FAILED", "CANCELED"]);
				if (upload.status !== "CANCELED")
					await tx.assetUpload.update({
						where: { id: uploadId },
						data: { status: "CANCELED", completedAt: new Date() },
					});
				await enqueueAssetObjectDeletion(tx, {
					projectId,
					bucket: upload.bucket,
					objectKey: upload.temporaryKey,
					uploadId,
					temporary: true,
				});
				return { uploadId, status: "CANCELED" };
			},
			{ uploadId },
		);
	}

	async listCustomerAssets(
		actor: AssetActor,
		customerId: string,
		raw: AssetListInput,
	) {
		const input = customerAssetListInput.parse(raw);
		return this.db.$transaction(async (tx) => {
			if (
				!(await tx.company.findUnique({
					where: { id: customerId },
					select: { id: true },
				}))
			)
				missing();
			if (actor.type === "SYSTEM") missing();
			if (
				!(await tx.user.findUnique({
					where: { id: actor.userId },
					select: { id: true },
				}))
			)
				missing();
			if (input.projectId) {
				const project = await this.project(tx, actor, input.projectId);
				if (project.companyId !== customerId)
					throw new AssetError(
						409,
						"PROJECT_MISMATCH",
						"The project belongs to another customer.",
					);
			}
			return this.list(
				tx,
				{ deal: { companyId: customerId }, dealId: input.projectId },
				input,
			);
		});
	}

	async listProjectAssets(
		actor: AssetActor,
		projectId: string,
		raw: AssetListInput,
	) {
		const input = assetListInput.parse(raw);
		return this.db.$transaction(async (tx) => {
			await this.project(tx, actor, projectId);
			return this.list(
				tx,
				{
					dealId: projectId,
					emailMessageId: actor.type === "SYSTEM" ? actor.messageId : undefined,
				},
				input,
			);
		});
	}

	private async list(
		tx: Tx,
		parent: Prisma.ArtifactWhereInput,
		input: AssetListInput,
	) {
		const where: Prisma.ArtifactWhereInput = {
			...parent,
			status: { in: ["READY", "UNVERIFIED"] },
			activityId: input.activityId,
			kind: input.kind,
			source: input.source,
		};
		const total = await tx.artifact.count({ where });
		const offset = (input.page - 1) * input.pageSize;
		if (offset >= total)
			return {
				items: [],
				page: input.page,
				pageSize: input.pageSize,
				total,
				hasNextPage: false,
			};
		const items = await tx.artifact.findMany({
			where,
			include: { deal: { select: { companyId: true } } },
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			skip: offset,
			take: input.pageSize,
		});
		return {
			items: items.map(assetResponse),
			page: input.page,
			pageSize: input.pageSize,
			total,
			hasNextPage: input.page * input.pageSize < total,
		};
	}

	async getAsset(actor: AssetActor, projectId: string, assetId: string) {
		return this.db.$transaction(async (tx) => {
			await this.project(tx, actor, projectId);
			return {
				asset: assetResponse(await this.asset(tx, projectId, assetId, actor)),
			};
		});
	}

	async downloadAsset(actor: AssetActor, projectId: string, assetId: string) {
		return this.db.$transaction(async (tx) => {
			await this.project(tx, actor, projectId, true);
			const asset = await this.asset(tx, projectId, assetId, actor);
			if (
				asset.status !== "READY" ||
				!asset.storageBucket ||
				asset.sizeBytes === null
			)
				throw new AssetError(
					409,
					"ASSET_NOT_READY",
					"The asset is not available for download.",
					{ state: asset.status },
				);
			this.storageAvailable();
			const expiresAt = new Date(Date.now() + ASSETS.downloadUrlMs);
			let url: string;
			try {
				url = await this.storage.presignGet(
					asset.storageBucket,
					asset.storageKey,
					asset.fileName,
					asset.contentType,
					expiresAt,
				);
			} catch (error) {
				if (error instanceof AssetError) throw error;
				throw new AssetError(
					503,
					"STORAGE_UNAVAILABLE",
					"File storage is temporarily unavailable.",
					undefined,
					true,
				);
			}
			return assetDownloadSchema.parse({
				assetId,
				url,
				method: "GET",
				headers: {},
				expiresAt: expiresAt.toISOString(),
				fileName: asset.fileName,
				contentType: asset.contentType,
				sizeBytes: Number(asset.sizeBytes),
			});
		});
	}

	async deleteAsset(
		actor: AssetActor,
		projectId: string,
		assetId: string,
		key: string,
	) {
		return this.mutate(
			actor,
			projectId,
			"DELETE_ASSET",
			`/projects/${projectId}/assets/${assetId}`,
			key,
			{},
			assetDeletionSchema,
			async (tx) => {
				const asset = await this.asset(tx, projectId, assetId, actor);
				if (asset.status === "DELETED") return { assetId, status: "DELETED" };
				await tx.artifact.update({
					where: { id: assetId },
					data: { status: "DELETING" },
				});
				await tx.assetEmailSource.updateMany({
					where: { assetId },
					data: { deletedAt: new Date() },
				});
				await enqueueAssetObjectDeletion(tx, {
					projectId,
					bucket: asset.storageBucket,
					objectKey: asset.storageKey,
					artifactId: assetId,
				});
				return { assetId, status: "DELETING" };
			},
			{ assetId },
		);
	}
}
