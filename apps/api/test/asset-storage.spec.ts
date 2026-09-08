import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { S3Client } from "@aws-sdk/client-s3";
import { ASSETS } from "../src/assets/asset-config";
import { AssetError } from "../src/assets/asset-error";
import { AssetStorageService } from "../src/assets/asset-storage.service";

const r2Keys = [
	"R2_ACCOUNT_ID",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
	"R2_BUCKET",
] as const;

type ResponseSpec = {
	statusCode: number;
	headers?: Record<string, string>;
	body?: Uint8Array;
};

type CapturedRequest = {
	method: string;
	path: string;
	headers: Record<string, string>;
	abortSignal?: AbortSignal;
};

describe("AssetStorageService", () => {
	let previous: Partial<Record<(typeof r2Keys)[number], string | undefined>>;

	beforeEach(() => {
		previous = {};
		for (const key of r2Keys) {
			previous[key] = process.env[key];
			process.env[key] =
				key === "R2_ACCOUNT_ID"
					? "account-id"
					: key === "R2_ACCESS_KEY_ID"
						? "access-key"
						: key === "R2_SECRET_ACCESS_KEY"
							? "secret-key"
							: "assets";
		}
	});

	afterEach(() => {
		for (const key of r2Keys) {
			const value = previous[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("starts without R2 and reports a sanitized unavailable error", () => {
		for (const key of r2Keys) delete process.env[key];
		const service = new AssetStorageService();

		expect(service.configured()).toBe(false);
		expect(() => service.bucket()).toThrow(AssetError);
		try {
			service.bucket();
		} catch (error) {
			expect(error).toMatchObject({
				status: 503,
				code: "STORAGE_UNAVAILABLE",
				retryable: false,
			});
			expect((error as Error).message).not.toContain("secret-key");
		}
	});

	it("signs PUT content type and content length without an R2 checksum", async () => {
		const service = new AssetStorageService();
		const url = await service.presignPut(
			"assets",
			"temporary/upload-1",
			"audio/mpeg",
			1234,
			new Date(Date.now() + 60_000),
		);
		const parsed = new URL(url);

		expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toContain(
			"content-length",
		);
		expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toContain(
			"content-type",
		);
		expect(url).not.toContain("checksum");
	});

	it("signs private GET attachment disposition and response type", async () => {
		const service = new AssetStorageService();
		const url = await service.presignGet(
			"assets",
			"final/upload-1",
			"réunion 1.mp3",
			"audio/mpeg",
			new Date(Date.now() + 60_000),
		);
		const parsed = new URL(url);

		expect(parsed.searchParams.get("response-content-type")).toBe("audio/mpeg");
		expect(parsed.searchParams.get("response-content-disposition")).toContain(
			"attachment",
		);
		expect(parsed.searchParams.get("response-content-disposition")).toContain(
			"filename*=UTF-8''r%C3%A9union%201.mp3",
		);
	});

	it("intercepts HEAD, conditional COPY, and DELETE requests", async () => {
		const requests: CapturedRequest[] = [];
		const responses: ResponseSpec[] = [
			{
				statusCode: 200,
				headers: {
					"content-length": "42",
					etag: '"source-etag"',
					"content-type": "audio/mpeg",
				},
			},
			{
				statusCode: 200,
				body: new TextEncoder().encode("<CopyObjectResult/>"),
			},
			{ statusCode: 204 },
		];
		const service = new AssetStorageService(
			undefined,
			testClient(requests, responses),
		);

		expect(await service.head("assets", "temporary/upload-1")).toEqual({
			sizeBytes: 42,
			etag: '"source-etag"',
			contentType: "audio/mpeg",
		});
		await service.copy(
			"assets",
			"temporary/upload-1",
			"final/upload-1",
			'"source-etag"',
		);
		await service.delete("assets", "temporary/upload-1");

		expect(requests).toHaveLength(3);
		expect(requests[0]?.method).toBe("HEAD");
		expect(requests[1]?.method).toBe("PUT");
		expect(requests[1]?.headers["x-amz-copy-source"]).toContain(
			"assets/temporary/upload-1",
		);
		expect(requests[1]?.headers["x-amz-copy-source-if-match"]).toBe(
			'"source-etag"',
		);
		expect(requests[2]?.method).toBe("DELETE");
	});

	it("returns null when HEAD reports a missing object", async () => {
		const service = new AssetStorageService(
			undefined,
			testClient([], [], { statusCode: 404, headers: {} }),
		);

		expect(await service.head("assets", "temporary/missing")).toBeNull();
	});

	it("turns a changed source ETag into a state conflict", async () => {
		const service = new AssetStorageService(
			undefined,
			testClient([], [], {
				statusCode: 412,
				headers: {},
				body: new TextEncoder().encode("secret provider details"),
			}),
		);

		const promise = service.copy(
			"assets",
			"temporary/upload-1",
			"final/upload-1",
			'"old"',
		);
		await expect(promise).rejects.toMatchObject({
			status: 409,
			code: "SOURCE_ETAG_MISMATCH",
		});
		await expect(promise).rejects.not.toThrow("secret provider details");
	});

	it("redacts provider errors and keeps transient errors retryable", async () => {
		const service = new AssetStorageService(
			undefined,
			testClient(
				[],
				[],
				undefined,
				Object.assign(new Error("secret-key"), {
					$metadata: { httpStatusCode: 503 },
				}),
			),
		);

		const error = await service
			.delete("assets", "final/upload-1")
			.catch((value) => value);
		expect(error).toMatchObject({
			status: 503,
			code: "STORAGE_UNAVAILABLE",
			retryable: true,
		});
		expect(error.message).toBe("Object storage request failed.");
		expect(error.message).not.toContain("secret-key");
	});

	it("passes an aborted request signal and sanitizes the provider error", async () => {
		const requests: CapturedRequest[] = [];
		const controller = new AbortController();
		const service = new AssetStorageService(
			undefined,
			testClient(
				requests,
				[],
				undefined,
				Object.assign(new Error("secret provider details"), {
					name: "AbortError",
				}),
			),
		);

		controller.abort();
		const error = await service
			.delete("assets", "temporary/upload-1", controller.signal)
			.catch((value) => value);

		expect(requests[0]?.abortSignal).toBe(controller.signal);
		expect(error).toMatchObject({
			status: 503,
			code: "STORAGE_UNAVAILABLE",
			retryable: true,
		});
		expect(error.message).toBe("Object storage request failed.");
		expect(error.message).not.toContain("secret provider details");
	});

	it("rejects a PUT above the single-request R2 limit", async () => {
		const service = new AssetStorageService();

		await expect(
			service.presignPut(
				"assets",
				"temporary/upload-1",
				"application/octet-stream",
				ASSETS.maxSingleUploadBytes + 1,
				new Date(Date.now() + 60_000),
			),
		).rejects.toMatchObject({
			status: 413,
			code: "UPLOAD_TOO_LARGE",
			details: { maxBytes: 5363466240 },
		});
	});
});

function testClient(
	requests: CapturedRequest[],
	responses: ResponseSpec[],
	defaultResponse?: ResponseSpec,
	failure?: Error,
): S3Client {
	const requestHandler = {
		handle: async (
			request: CapturedRequest,
			options: { abortSignal?: AbortSignal },
		) => {
			requests.push({
				method: request.method,
				path: request.path,
				headers: request.headers,
				abortSignal: options.abortSignal,
			});
			if (failure) throw failure;
			const response = responses.shift() ??
				defaultResponse ?? { statusCode: 204 };
			return {
				response: {
					statusCode: response.statusCode,
					headers: response.headers ?? {},
					body: response.body ?? new Uint8Array(),
				},
			};
		},
	};

	return new S3Client({
		region: "auto",
		endpoint: "http://r2.test",
		forcePathStyle: true,
		credentials: { accessKeyId: "access-key", secretAccessKey: "secret-key" },
		maxAttempts: 1,
		requestChecksumCalculation: "WHEN_REQUIRED",
		responseChecksumValidation: "WHEN_REQUIRED",
		requestHandler: requestHandler as never,
	});
}
