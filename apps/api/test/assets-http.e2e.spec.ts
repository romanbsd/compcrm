import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Db } from "@crm/db";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AssetError } from "../src/assets/asset-error";
import { AssetStorageService } from "../src/assets/asset-storage.service";
import { AssetWorkerService } from "../src/assets/asset-worker.service";
import { AssetsService } from "../src/assets/assets.service";
import type { RequestPrincipal } from "../src/auth/request-principal";
import { RequestPrincipalService } from "../src/auth/request-principal.service";

const prefix = `asset-http-${randomUUID()}`;
const projectId = `${prefix}-project`;
const otherProjectId = `${prefix}-other-project`;
const customerId = `${prefix}-customer`;
const userId = `${prefix}-user`;
const base = `/rest/v1/projects/${projectId}`;
const metadata = {
	fileName: "evidence.unusual",
	sizeBytes: 0,
	source: "MANUAL",
};

describe("Asset HTTP contract", () => {
	let app: INestApplication;
	let db: Db;
	let principal: RequestPrincipal;
	let restores: Array<() => void> = [];
	const objects = new Map<
		string,
		{ sizeBytes: number; etag: string; contentType: string | null }
	>();

	beforeAll(async () => {
		const testUrl = process.env.TEST_DATABASE_URL;
		if (!testUrl || !new URL(testUrl).pathname.endsWith("_test"))
			throw new Error("A disposable TEST_DATABASE_URL is required.");
		process.env.DATABASE_URL = testUrl;
		({ db } = await import("@crm/db"));
		const user = await db.user.create({
			data: {
				id: userId,
				email: `${prefix}@example.com`,
				name: "Asset HTTP test",
				emailVerified: true,
			},
		});
		await db.company.create({
			data: { id: customerId, name: "Asset HTTP test" },
		});
		await db.deal.createMany({
			data: [projectId, otherProjectId].map((id) => ({
				id,
				name: id,
				companyId: customerId,
				ownerId: userId,
			})),
		});
		principal = {
			credentialKind: "oauth",
			user,
			clientId: "asset-test-client",
			scopes: new Set(["crm.read", "crm.write"]),
			session: null,
			expiresAt: null,
		};
		const { createApp } = await import("../src/create-app");
		app = await createApp();
		const resolve = spyOn(
			app.get(RequestPrincipalService),
			"resolve",
		).mockImplementation(async (req) => {
			if (req.header("x-asset-test-user") !== userId) return null;
			const scope = req.header("x-asset-test-scope");
			return scope ? { ...principal, scopes: new Set([scope]) } : principal;
		});
		const storage = app.get(AssetStorageService);
		const mocks = [
			resolve,
			spyOn(storage, "configured").mockReturnValue(true),
			spyOn(storage, "bucket").mockReturnValue("asset-tests"),
			spyOn(storage, "presignPut").mockImplementation(
				async (_bucket, key) => `https://storage.invalid/${key}?signed=put`,
			),
			spyOn(storage, "presignGet").mockImplementation(
				async (_bucket, key) => `https://storage.invalid/${key}?signed=get`,
			),
			spyOn(storage, "head").mockImplementation(
				async (_bucket, key) => objects.get(key) ?? null,
			),
			spyOn(storage, "copy").mockImplementation(
				async (_bucket, source, target, etag) => {
					const object = objects.get(source);
					if (!object || object.etag !== etag)
						throw new Error("Source changed.");
					objects.set(target, { ...object });
				},
			),
			spyOn(storage, "delete").mockImplementation(async (_bucket, key) => {
				objects.delete(key);
			}),
		];
		restores = mocks.map((mock) => () => mock.mockRestore());
	});

	afterAll(async () => {
		for (const restore of restores) restore();
		if (app) await app.close();
		if (!db) return;
		await db.assetStorageJob.deleteMany({
			where: { projectId: { in: [projectId, otherProjectId] } },
		});
		await db.assetApiRequest.deleteMany({
			where: { actorKey: `user:${userId}` },
		});
		await db.assetEmailSource.deleteMany({
			where: { projectId: { in: [projectId, otherProjectId] } },
		});
		await db.assetUpload.deleteMany({
			where: { projectId: { in: [projectId, otherProjectId] } },
		});
		await db.deal.deleteMany({
			where: { id: { in: [projectId, otherProjectId] } },
		});
		await db.company.delete({ where: { id: customerId } });
		await db.user.delete({ where: { id: userId } });
	});

	it("protects all ten endpoints and returns the versioned error envelope", async () => {
		const endpoints = [
			["post", `${base}/asset-uploads`],
			["get", `${base}/asset-uploads/upload`],
			["post", `${base}/asset-uploads/upload/url`],
			["post", `${base}/asset-uploads/upload/confirm`],
			["delete", `${base}/asset-uploads/upload`],
			["get", `/rest/v1/customers/${customerId}/assets`],
			["get", `${base}/assets`],
			["get", `${base}/assets/asset`],
			["get", `${base}/assets/asset/download`],
			["delete", `${base}/assets/asset`],
		] as const;
		for (const [method, path] of endpoints) {
			const call = request(app.getHttpServer())
				[method](path)
				.set("X-Request-Id", "asset-request-test");
			if (method === "post")
				call.send(path.endsWith("asset-uploads") ? metadata : {});
			const response = await call.expect(401);
			expect(response.body).toEqual({
				error: {
					code: "AUTH_REQUIRED",
					message: "Authentication is required.",
					requestId: "asset-request-test",
					retryable: false,
				},
			});
			expect(response.headers["cache-control"]).toBe("private, no-store");
			expect(response.headers["x-request-id"]).toBe("asset-request-test");
		}
	});

	it("enforces read and write OAuth scopes", async () => {
		const deniedWrite = await request(app.getHttpServer())
			.post(`${base}/asset-uploads`)
			.set("x-asset-test-user", userId)
			.set("x-asset-test-scope", "crm.read")
			.set("Idempotency-Key", randomUUID())
			.send(metadata)
			.expect(403);
		expect(deniedWrite.body.error.code).toBe("FORBIDDEN");
		expect(deniedWrite.headers["www-authenticate"]).toContain("crm.write");
		const deniedRead = await request(app.getHttpServer())
			.get(`${base}/assets`)
			.set("x-asset-test-user", userId)
			.set("x-asset-test-scope", "crm.write")
			.expect(403);
		expect(deniedRead.body.error.code).toBe("FORBIDDEN");
	});

	it("rejects unknown metadata, numeric strings, path shadowing, and missing keys", async () => {
		for (const body of [
			{ ...metadata, extra: true },
			{ ...metadata, sizeBytes: "0" },
			{ ...metadata, projectId: otherProjectId },
			{ ...metadata, fileName: "../file" },
		]) {
			const response = await request(app.getHttpServer())
				.post(`${base}/asset-uploads`)
				.set("x-asset-test-user", userId)
				.set("Idempotency-Key", randomUUID())
				.send(body)
				.expect(400);
			expect(response.body.error.code).toBe("VALIDATION_ERROR");
		}
		await request(app.getHttpServer())
			.post(`${base}/asset-uploads`)
			.set("x-asset-test-user", userId)
			.send(metadata)
			.expect(400);
		for (const query of [
			"unknown=1",
			`projectId=${otherProjectId}`,
			"page=1.5",
		]) {
			const response = await request(app.getHttpServer())
				.get(`${base}/assets?${query}`)
				.set("x-asset-test-user", userId)
				.expect(400);
			expect(response.body.error.code).toBe("VALIDATION_ERROR");
		}
		await request(app.getHttpServer())
			.post(`${base}/asset-uploads?extra=1`)
			.set("x-asset-test-user", userId)
			.set("Idempotency-Key", randomUUID())
			.send(metadata)
			.expect(400);
		await request(app.getHttpServer())
			.post(`${base}/asset-uploads`)
			.set("x-asset-test-user", userId)
			.set("Content-Type", "application/json")
			.send("{")
			.expect(400);
	});

	it("returns 413 and its exact byte limit without creating an upload", async () => {
		const before = await db.assetUpload.count({ where: { projectId } });
		const response = await request(app.getHttpServer())
			.post(`${base}/asset-uploads`)
			.set("x-asset-test-user", userId)
			.set("Idempotency-Key", randomUUID())
			.send({ ...metadata, sizeBytes: 5363466241 })
			.expect(413);
		expect(response.body.error).toMatchObject({
			code: "UPLOAD_TOO_LARGE",
			retryable: false,
			details: { maxBytes: 5363466240 },
		});
		expect(await db.assetUpload.count({ where: { projectId } })).toBe(before);
	});

	it("returns storage and capacity errors without exposing internal data", async () => {
		const unavailable = spyOn(
			app.get(AssetStorageService),
			"configured",
		).mockReturnValue(false);
		const response = await request(app.getHttpServer())
			.post(`${base}/asset-uploads`)
			.set("x-asset-test-user", userId)
			.set("Idempotency-Key", randomUUID())
			.send(metadata)
			.expect(503);
		expect(response.body.error).toMatchObject({
			code: "STORAGE_UNAVAILABLE",
			retryable: false,
		});
		unavailable.mockReturnValue(true);
		const create = spyOn(
			app.get(AssetsService),
			"createUpload",
		).mockRejectedValueOnce(
			new AssetError(
				429,
				"UPLOAD_CAPACITY_EXCEEDED",
				"Temporary upload capacity is full.",
				undefined,
				true,
			),
		);
		const capacity = await request(app.getHttpServer())
			.post(`${base}/asset-uploads`)
			.set("x-asset-test-user", userId)
			.set("Idempotency-Key", randomUUID())
			.send(metadata)
			.expect(429);
		expect(capacity.body.error).toMatchObject({
			code: "UPLOAD_CAPACITY_EXCEEDED",
			retryable: true,
		});
		expect(capacity.headers["retry-after"]).toBe("60");
		create.mockRejectedValueOnce(new Error("secret provider credential"));
		const failure = await request(app.getHttpServer())
			.post(`${base}/asset-uploads`)
			.set("x-asset-test-user", userId)
			.set("Idempotency-Key", randomUUID())
			.send(metadata)
			.expect(500);
		expect(JSON.stringify(failure.body)).not.toContain(
			"secret provider credential",
		);
		create.mockRestore();
	});

	it("completes the upload, renewal, confirmation, listing, download, and deletion flow", async () => {
		const key = randomUUID();
		const create = () =>
			request(app.getHttpServer())
				.post(`${base}/asset-uploads`)
				.set("x-asset-test-user", userId)
				.set("Idempotency-Key", key)
				.send(metadata);
		const first = await create().expect(200);
		const replay = await create().expect(200);
		expect(replay.body).toEqual(first.body);
		const uploadId = first.body.upload.id;
		expect(first.body.transfer.headers).toEqual({
			"Content-Type": "application/octet-stream",
			"Content-Length": "0",
		});
		await request(app.getHttpServer())
			.get(`/rest/v1/projects/${otherProjectId}/asset-uploads/${uploadId}`)
			.set("x-asset-test-user", userId)
			.expect(404);
		await request(app.getHttpServer())
			.post(`${base}/asset-uploads/${uploadId}/url`)
			.set("x-asset-test-user", userId)
			.set("Idempotency-Key", randomUUID())
			.send({})
			.expect(200);
		const stored = await db.assetUpload.findUniqueOrThrow({
			where: { id: uploadId },
		});
		objects.set(stored.temporaryKey, {
			sizeBytes: 0,
			etag: '"empty"',
			contentType: "application/octet-stream",
		});
		const confirmed = await request(app.getHttpServer())
			.post(`${base}/asset-uploads/${uploadId}/confirm`)
			.set("x-asset-test-user", userId)
			.set("Idempotency-Key", randomUUID())
			.send({})
			.expect(200);
		expect(confirmed.body.statusUrl).toBe(`${base}/asset-uploads/${uploadId}`);
		const processed = await app.get(AssetWorkerService).process();
		expect(processed.processed).toBeGreaterThan(0);
		expect(
			await db.assetStorageJob.findFirst({
				where: { uploadId, operation: "FINALIZE_UPLOAD" },
				select: { state: true, attempts: true, lastError: true },
			}),
		).toMatchObject({ state: "COMPLETE", lastError: null });
		const state = await request(app.getHttpServer())
			.get(confirmed.body.statusUrl)
			.set("x-asset-test-user", userId)
			.expect(200);
		expect(state.body.upload.status).toBe("READY");
		const assetId = state.body.upload.assetId;
		const detail = await request(app.getHttpServer())
			.get(`${base}/assets/${assetId}`)
			.set("x-asset-test-user", userId)
			.expect(200);
		expect(detail.body.asset).toMatchObject({
			id: assetId,
			projectId,
			customerId,
			sizeBytes: 0,
			source: "MANUAL",
			uploadedById: userId,
		});
		expect(detail.body.asset).not.toHaveProperty("storageKey");
		for (const path of [
			`${base}/assets`,
			`/rest/v1/customers/${customerId}/assets?projectId=${projectId}`,
		]) {
			const listed = await request(app.getHttpServer())
				.get(path)
				.set("x-asset-test-user", userId)
				.expect(200);
			expect(
				listed.body.items.map((item: { id: string }) => item.id),
			).toContain(assetId);
		}
		await request(app.getHttpServer())
			.get(`${base}/assets/${assetId}/download`)
			.set("x-asset-test-user", userId)
			.expect(200);
		await request(app.getHttpServer())
			.delete(`${base}/assets/${assetId}`)
			.set("x-asset-test-user", userId)
			.set("Idempotency-Key", randomUUID())
			.expect(200);
		await request(app.getHttpServer())
			.get(`${base}/assets/${assetId}/download`)
			.set("x-asset-test-user", userId)
			.expect(409);
		await app.get(AssetWorkerService).process();
		const deleted = await request(app.getHttpServer())
			.get(`${base}/assets/${assetId}`)
			.set("x-asset-test-user", userId)
			.expect(200);
		expect(deleted.body.asset.status).toBe("DELETED");
		expect(deleted.body.asset.deletedAt).not.toBeNull();
		expect(objects.has(stored.finalKey)).toBe(false);
	});

	it("cancels an upload and preserves its durable status", async () => {
		const created = await request(app.getHttpServer())
			.post(`${base}/asset-uploads`)
			.set("x-asset-test-user", userId)
			.set("Idempotency-Key", randomUUID())
			.send(metadata)
			.expect(200);
		const uploadId = created.body.upload.id;
		const canceled = await request(app.getHttpServer())
			.delete(`${base}/asset-uploads/${uploadId}`)
			.set("x-asset-test-user", userId)
			.set("Idempotency-Key", randomUUID())
			.expect(200);
		expect(canceled.body).toEqual({ uploadId, status: "CANCELED" });
		const confirmation = await request(app.getHttpServer())
			.post(`${base}/asset-uploads/${uploadId}/confirm`)
			.set("x-asset-test-user", userId)
			.set("Idempotency-Key", randomUUID())
			.send({})
			.expect(409);
		expect(confirmation.body.error.details.state).toBe("CANCELED");
	});

	it("publishes ten asset operations and leaves old REST error formatting unchanged", async () => {
		const document = await request(app.getHttpServer())
			.get("/openapi.json")
			.expect(200);
		const operations = Object.entries(document.body.paths)
			.filter(([path]) => path.startsWith("/v1/"))
			.flatMap(([, methods]) =>
				Object.keys(
					methods as { get?: object; post?: object; delete?: object },
				).filter((method) => ["get", "post", "delete"].includes(method)),
			);
		expect(operations).toHaveLength(10);
		const createOperation =
			document.body.paths["/v1/projects/{projectId}/asset-uploads"].post;
		expect(createOperation.parameters).toContainEqual(
			expect.objectContaining({
				name: "Idempotency-Key",
				in: "header",
				required: true,
			}),
		);
		expect(
			createOperation.responses["413"].content["application/json"].schema
				.properties.error.required,
		).toContain("requestId");
		const legacy = await request(app.getHttpServer())
			.get("/rest/companies/missing")
			.expect(401);
		expect(legacy.body.code).toBe("UNAUTHORIZED");
		expect(legacy.body).not.toHaveProperty("error");
		await request(app.getHttpServer())
			.get("/internal/assets/process")
			.expect(process.env.CRON_SECRET ? 403 : 503);
	});
});
