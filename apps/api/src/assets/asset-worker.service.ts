import { randomUUID } from "node:crypto";
import type {
	AssetStorageJobModel as AssetStorageJob,
	Db,
	Prisma,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { ASSETS } from "./asset-config";
import { enqueueAssetObjectDeletion } from "./asset-purge";
import { AssetStorageService } from "./asset-storage.service";

type Tx = Prisma.TransactionClient;
class LeaseLost extends Error {}
class VerificationFailed extends Error {}
class FinalizationExpired extends Error {}

@Injectable()
export class AssetWorkerService {
	private readonly logger = new Logger(AssetWorkerService.name);
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly storage: AssetStorageService,
	) {}

	private async assertLease(tx: Tx, job: AssetStorageJob) {
		const rows = await tx.$queryRaw<
			Array<{ id: string }>
		>`SELECT "id" FROM "assetStorageJob" WHERE "id" = ${job.id} AND "leaseToken" = ${job.leaseToken} AND "leaseUntil" > (NOW() AT TIME ZONE 'UTC') AND "state" = 'RUNNING' FOR UPDATE`;
		if (!rows.length) throw new LeaseLost();
	}

	private async owned<T>(job: AssetStorageJob, action: (tx: Tx) => Promise<T>) {
		return this.db.$transaction(async (tx) => {
			await tx.$queryRaw`SELECT "id" FROM "deal" WHERE "id" = ${job.projectId} FOR UPDATE`;
			await this.assertLease(tx, job);
			return action(tx);
		});
	}

	private async complete(tx: Tx, job: AssetStorageJob) {
		await tx.assetStorageJob.update({
			where: { id: job.id },
			data: {
				state: "COMPLETE",
				leaseUntil: null,
				leaseToken: null,
				lastError: null,
				nextAttemptAt: new Date(Date.now() + ASSETS.worker.retryMaxMs),
			},
		});
	}

	private async sweep(signal: AbortSignal) {
		if (signal.aborted) return;
		const expired = await this.db.assetUpload.findMany({
			where: { status: "PENDING", expiresAt: { lte: new Date() } },
			take: ASSETS.worker.batchSize,
			select: { id: true, projectId: true },
		});
		for (const candidate of expired) {
			if (signal.aborted) break;
			await this.db.$transaction(async (tx) => {
				await tx.$queryRaw`SELECT "id" FROM "deal" WHERE "id" = ${candidate.projectId} FOR UPDATE`;
				const upload = await tx.assetUpload.findUnique({
					where: { id: candidate.id },
				});
				if (upload?.status !== "PENDING" || upload.expiresAt > new Date())
					return;
				await tx.assetUpload.update({
					where: { id: upload.id },
					data: { status: "EXPIRED", completedAt: new Date() },
				});
				await enqueueAssetObjectDeletion(tx, {
					projectId: upload.projectId,
					bucket: upload.bucket,
					objectKey: upload.temporaryKey,
					uploadId: upload.id,
					temporary: true,
				});
			});
		}
		if (signal.aborted) return;
		await this.db
			.$executeRaw`DELETE FROM "assetApiRequest" WHERE "id" IN (SELECT "id" FROM "assetApiRequest" WHERE "expiresAt" <= (NOW() AT TIME ZONE 'UTC') LIMIT ${ASSETS.worker.batchSize})`;
	}

	private async claim() {
		const leaseToken = randomUUID();
		return this.db.$transaction(async (tx) => {
			const rows = await tx.$queryRaw<
				Array<{ id: string }>
			>`SELECT "id" FROM "assetStorageJob" WHERE ("state" = 'PENDING' AND "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC')) OR ("state" = 'RUNNING' AND "leaseUntil" <= (NOW() AT TIME ZONE 'UTC')) OR ("state" = 'COMPLETE' AND "operation" = 'DELETE_OBJECT' AND "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC')) ORDER BY "nextAttemptAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1`;
			if (!rows[0]) return null;
			return tx.assetStorageJob.update({
				where: { id: rows[0].id },
				data: {
					state: "RUNNING",
					leaseToken,
					leaseUntil: new Date(Date.now() + ASSETS.worker.leaseMs),
				},
			});
		});
	}

	async process(externalSignal?: AbortSignal) {
		const deadline = Date.now() + ASSETS.worker.deadlineMs;
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			ASSETS.worker.deadlineMs,
		);
		const signal = externalSignal
			? AbortSignal.any([controller.signal, externalSignal])
			: controller.signal;
		try {
			await this.sweep(signal);
			if (!this.storage.configured()) return { processed: 0 };
			let processed = 0;
			while (
				processed < ASSETS.worker.batchSize &&
				Date.now() < deadline &&
				!signal.aborted
			) {
				const job = await this.claim();
				if (!job) break;
				let heartbeatPending = false;
				const heartbeat = setInterval(() => {
					if (heartbeatPending) return;
					heartbeatPending = true;
					void this.db.assetStorageJob
						.updateMany({
							where: {
								id: job.id,
								state: "RUNNING",
								leaseToken: job.leaseToken,
								leaseUntil: { gt: new Date() },
							},
							data: {
								leaseUntil: new Date(Date.now() + ASSETS.worker.leaseMs),
							},
						})
						.catch(() => {})
						.finally(() => {
							heartbeatPending = false;
						});
				}, ASSETS.worker.heartbeatMs);
				try {
					if (job.operation === "FINALIZE_UPLOAD")
						await this.finalize(job, signal);
					else await this.remove(job, signal);
				} catch (error) {
					if (!(error instanceof LeaseLost))
						await this.retry(
							job,
							error instanceof VerificationFailed,
							signal.aborted,
						);
				} finally {
					clearInterval(heartbeat);
				}
				processed++;
			}
			return { processed };
		} finally {
			clearTimeout(timer);
		}
	}

	private async abandon(tx: Tx, job: AssetStorageJob) {
		if (job.finalKey) {
			const deletion = await enqueueAssetObjectDeletion(tx, {
				projectId: job.projectId,
				bucket: job.bucket,
				objectKey: job.finalKey,
				uploadId: job.uploadId ?? undefined,
			});
			if (deletion.state === "COMPLETE")
				await tx.assetStorageJob.update({
					where: { id: deletion.id },
					data: { state: "PENDING", nextAttemptAt: new Date() },
				});
		}
		await this.complete(tx, job);
	}

	private async finalize(job: AssetStorageJob, signal: AbortSignal) {
		signal.throwIfAborted();
		const upload = await this.owned(job, async (tx) => {
			const upload = job.uploadId
				? await tx.assetUpload.findUnique({ where: { id: job.uploadId } })
				: null;
			const project = await tx.deal.findUnique({
				where: { id: job.projectId },
				select: { id: true },
			});
			if (upload?.status === "READY") {
				await this.complete(tx, job);
				return null;
			}
			if (!upload || !project || upload.status !== "FINALIZING") {
				await this.abandon(tx, job);
				return null;
			}
			return upload;
		});
		if (!upload) return;
		if (
			!upload.confirmedAt ||
			Date.now() - upload.confirmedAt.getTime() >=
				ASSETS.worker.finalizeDeadlineMs
		)
			throw new FinalizationExpired();
		let sourceEtag = upload.sourceEtag;
		if (!sourceEtag) {
			const source = await this.storage.head(
				upload.bucket,
				upload.temporaryKey,
				signal,
			);
			if (!source || source.sizeBytes !== Number(upload.sizeBytes))
				throw new VerificationFailed();
			sourceEtag = source.etag;
			await this.owned(job, async (tx) => {
				const current = await tx.assetUpload.findUnique({
					where: { id: upload.id },
				});
				if (current?.status !== "FINALIZING") throw new LeaseLost();
				await tx.assetUpload.update({
					where: { id: upload.id },
					data: { sourceEtag },
				});
			});
		}
		let final = await this.storage.head(upload.bucket, upload.finalKey, signal);
		if (!final) {
			await this.owned(job, async (tx) => {
				const current = await tx.assetUpload.findUnique({
					where: { id: upload.id },
				});
				if (current?.status !== "FINALIZING") throw new LeaseLost();
			});
			await this.storage.copy(
				upload.bucket,
				upload.temporaryKey,
				upload.finalKey,
				sourceEtag,
				signal,
			);
			final = await this.storage.head(upload.bucket, upload.finalKey, signal);
		}
		if (
			!final ||
			final.sizeBytes !== Number(upload.sizeBytes) ||
			final.etag !== sourceEtag
		)
			throw new VerificationFailed();
		await this.owned(job, async (tx) => {
			const current = await tx.assetUpload.findUnique({
				where: { id: upload.id },
			});
			const project = await tx.deal.findUnique({
				where: { id: upload.projectId },
				select: { id: true },
			});
			if (!project || !current || current.status !== "FINALIZING") {
				await this.abandon(tx, job);
				return;
			}
			const asset = await tx.artifact.create({
				data: {
					dealId: upload.projectId,
					type: upload.kind,
					fileName: upload.fileName,
					storageBucket: upload.bucket,
					storageKey: upload.finalKey,
					kind: upload.kind,
					contentType: upload.contentType,
					sizeBytes: upload.sizeBytes,
					source: upload.source,
					activityId: upload.activityId,
					uploadedById: upload.uploadedById,
					durationMilliseconds: upload.durationMilliseconds,
					capturedAt: upload.capturedAt,
					emailMessageId: upload.emailMessageId,
					emailAttachmentId: upload.emailAttachmentId,
					status: "READY",
				},
			});
			await tx.assetUpload.update({
				where: { id: upload.id },
				data: { status: "READY", assetId: asset.id, completedAt: new Date() },
			});
			await tx.assetEmailSource.updateMany({
				where: { uploadId: upload.id },
				data: { assetId: asset.id },
			});
			await enqueueAssetObjectDeletion(tx, {
				projectId: upload.projectId,
				bucket: upload.bucket,
				objectKey: upload.temporaryKey,
				uploadId: upload.id,
				temporary: true,
			});
			await this.complete(tx, job);
		});
	}

	private async remove(job: AssetStorageJob, signal: AbortSignal) {
		signal.throwIfAborted();
		if (!job.bucket)
			throw new Error("Storage location requires operator resolution.");
		await this.storage.delete(job.bucket, job.objectKey, signal);
		if (await this.storage.head(job.bucket, job.objectKey, signal))
			throw new Error("Object deletion remains incomplete.");
		await this.owned(job, async (tx) => {
			if (job.temporary && job.uploadId) {
				const upload = await tx.assetUpload.findUnique({
					where: { id: job.uploadId },
				});
				if (upload && upload.reservationUntil > new Date()) {
					await tx.assetStorageJob.update({
						where: { id: job.id },
						data: {
							state: "PENDING",
							nextAttemptAt: new Date(
								Math.min(
									Date.now() + ASSETS.worker.retryMaxMs,
									upload.reservationUntil.getTime(),
								),
							),
							leaseUntil: null,
							leaseToken: null,
							lastError: null,
						},
					});
					return;
				}
				await tx.assetUpload.updateMany({
					where: { id: job.uploadId, reservationReleasedAt: null },
					data: { reservationReleasedAt: new Date() },
				});
			}
			if (job.artifactId)
				await tx.artifact.updateMany({
					where: { id: job.artifactId, status: "DELETING" },
					data: { status: "DELETED", deletedAt: new Date() },
				});
			await this.complete(tx, job);
		});
	}

	private async retry(
		job: AssetStorageJob,
		verification: boolean,
		interrupted = false,
	) {
		try {
			await this.owned(job, async (tx) => {
				const current = await tx.assetStorageJob.findUniqueOrThrow({
					where: { id: job.id },
				});
				const attempts = current.attempts + (interrupted ? 0 : 1);
				const upload = job.uploadId
					? await tx.assetUpload.findUnique({ where: { id: job.uploadId } })
					: null;
				const terminal =
					job.operation === "FINALIZE_UPLOAD" &&
					(verification ||
						attempts >= ASSETS.worker.maxFinalizeAttempts ||
						!upload?.confirmedAt ||
						Date.now() - upload.confirmedAt.getTime() >=
							ASSETS.worker.finalizeDeadlineMs);
				const message = interrupted
					? "Invocation deadline reached. A retry is scheduled."
					: verification
						? "Stored bytes do not match the upload intent."
						: job.bucket
							? "Storage operation failed. A retry is scheduled."
							: "Storage location requires operator resolution.";
				if (terminal) {
					if (upload?.status === "FINALIZING")
						await tx.assetUpload.update({
							where: { id: upload.id },
							data: {
								status: "FAILED",
								failureCode: verification
									? "UPLOAD_VERIFICATION_FAILED"
									: "UPLOAD_FINALIZATION_FAILED",
								failureMessage: verification
									? message
									: "File finalization failed.",
								completedAt: new Date(),
							},
						});
					if (upload) {
						await enqueueAssetObjectDeletion(tx, {
							projectId: upload.projectId,
							bucket: upload.bucket,
							objectKey: upload.temporaryKey,
							uploadId: upload.id,
							temporary: true,
						});
						await enqueueAssetObjectDeletion(tx, {
							projectId: upload.projectId,
							bucket: upload.bucket,
							objectKey: upload.finalKey,
							uploadId: upload.id,
						});
					}
				}
				await tx.assetStorageJob.update({
					where: { id: job.id },
					data: {
						state: terminal ? "COMPLETE" : "PENDING",
						attempts,
						lastError: message,
						leaseUntil: null,
						leaseToken: null,
						nextAttemptAt: new Date(
							Date.now() +
								Math.min(
									ASSETS.worker.retryMaxMs,
									ASSETS.worker.retryBaseMs *
										2 ** Math.max(0, Math.min(attempts - 1, 30)),
								),
						),
					},
				});
				this.logger.warn({
					message,
					jobId: job.id,
					operation: job.operation,
					attempts,
				});
			});
		} catch (error) {
			if (!(error instanceof LeaseLost)) throw error;
		}
	}
}
