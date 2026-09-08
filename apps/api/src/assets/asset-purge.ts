import type { Prisma } from "@crm/db";

export async function enqueueAssetObjectDeletion(
	tx: Prisma.TransactionClient,
	input: {
		projectId: string;
		bucket: string | null;
		objectKey: string;
		uploadId?: string;
		artifactId?: string;
		temporary?: boolean;
	},
) {
	const operationKey = input.temporary
		? `temporary:${input.uploadId}`
		: input.artifactId
			? `artifact:${input.artifactId}`
			: `orphan:${input.uploadId}`;
	return tx.assetStorageJob.upsert({
		where: { operationKey },
		create: {
			...input,
			operationKey,
			operation: "DELETE_OBJECT",
			nextAttemptAt: new Date(),
		},
		update: {},
	});
}

export async function enqueueProjectAssetPurge(
	tx: Prisma.TransactionClient,
	projectId: string,
) {
	await tx.$queryRaw`SELECT "id" FROM "deal" WHERE "id" = ${projectId} FOR UPDATE`;
	const artifacts = await tx.artifact.findMany({
		where: { dealId: projectId },
	});
	const uploads = await tx.assetUpload.findMany({ where: { projectId } });
	for (const asset of artifacts) {
		await enqueueAssetObjectDeletion(tx, {
			projectId,
			bucket: asset.storageBucket,
			objectKey: asset.storageKey,
			artifactId: asset.id,
		});
	}
	for (const upload of uploads) {
		await enqueueAssetObjectDeletion(tx, {
			projectId,
			bucket: upload.bucket,
			objectKey: upload.temporaryKey,
			uploadId: upload.id,
			temporary: true,
		});
		if (!upload.assetId) {
			await enqueueAssetObjectDeletion(tx, {
				projectId,
				bucket: upload.bucket,
				objectKey: upload.finalKey,
				uploadId: upload.id,
			});
		}
	}
	await tx.assetUpload.updateMany({
		where: { projectId, status: { in: ["PENDING", "FINALIZING"] } },
		data: { status: "CANCELED", completedAt: new Date() },
	});
	await tx.assetEmailSource.updateMany({
		where: { projectId, deletedAt: null },
		data: { deletedAt: new Date() },
	});
}
