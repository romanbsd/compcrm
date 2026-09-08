import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { ConversionService } from "../src/currency/conversion.service";
import { DealsService } from "../src/deals/deals.service";
import { FieldsService } from "../src/fields/fields.service";
import { withDiscardedCrmEvents } from "./agent-trigger.stub";

const suffix = process.env.TEST_RUN_ID ?? "asset-purge-spec";
const ownerId = `asset-purge-owner-${suffix}`;
const keys = [
	"explicit-deleted",
	"explicit-survivor",
	"automatic-deleted",
	"automatic-survivor",
] as const;
const domains = keys.map((key) => `${key}-${suffix}.test`);

const agent = {
	withCrmEvents: withDiscardedCrmEvents,
} as unknown as AgentTriggerService;

const deals = new DealsService(
	db,
	agent,
	new ActivityStampService(db),
	new ConversionService(db),
	new FieldsService(db, { fieldBackfill: async () => undefined } as never),
);

async function clean() {
	const companies = await db.company.findMany({
		where: { domain: { in: domains } },
		select: { id: true },
	});
	const companyIds = companies.map((company) => company.id);
	const projectIds = keys.map((key) => `asset-purge-project-${key}-${suffix}`);

	await db.assetStorageJob.deleteMany({
		where: { projectId: { in: projectIds } },
	});
	await db.assetEmailSource.deleteMany({
		where: { projectId: { in: projectIds } },
	});
	await db.assetUpload.deleteMany({ where: { projectId: { in: projectIds } } });
	await db.artifact.deleteMany({ where: { dealId: { in: projectIds } } });
	await db.agentTask.deleteMany({ where: { dealId: { in: projectIds } } });
	await db.deal.deleteMany({ where: { id: { in: projectIds } } });
	await db.company.deleteMany({ where: { id: { in: companyIds } } });
	await db.user.deleteMany({ where: { id: ownerId } });
}

async function project(
	key: (typeof keys)[number],
	archivedAt: Date | null = null,
) {
	const company = await db.company.create({
		data: {
			id: `asset-purge-company-${key}-${suffix}`,
			name: `Asset purge ${key} ${suffix}`,
			domain: `${key}-${suffix}.test`,
		},
		select: { id: true },
	});

	return db.deal.create({
		data: {
			id: `asset-purge-project-${key}-${suffix}`,
			name: `Asset purge project ${key} ${suffix}`,
			companyId: company.id,
			ownerId,
			archivedAt,
		},
		select: { id: true, companyId: true },
	});
}

async function assetFixture(projectId: string, companyId: string, key: string) {
	const artifact = await db.artifact.create({
		data: {
			id: `asset-purge-artifact-${key}-${suffix}`,
			dealId: projectId,
			type: "file",
			fileName: `${key}.txt`,
			storageKey: `projects/${projectId}/${key}.txt`,
			storageBucket: "crm-assets",
		},
		select: { id: true, storageKey: true },
	});

	const now = Date.now();
	const upload = await db.assetUpload.create({
		data: {
			id: `asset-purge-upload-${key}-${suffix}`,
			projectId,
			customerId: companyId,
			actorKey: `user:${ownerId}`,
			fileName: `${key}-upload.txt`,
			contentType: "text/plain",
			sizeBytes: 32n,
			kind: "file",
			source: "MANUAL",
			metadataHash: `metadata-${key}-${suffix}`,
			bucket: "crm-assets",
			temporaryKey: `temporary/${projectId}/${key}.txt`,
			finalKey: `projects/${projectId}/${key}-upload.txt`,
			expiresAt: new Date(now + 60 * 60_000),
			grantExpiresAt: new Date(now + 60 * 60_000),
			reservationUntil: new Date(now + 60 * 60_000),
		},
		select: { id: true, temporaryKey: true, finalKey: true },
	});

	return { artifact, upload };
}

beforeAll(async () => {
	await clean();
	await db.user.create({
		data: {
			id: ownerId,
			name: "Asset purge owner",
			email: `${ownerId}@example.test`,
			emailVerified: true,
		},
	});
});

afterAll(clean);

