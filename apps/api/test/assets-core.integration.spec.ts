import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@crm/db";
import { ConfigService } from "@nestjs/config";
import { ASSETS } from "../src/assets/asset-config";
import { AssetError } from "../src/assets/asset-error";
import { enqueueProjectAssetPurge } from "../src/assets/asset-purge";
import {
	type AssetStorageHead,
	AssetStorageService,
} from "../src/assets/asset-storage.service";
import { AssetWorkerService } from "../src/assets/asset-worker.service";
import {
	type CreateUploadInput,
	createUploadInput,
} from "../src/assets/assets.contracts";
import { type AssetActor, AssetsService } from "../src/assets/assets.service";

class MemoryStorage extends AssetStorageService {
	objects = new Map<string, AssetStorageHead>();
	copyCount = 0;
	deleteFailures = 0;
	copyFailures = 0;
	copyTimeout = false;
	enabled = true;
	copyHook: ((signal?: AbortSignal) => Promise<void>) | null = null;
	headHook: ((signal?: AbortSignal) => Promise<void>) | null = null;
	constructor() {
		super(
			new ConfigService({
				R2_ACCOUNT_ID: "test",
				R2_ACCESS_KEY_ID: "test",
				R2_SECRET_ACCESS_KEY: "test",
				R2_BUCKET: "test",
			}),
		);
	}
	override configured() {
		return this.enabled !== false;
	}
	override bucket() {
		return "test";
	}
	override async presignPut(
		_bucket: string,
		key: string,
		_type: string,
		_size: number,
		expires: Date,
	) {
		return `https://storage.test/${key}?expires=${expires.getTime()}`;
	}
	override async presignGet(_bucket: string, key: string) {
		return `https://storage.test/${key}`;
	}
	override async head(_bucket: string, key: string, signal?: AbortSignal) {
		signal?.throwIfAborted();
		if (this.headHook) await this.headHook(signal);
		signal?.throwIfAborted();
		return this.objects.get(key) ?? null;
	}
	override async copy(
		_bucket: string,
		sourceKey: string,
		finalKey: string,
		sourceEtag: string,
		signal?: AbortSignal,
	) {
		signal?.throwIfAborted();
		this.copyCount++;
		if (this.copyFailures > 0) {
			this.copyFailures--;
			throw new Error("Transient copy failure");
		}
		if (this.copyHook) await this.copyHook(signal);
		signal?.throwIfAborted();
		const source = this.objects.get(sourceKey);
		if (!source || source.etag !== sourceEtag)
			throw new Error("Precondition failed");
		this.objects.set(finalKey, { ...source });
		if (this.copyTimeout) {
			this.copyTimeout = false;
			throw new Error("Unknown copy result");
		}
	}
	override async delete(_bucket: string, key: string) {
		if (this.deleteFailures > 0) {
			this.deleteFailures--;
			throw new Error("Transient delete failure");
		}
		this.objects.delete(key);
	}
	put(key: string, sizeBytes = 4, etag = '"source-1"') {
		this.objects.set(key, {
			sizeBytes,
			etag,
			contentType: "arbitrary/example",
		});
	}
}

let storage: MemoryStorage;
let service: AssetsService;
let worker: AssetWorkerService;
let actor: AssetActor;
let userId: string;
let companyId: string;
let projectId: string;
let otherProjectId: string;
const run = `assets-core-${randomUUID()}`;
let projectIds: string[];
let threadIds: string[];

const metadata = (input: Partial<CreateUploadInput> = {}) =>
	createUploadInput.parse({
		fileName: "file.custom",
		sizeBytes: 4,
		source: "MANUAL",
		...input,
	});