describe("asset storage cleanup during deal purge", () => {
	it("keeps explicit purge jobs and isolates another project", async () => {
		const deleted = await project("explicit-deleted");
		const survivor = await project("explicit-survivor");
		const deletedAssets = await assetFixture(
			deleted.id,
			deleted.companyId,
			"explicit-deleted",
		);
		const survivorAssets = await assetFixture(
			survivor.id,
			survivor.companyId,
			"explicit-survivor",
		);

		await expect(deals.purge(deleted.id)).resolves.toEqual({
			id: deleted.id,
			name: `Asset purge project explicit-deleted ${suffix}`,
		});

		const jobs = await db.assetStorageJob.findMany({
			where: { projectId: deleted.id },
			orderBy: { operationKey: "asc" },
			select: {
				operationKey: true,
				projectId: true,
				uploadId: true,
				artifactId: true,
				bucket: true,
				objectKey: true,
				temporary: true,
			},
		});

		expect(jobs).toEqual([
			{
				operationKey: `artifact:${deletedAssets.artifact.id}`,
				projectId: deleted.id,
				uploadId: null,
				artifactId: deletedAssets.artifact.id,
				bucket: "crm-assets",
				objectKey: deletedAssets.artifact.storageKey,
				temporary: false,
			},
			{
				operationKey: `orphan:${deletedAssets.upload.id}`,
				projectId: deleted.id,
				uploadId: deletedAssets.upload.id,
				artifactId: null,
				bucket: "crm-assets",
				objectKey: deletedAssets.upload.finalKey,
				temporary: false,
			},
			{
				operationKey: `temporary:${deletedAssets.upload.id}`,
				projectId: deleted.id,
				uploadId: deletedAssets.upload.id,
				artifactId: null,
				bucket: "crm-assets",
				objectKey: deletedAssets.upload.temporaryKey,
				temporary: true,
			},
		]);

		expect(await db.deal.findUnique({ where: { id: deleted.id } })).toBeNull();
		expect(
			await db.artifact.findUnique({
				where: { id: deletedAssets.artifact.id },
			}),
		).toBeNull();
		expect(
			await db.assetUpload.findUnique({
				where: { id: deletedAssets.upload.id },
				select: { status: true },
			}),
		).toEqual({ status: "CANCELED" });

		expect(
			await db.deal.findUnique({ where: { id: survivor.id } }),
		).not.toBeNull();
		expect(
			await db.assetStorageJob.count({ where: { projectId: survivor.id } }),
		).toBe(0);
		expect(
			await db.artifact.findUnique({
				where: { id: survivorAssets.artifact.id },
			}),
		).not.toBeNull();
		expect(
			await db.assetUpload.findUnique({
				where: { id: survivorAssets.upload.id },
			}),
		).not.toBeNull();
	});

	it("keeps automatic purge jobs after the deal cascade", async () => {
		const before = new Date("2026-09-01T00:00:00.000Z");
		const deleted = await project(
			"automatic-deleted",
			new Date("2026-08-01T00:00:00.000Z"),
		);
		const survivor = await project("automatic-survivor");
		const deletedAssets = await assetFixture(
			deleted.id,
			deleted.companyId,
			"automatic-deleted",
		);
		const survivorAssets = await assetFixture(
			survivor.id,
			survivor.companyId,
			"automatic-survivor",
		);

		expect(await deals.purgeExpired(before)).toMatchObject({
			requested: 1,
			succeeded: 1,
			skipped: 0,
			failed: 0,
		});

		expect(await db.deal.findUnique({ where: { id: deleted.id } })).toBeNull();
		expect(
			await db.assetStorageJob.findMany({
				where: { projectId: deleted.id },
				select: { artifactId: true, uploadId: true, objectKey: true },
			}),
		).toHaveLength(3);
		expect(
			await db.assetUpload.findUnique({
				where: { id: deletedAssets.upload.id },
				select: { status: true },
			}),
		).toEqual({ status: "CANCELED" });

		expect(
			await db.deal.findUnique({ where: { id: survivor.id } }),
		).not.toBeNull();
		expect(
			await db.assetStorageJob.count({ where: { projectId: survivor.id } }),
		).toBe(0);
		expect(
			await db.artifact.findUnique({
				where: { id: survivorAssets.artifact.id },
			}),
		).not.toBeNull();
		expect(
			await db.assetUpload.findUnique({
				where: { id: survivorAssets.upload.id },
			}),
		).not.toBeNull();
	});
});