async function create(
	input: Partial<CreateUploadInput> = {},
	key = randomUUID(),
) {
	return service.createUpload(actor, projectId, metadata(input), key);
}
async function put(uploadId: string, size = 4) {
	const upload = await db.assetUpload.findUniqueOrThrow({
		where: { id: uploadId },
	});
	storage.put(upload.temporaryKey, size);
	return upload;
}
async function ready(input: Partial<CreateUploadInput> = {}) {
	const created = await create(input);
	await put(created.upload.id, input.sizeBytes ?? 4);
	await service.confirmUpload(
		actor,
		projectId,
		created.upload.id,
		randomUUID(),
	);
	await worker.process();
	const state = await service.getUpload(actor, projectId, created.upload.id);
	expect(state.upload.status).toBe("READY");
	return {
		uploadId: created.upload.id,
		assetId: state.upload.assetId as string,
	};
}
async function email(attachmentId = "gmail-part:1") {
	const thread = await db.emailThread.create({
		data: {
			rootMessageId: randomUUID(),
			companyId,
			firstMessageAt: new Date(),
			lastMessageAt: new Date(),
		},
	});
	threadIds.push(thread.id);
	const message = await db.emailMessage.create({
		data: {
			threadId: thread.id,
			rfcMessageId: randomUUID(),
			syncedByUserId: userId,
			gmailMessageId: randomUUID(),
			direction: "INBOUND",
			fromEmail: "sender@example.test",
			recipients: [],
			sentAt: new Date(),
		},
	});
	return { messageId: message.id, attachmentId };
}
async function due() {
	await db.assetStorageJob.updateMany({
		where: { projectId: { in: projectIds }, state: "PENDING" },
		data: { nextAttemptAt: new Date(0) },
	});
}

beforeAll(async () => {
	const url = new URL(process.env.DATABASE_URL ?? "");
	if (
		!["localhost", "127.0.0.1"].includes(url.hostname) ||
		!url.pathname.endsWith("_test")
	)
		throw new Error("Assets integration tests require a local test database.");
	const rows = await db.$queryRaw<
		Array<{ name: string }>
	>`SELECT current_database() AS name`;
	expect(rows[0]?.name).toBe(url.pathname.slice(1));
});

beforeEach(async () => {
	projectIds = [];
	threadIds = [];
	storage = new MemoryStorage();
	service = new AssetsService(db, storage);
	worker = new AssetWorkerService(db, storage);
	const user = await db.user.create({
		data: { id: randomUUID(), name: run, email: `${randomUUID()}@assets.test` },
	});
	userId = user.id;
	actor = { type: "USER", userId };
	const company = await db.company.create({
		data: { name: run, domain: `${randomUUID()}.assets.test` },
	});
	companyId = company.id;
	const project = await db.deal.create({
		data: { name: "Kitchen", companyId, ownerId: userId },
	});
	projectId = project.id;
	const other = await db.deal.create({
		data: { name: "Bathroom", companyId, ownerId: userId },
	});
	otherProjectId = other.id;
	projectIds = [projectId, otherProjectId];
	threadIds = [];
});

afterEach(async () => {
	if (!projectIds.length) return;
	await db.assetStorageJob.deleteMany({
		where: { projectId: { in: projectIds } },
	});
	await db.assetEmailSource.deleteMany({
		where: { projectId: { in: projectIds } },
	});
	await db.assetUpload.deleteMany({ where: { projectId: { in: projectIds } } });
	await db.assetApiRequest.deleteMany({
		where: { actorKey: { in: [`user:${userId}`, `mailbox:${userId}`] } },
	});
	await db.deal.deleteMany({ where: { id: { in: projectIds } } });
	await db.emailThread.deleteMany({ where: { id: { in: threadIds } } });
	await db.company.delete({ where: { id: companyId } });
	await db.user.delete({ where: { id: userId } });
});

afterAll(async () => {
	await db.$disconnect();
});

describe("asset state and storage transactions", () => {
	it("serializes concurrent creation and rejects a changed retry body", async () => {
		const key = randomUUID();
		const results = await Promise.all(
			Array.from({ length: 5 }, () => create({}, key)),
		);
		expect(new Set(results.map((result) => result.upload.id)).size).toBe(1);
		expect(await db.assetUpload.count({ where: { projectId } })).toBe(1);
		await expect(create({ fileName: "other" }, key)).rejects.toMatchObject({
			code: "IDEMPOTENCY_CONFLICT",
		});
		await db.deal.delete({ where: { id: projectId } });
		await expect(create({}, key)).rejects.toMatchObject({
			code: "RESOURCE_NOT_FOUND",
		});
	});

	it("accepts arbitrary formats and zero bytes without a duration cap", async () => {
		const { assetId } = await ready({
			fileName: "empty.unknown",
			sizeBytes: 0,
			contentType: "arbitrary/x-format",
			durationMilliseconds: 7_200_000,
		});
		const detail = await service.getAsset(actor, projectId, assetId);
		expect(detail.asset).toMatchObject({
			sizeBytes: 0,
			contentType: "arbitrary/x-format",
			durationMilliseconds: 7_200_000,
			uploadedById: userId,
			source: "MANUAL",
		});
		expect(detail.asset).not.toHaveProperty("storageKey");
		expect(
			(await service.downloadAsset(actor, projectId, assetId)).method,
		).toBe("GET");
	});

	it("enforces the exact upload-size boundary", async () => {
		expect(
			(await create({ sizeBytes: ASSETS.maxSingleUploadBytes })).transfer
				?.maxBytes,
		).toBe(5_363_466_240);
		await expect(
			create({ sizeBytes: ASSETS.maxSingleUploadBytes + 1 }),
		).rejects.toMatchObject({ code: "UPLOAD_TOO_LARGE" });
		expect(await db.assetUpload.count({ where: { projectId } })).toBe(1);
	});

	it("retains reservations after cancellation and releases after late-object reconciliation", async () => {
		const uploads = await Promise.all(
			Array.from({ length: ASSETS.reservationLimit }, () => create()),
		);
		for (const upload of uploads)
			await service.cancelUpload(
				actor,
				projectId,
				upload.upload.id,
				randomUUID(),
			);
		await worker.process();
		await expect(create()).rejects.toMatchObject({
			code: "UPLOAD_CAPACITY_EXCEEDED",
			retryable: true,
		});
		const firstUpload = uploads[0];
		if (!firstUpload) throw new Error("The reservation fixture is empty.");
		const first = await put(firstUpload.upload.id);
		await db.assetUpload.updateMany({
			where: { projectId },
			data: { reservationUntil: new Date(0) },
		});
		await due();
		await worker.process();
		expect(storage.objects.has(first.temporaryKey)).toBe(false);
		expect((await create()).upload.status).toBe("PENDING");
	});

	it("keeps the final object unchanged after an old PUT grant is reused", async () => {
		const result = await ready();
		const upload = await db.assetUpload.findUniqueOrThrow({
			where: { id: result.uploadId },
		});
		storage.put(upload.temporaryKey, 88, '"replacement"');
		await service.confirmUpload(actor, projectId, upload.id, randomUUID());
		await worker.process();
		expect(storage.objects.get(upload.finalKey)?.sizeBytes).toBe(4);
		expect(storage.copyCount).toBe(1);
		expect(await db.artifact.count({ where: { dealId: projectId } })).toBe(1);
	});

	it("reconciles a copy timeout without copying or inserting twice", async () => {
		const created = await create();
		await put(created.upload.id);
		storage.copyTimeout = true;
		await service.confirmUpload(
			actor,
			projectId,
			created.upload.id,
			randomUUID(),
		);
		await worker.process();
		expect(
			(await service.getUpload(actor, projectId, created.upload.id)).upload
				.status,
		).toBe("FINALIZING");
		await due();
		await worker.process();
		expect(
			(await service.getUpload(actor, projectId, created.upload.id)).upload
				.status,
		).toBe("READY");
		expect(storage.copyCount).toBe(1);
	});

	it("reclaims an expired worker lease and refuses state writes from its previous owner", async () => {
		const created = await create();
		await put(created.upload.id);
		await service.confirmUpload(
			actor,
			projectId,
			created.upload.id,
			randomUUID(),
		);
		await db.assetStorageJob.update({
			where: { operationKey: `finalize:${created.upload.id}` },
			data: {
				state: "RUNNING",
				leaseToken: "dead-worker",
				leaseUntil: new Date(0),
			},
		});
		await worker.process();
		expect(
			(await service.getUpload(actor, projectId, created.upload.id)).upload
				.status,
		).toBe("READY");
		const failed = await create();
		await put(failed.upload.id);
		await service.confirmUpload(
			actor,
			projectId,
			failed.upload.id,
			randomUUID(),
		);
		storage.copyHook = async () => {
			await db.assetStorageJob.update({
				where: { operationKey: `finalize:${failed.upload.id}` },
				data: {
					leaseUntil: new Date(Date.now() + ASSETS.worker.leaseMs),
					leaseToken: "replacement-worker",
				},
			});
		};
		await worker.process();
		expect(
			(await service.getUpload(actor, projectId, failed.upload.id)).upload
				.status,
		).toBe("FINALIZING");
		storage.copyHook = null;
		await db.assetStorageJob.update({
			where: { operationKey: `finalize:${failed.upload.id}` },
			data: { leaseUntil: new Date(0) },
		});
		await worker.process();
		expect(
			(await service.getUpload(actor, projectId, failed.upload.id)).upload
				.status,
		).toBe("READY");
	});

	it("fails verification for missing and mismatched bytes", async () => {
		for (const size of [null, 3]) {
			const created = await create();
			if (size !== null) await put(created.upload.id, size);
			await service.confirmUpload(
				actor,
				projectId,
				created.upload.id,
				randomUUID(),
			);
			await worker.process();
			expect(
				(await service.getUpload(actor, projectId, created.upload.id)).upload,
			).toMatchObject({
				status: "FAILED",
				failure: { code: "UPLOAD_VERIFICATION_FAILED" },
			});
		}
		expect(await db.artifact.count({ where: { dealId: projectId } })).toBe(0);
	});

	it("stops finalization after five failed attempts", async () => {
		const created = await create();
		await put(created.upload.id);
		storage.copyFailures = 8;
		await service.confirmUpload(
			actor,
			projectId,
			created.upload.id,
			randomUUID(),
		);
		for (let attempt = 0; attempt < 5; attempt++) {
			await due();
			await worker.process();
		}
		expect(
			(await service.getUpload(actor, projectId, created.upload.id)).upload,
		).toMatchObject({
			status: "FAILED",
			failure: { code: "UPLOAD_FINALIZATION_FAILED" },
		});
		expect(storage.copyCount).toBe(5);
	});

	it("serializes cancellation and confirmation", async () => {
		const created = await create();
		await put(created.upload.id);
		const results = await Promise.allSettled([
			service.cancelUpload(actor, projectId, created.upload.id, randomUUID()),
			service.confirmUpload(actor, projectId, created.upload.id, randomUUID()),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		await worker.process();
		const status = (
			await service.getUpload(actor, projectId, created.upload.id)
		).upload.status;
		expect(["CANCELED", "READY"]).toContain(status);
	});

	it("renews one upload without extending intent expiry and records expired state", async () => {
		const created = await create();
		const renewal = await service.renewUpload(
			actor,
			projectId,
			created.upload.id,
			randomUUID(),
		);
		expect(renewal.upload.id).toBe(created.upload.id);
		expect(renewal.upload.expiresAt).toBe(created.upload.expiresAt);
		await db.assetUpload.update({
			where: { id: created.upload.id },
			data: { expiresAt: new Date(0) },
		});
		await expect(
			service.renewUpload(actor, projectId, created.upload.id, randomUUID()),
		).rejects.toMatchObject({
			code: "UPLOAD_STATE_CONFLICT",
			details: { state: "EXPIRED" },
		});
		expect(
			(await service.getUpload(actor, projectId, created.upload.id)).upload
				.status,
		).toBe("EXPIRED");
		expect(
			await db.assetStorageJob.count({
				where: { uploadId: created.upload.id, operation: "DELETE_OBJECT" },
			}),
		).toBe(1);
	});

	it("rejects new work on archived projects but finishes accepted work", async () => {
		const created = await create();
		await put(created.upload.id);
		await service.confirmUpload(
			actor,
			projectId,
			created.upload.id,
			randomUUID(),
		);
		await db.deal.update({
			where: { id: projectId },
			data: { archivedAt: new Date() },
		});
		await expect(create()).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
		await expect(
			service.renewUpload(actor, projectId, created.upload.id, randomUUID()),
		).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
		await expect(
			service.confirmUpload(actor, projectId, created.upload.id, randomUUID()),
		).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
		await worker.process();
		expect(
			(await service.getUpload(actor, projectId, created.upload.id)).upload
				.status,
		).toBe("READY");
	});

	it("keeps files within their project and lists both customer projects", async () => {
		const first = await ready();
		const other = await service.createUpload(
			actor,
			otherProjectId,
			metadata(),
			randomUUID(),
		);
		await put(other.upload.id);
		await service.confirmUpload(
			actor,
			otherProjectId,
			other.upload.id,
			randomUUID(),
		);
		await worker.process();
		const listing = await service.listCustomerAssets(actor, companyId, {
			page: 1,
			pageSize: 1,
		});
		expect(listing.total).toBe(2);
		expect(listing.hasNextPage).toBe(true);
		expect(
			(
				await service.listProjectAssets(actor, projectId, {
					page: 1,
					pageSize: 25,
				})
			).total,
		).toBe(1);
		await expect(
			service.getAsset(actor, otherProjectId, first.assetId),
		).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
		await expect(
			service.getUpload(actor, otherProjectId, first.uploadId),
		).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
	});

	it("returns an empty high page without overflowing the database offset", async () => {
		await ready();
		expect(
			await service.listProjectAssets(actor, projectId, {
				page: Number.MAX_SAFE_INTEGER,
				pageSize: 100,
			}),
		).toEqual({
			items: [],
			page: Number.MAX_SAFE_INTEGER,
			pageSize: 100,
			total: 1,
			hasNextPage: false,
		});
	});

	it("requires an existing meeting on the exact project", async () => {
		const wrong = await db.activity.create({
			data: { type: "NOTE", dealId: projectId, createdById: userId },
		});
		await expect(create({ activityId: wrong.id })).rejects.toMatchObject({
			code: "PROJECT_MISMATCH",
		});
		const meeting = await db.activity.create({
			data: { type: "MEETING", dealId: otherProjectId, createdById: userId },
		});
		await expect(create({ activityId: meeting.id })).rejects.toMatchObject({
			code: "PROJECT_MISMATCH",
		});
		await expect(create({ activityId: "absent" })).rejects.toMatchObject({
			code: "RESOURCE_NOT_FOUND",
		});
		await db.activity.update({
			where: { id: meeting.id },
			data: { dealId: projectId },
		});
		expect((await create({ activityId: meeting.id })).upload.status).toBe(
			"PENDING",
		);
	});
});

describe("asset sources and deletion", () => {
	it("deduplicates email occurrences, preserves the project binding, and replaces canceled attempts", async () => {
		const emailSource = await email();
		const input = { source: "EMAIL_ATTACHMENT" as const, emailSource };
		const first = await create(input);
		const duplicate = await create(input);
		expect(duplicate.upload.id).toBe(first.upload.id);
		await expect(create({ ...input, sizeBytes: 9 })).rejects.toMatchObject({
			code: "SOURCE_CONFLICT",
		});
		await expect(
			service.createUpload(
				actor,
				otherProjectId,
				metadata(input),
				randomUUID(),
			),
		).rejects.toMatchObject({ code: "PROJECT_MISMATCH" });
		await service.cancelUpload(actor, projectId, first.upload.id, randomUUID());
		const replacement = await create(input);
		expect(replacement.upload.id).not.toBe(first.upload.id);
		const distinct = await create({
			...input,
			emailSource: { ...emailSource, attachmentId: "gmail-part:2" },
		});
		expect(distinct.upload.id).not.toBe(replacement.upload.id);
		expect(await db.assetEmailSource.count({ where: { projectId } })).toBe(2);
	});

	it("preserves email deletion markers after artifact-row removal", async () => {
		const emailSource = await email();
		const result = await ready({ source: "EMAIL_ATTACHMENT", emailSource });
		const duplicate = await create({ source: "EMAIL_ATTACHMENT", emailSource });
		expect(duplicate.transfer).toBeNull();
		expect(duplicate.upload.assetId).toBe(result.assetId);
		await service.deleteAsset(actor, projectId, result.assetId, randomUUID());
		await worker.process();
		await db.artifact.delete({ where: { id: result.assetId } });
		await expect(
			create({ source: "EMAIL_ATTACHMENT", emailSource }),
		).rejects.toMatchObject({ code: "SOURCE_DELETED" });
	});

	it("verifies the system mailbox actor and stores null uploader attribution", async () => {
		const emailSource = await email();
		const system: AssetActor = {
			type: "SYSTEM",
			mailboxOwnerId: userId,
			messageId: emailSource.messageId,
		};
		await expect(
			service.createUpload(
				system,
				projectId,
				metadata({ source: "EMAIL_ATTACHMENT", emailSource }),
				randomUUID(),
			),
		).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
		await db.mailboxSync.create({ data: { userId, source: "gmail" } });
		const result = await service.createUpload(
			system,
			projectId,
			metadata({ source: "EMAIL_ATTACHMENT", emailSource }),
			randomUUID(),
		);
		await put(result.upload.id);
		await service.confirmUpload(
			system,
			projectId,
			result.upload.id,
			randomUUID(),
		);
		await worker.process();
		const upload = await db.assetUpload.findUniqueOrThrow({
			where: { id: result.upload.id },
		});
		expect(upload.uploadedById).toBeNull();
		expect(upload.mailboxOwnerId).toBe(userId);
		expect(
			(await service.getAsset(system, projectId, upload.assetId as string))
				.asset.uploadedById,
		).toBeNull();
	});

	it("hides deleting assets and retries object deletion without duplicate jobs", async () => {
		const result = await ready();
		storage.deleteFailures = 1;
		expect(
			(
				await service.deleteAsset(
					actor,
					projectId,
					result.assetId,
					randomUUID(),
				)
			).status,
		).toBe("DELETING");
		await service.deleteAsset(actor, projectId, result.assetId, randomUUID());
		await expect(
			service.downloadAsset(actor, projectId, result.assetId),
		).rejects.toMatchObject({ code: "ASSET_NOT_READY" });
		expect(
			(
				await service.listProjectAssets(actor, projectId, {
					page: 1,
					pageSize: 25,
				})
			).total,
		).toBe(0);
		await worker.process();
		expect(
			(await service.getAsset(actor, projectId, result.assetId)).asset.status,
		).toBe("DELETING");
		await due();
		await worker.process();
		expect(
			(await service.getAsset(actor, projectId, result.assetId)).asset,
		).toMatchObject({ status: "DELETED", deletedAt: expect.any(String) });
		expect(
			await db.assetStorageJob.count({ where: { artifactId: result.assetId } }),
		).toBe(1);
	});

	it("preserves unknown legacy storage references during deletion", async () => {
		const legacy = await db.artifact.create({
			data: {
				dealId: projectId,
				type: "legacy",
				fileName: "old.pdf",
				storageKey: "unknown-original-location",
			},
		});
		const detail = await service.getAsset(actor, projectId, legacy.id);
		expect(detail.asset).toMatchObject({
			status: "UNVERIFIED",
			source: null,
			sizeBytes: null,
			uploadedById: null,
		});
		await expect(
			service.downloadAsset(actor, projectId, legacy.id),
		).rejects.toMatchObject({ code: "ASSET_NOT_READY" });
		await service.deleteAsset(actor, projectId, legacy.id, randomUUID());
		await worker.process();
		expect(
			(await service.getAsset(actor, projectId, legacy.id)).asset.status,
		).toBe("DELETING");
		const job = await db.assetStorageJob.findFirstOrThrow({
			where: { artifactId: legacy.id },
		});
		expect(job.bucket).toBeNull();
		expect(job.objectKey).toBe("unknown-original-location");
		expect(job.lastError).toContain("operator resolution");
	});

	it("purges a project during conditional copy and removes its orphan final object", async () => {
		const created = await create();
		const upload = await put(created.upload.id);
		await service.confirmUpload(
			actor,
			projectId,
			created.upload.id,
			randomUUID(),
		);
		storage.copyHook = async () => {
			await db.$transaction(async (tx) => {
				await enqueueProjectAssetPurge(tx, projectId);
				await tx.deal.delete({ where: { id: projectId } });
			});
		};
		await worker.process();
		expect(await db.artifact.count({ where: { dealId: projectId } })).toBe(0);
		expect(storage.objects.has(upload.finalKey)).toBe(false);
		expect(
			await db.deal.findUnique({ where: { id: otherProjectId } }),
		).not.toBeNull();
		await expect(
			service.getUpload(actor, projectId, created.upload.id),
		).rejects.toBeInstanceOf(AssetError);
	});

	it("reconciles final objects from a stale copy after deletion already completes", async () => {
		const created = await create();
		const upload = await put(created.upload.id);
		await service.confirmUpload(actor, projectId, upload.id, randomUUID());
		let release: (() => void) | undefined;
		let copying: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			copying = resolve;
		});
		const delayed = new Promise<void>((resolve) => {
			release = resolve;
		});
		storage.copyHook = async () => {
			storage.copyHook = null;
			copying?.();
			await delayed;
		};
		const staleWorker = worker.process();
		await started;
		await db.assetStorageJob.update({
			where: { operationKey: `finalize:${upload.id}` },
			data: { leaseUntil: new Date(0) },
		});
		await worker.process();
		const complete = await service.getUpload(actor, projectId, upload.id);
		expect(complete.upload.status).toBe("READY");
		await service.deleteAsset(
			actor,
			projectId,
			complete.upload.assetId as string,
			randomUUID(),
		);
		await worker.process();
		expect(storage.objects.has(upload.finalKey)).toBe(false);
		storage.put(upload.temporaryKey);
		release?.();
		await staleWorker;
		expect(storage.objects.has(upload.finalKey)).toBe(true);
		await db.assetStorageJob.updateMany({
			where: { artifactId: complete.upload.assetId },
			data: { nextAttemptAt: new Date(0) },
		});
		await worker.process();
		expect(storage.objects.has(upload.finalKey)).toBe(false);
	});

	it("binds system upload operations to their verified email source", async () => {
		const firstSource = await email();
		const secondSource = await email();
		await db.mailboxSync.create({ data: { userId, source: "gmail" } });
		const firstActor: AssetActor = {
			type: "SYSTEM",
			mailboxOwnerId: userId,
			messageId: firstSource.messageId,
		};
		const secondActor: AssetActor = {
			type: "SYSTEM",
			mailboxOwnerId: userId,
			messageId: secondSource.messageId,
		};
		const created = await service.createUpload(
			secondActor,
			projectId,
			metadata({ source: "EMAIL_ATTACHMENT", emailSource: secondSource }),
			randomUUID(),
		);
		await expect(
			service.getUpload(firstActor, projectId, created.upload.id),
		).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
		await expect(
			service.renewUpload(
				firstActor,
				projectId,
				created.upload.id,
				randomUUID(),
			),
		).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
		await expect(
			service.confirmUpload(
				firstActor,
				projectId,
				created.upload.id,
				randomUUID(),
			),
		).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
		await db.emailMessage.delete({ where: { id: secondSource.messageId } });
		await expect(
			service.renewUpload(
				secondActor,
				projectId,
				created.upload.id,
				randomUUID(),
			),
		).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
	});

	it("rejects a revoked source mailbox even when another provider remains connected", async () => {
		const emailSource = await email();
		await db.mailboxSync.createMany({
			data: [
				{ userId, source: "gmail" },
				{ userId, source: "outlook" },
			],
		});
		const system: AssetActor = {
			type: "SYSTEM",
			mailboxOwnerId: userId,
			messageId: emailSource.messageId,
		};
		const key = randomUUID();
		const input = metadata({ source: "EMAIL_ATTACHMENT", emailSource });
		const created = await service.createUpload(system, projectId, input, key);
		await db.mailboxSync.delete({
			where: { userId_source: { userId, source: "gmail" } },
		});
		await expect(
			service.createUpload(system, projectId, input, key),
		).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
		await expect(
			service.renewUpload(system, projectId, created.upload.id, randomUUID()),
		).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
		expect(
			await db.mailboxSync.count({ where: { userId, source: "outlook" } }),
		).toBe(1);
	});

	it("aborts in-flight storage work at the invocation boundary and durably defers it", async () => {
		const created = await create();
		await put(created.upload.id);
		await service.confirmUpload(
			actor,
			projectId,
			created.upload.id,
			randomUUID(),
		);
		const controller = new AbortController();
		storage.copyHook = async (signal) => {
			if (!signal) throw new Error("The worker did not pass an abort signal.");
			await new Promise<void>((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
				setTimeout(() => controller.abort(), 5);
			});
		};
		const start = Date.now();
		await worker.process(controller.signal);
		expect(Date.now() - start).toBeLessThan(1_000);
		const job = await db.assetStorageJob.findUniqueOrThrow({
			where: { operationKey: `finalize:${created.upload.id}` },
		});
		expect(job).toMatchObject({
			state: "PENDING",
			attempts: 0,
			leaseToken: null,
		});
		expect(job.lastError).toContain("Invocation deadline");
		expect(
			(await service.getUpload(actor, projectId, created.upload.id)).upload
				.status,
		).toBe("FINALIZING");
		storage.copyHook = null;
		await due();
		await worker.process();
		expect(
			(await service.getUpload(actor, projectId, created.upload.id)).upload
				.status,
		).toBe("READY");
	});

	it("aborts the initial source metadata request and defers finalization", async () => {
		const created = await create();
		await put(created.upload.id);
		await service.confirmUpload(
			actor,
			projectId,
			created.upload.id,
			randomUUID(),
		);
		const controller = new AbortController();
		storage.headHook = async (signal) => {
			if (!signal)
				throw new Error("The worker did not pass an abort signal to HEAD.");
			await new Promise<void>((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
				setTimeout(() => controller.abort(), 5);
			});
		};
		const start = Date.now();
		await worker.process(controller.signal);
		expect(Date.now() - start).toBeLessThan(1_000);
		expect(storage.copyCount).toBe(0);
		const job = await db.assetStorageJob.findUniqueOrThrow({
			where: { operationKey: `finalize:${created.upload.id}` },
		});
		expect(job).toMatchObject({
			state: "PENDING",
			attempts: 0,
			leaseToken: null,
		});
		expect(job.lastError).toContain("Invocation deadline");
		expect(
			(await service.getUpload(actor, projectId, created.upload.id)).upload
				.status,
		).toBe("FINALIZING");
		storage.headHook = null;
		await due();
		await worker.process();
		expect(
			(await service.getUpload(actor, projectId, created.upload.id)).upload
				.status,
		).toBe("READY");
	});

	it("migrates legacy artifacts without inventing object locations or source metadata", async () => {
		const schema = `asset_migration_${randomUUID().replaceAll("-", "")}`;
		const migration = await Bun.file(
			new URL(
				"../../../packages/db/prisma/migrations/20260907160000_customer_project_assets/migration.sql",
				import.meta.url,
			),
		).text();
		await db.$transaction(async (tx) => {
			await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
			await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
			await tx.$executeRaw`CREATE TABLE "artifact" ("id" TEXT PRIMARY KEY, "dealId" TEXT NOT NULL, "type" TEXT NOT NULL, "fileName" TEXT NOT NULL, "storageKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL)`;
			await tx.$executeRaw`INSERT INTO "artifact" VALUES ('known', 'project-a', 'photo', 'photo.jpg', 'existing/key', '2025-01-01'), ('unknown', 'project-b', ${"x".repeat(65)}, 'unknown.bin', 'unresolved/key', '2025-02-01'), ('missing', 'project-c', '', 'missing', '', '2025-03-01')`;
			for (const statement of migration
				.split(";")
				.map((statement) => statement.trim())
				.filter(Boolean))
				await tx.$executeRawUnsafe(statement);
			const rows = await tx.$queryRaw<
				Array<{
					id: string;
					dealId: string;
					kind: string;
					storageKey: string;
					storageBucket: string | null;
					sizeBytes: bigint | null;
					source: string | null;
					status: string;
				}>
			>`SELECT "id", "dealId", "kind", "storageKey", "storageBucket", "sizeBytes", "source", "status" FROM "artifact" ORDER BY "id"`;
			expect(rows).toEqual([
				{
					id: "known",
					dealId: "project-a",
					kind: "photo",
					storageKey: "existing/key",
					storageBucket: null,
					sizeBytes: null,
					source: null,
					status: "UNVERIFIED",
				},
				{
					id: "missing",
					dealId: "project-c",
					kind: "file",
					storageKey: "",
					storageBucket: null,
					sizeBytes: null,
					source: null,
					status: "UNVERIFIED",
				},
				{
					id: "unknown",
					dealId: "project-b",
					kind: "file",
					storageKey: "unresolved/key",
					storageBucket: null,
					sizeBytes: null,
					source: null,
					status: "UNVERIFIED",
				},
			]);
			await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
		});
	});

	it("keeps metadata reads available without storage configuration", async () => {
		const result = await ready();
		storage.enabled = false;
		await expect(create()).rejects.toMatchObject({
			code: "STORAGE_UNAVAILABLE",
			retryable: false,
		});
		expect(
			(await service.getAsset(actor, projectId, result.assetId)).asset.status,
		).toBe("READY");
		expect(
			(
				await service.listProjectAssets(actor, projectId, {
					page: 1,
					pageSize: 25,
				})
			).total,
		).toBe(1);
	});
});
