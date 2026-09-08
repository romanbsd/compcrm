import {
	CopyObjectCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { EnvironmentVariables } from "../config/env.validation";
import { ASSETS } from "./asset-config";
import { AssetError } from "./asset-error";

export type AssetStorageHead = {
	sizeBytes: number;
	etag: string;
	contentType: string | null;
};

type R2Config = {
	accountId?: string;
	accessKeyId?: string;
	secretAccessKey?: string;
	bucket?: string;
};

const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const s3ErrorSchema = z.object({
	$metadata: z
		.object({ httpStatusCode: z.number().int().optional() })
		.optional(),
	Code: z.string().optional(),
	code: z.string().optional(),
	name: z.string().optional(),
	statusCode: z.number().int().optional(),
});
type S3Error = z.infer<typeof s3ErrorSchema>;

@Injectable()
export class AssetStorageService {
	private readonly r2: R2Config;
	private readonly client: S3Client | null;

	constructor(
		@Optional() config?: ConfigService<EnvironmentVariables, false>,
		@Optional() client?: S3Client,
	) {
		this.r2 = readR2Config(config);
		this.client = client ?? this.createClient();
	}

	configured(): boolean {
		return Boolean(
			this.r2.accountId &&
				this.r2.accessKeyId &&
				this.r2.secretAccessKey &&
				this.r2.bucket,
		);
	}

	bucket(): string {
		if (!this.r2.bucket) {
			throw new AssetError(
				503,
				"STORAGE_UNAVAILABLE",
				"Object storage is not configured.",
				undefined,
				false,
			);
		}

		return this.r2.bucket;
	}

	async presignPut(
		bucket: string,
		key: string,
		contentType: string,
		sizeBytes: number,
		expiresAt: Date,
	): Promise<string> {
		this.requireUploadSize(sizeBytes);
		const expiresIn = expiresInSeconds(expiresAt);
		const client = this.requireClient();
		this.requireBucket(bucket);

		try {
			return await getSignedUrl(
				client,
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					ContentType: contentType || DEFAULT_CONTENT_TYPE,
					ContentLength: sizeBytes,
				}),
				{
					expiresIn,
					signableHeaders: new Set(["content-length", "content-type"]),
				},
			);
		} catch (error) {
			throw storageError(parseS3Error(error));
		}
	}

	async presignGet(
		bucket: string,
		key: string,
		fileName: string,
		contentType: string,
		expiresAt: Date,
	): Promise<string> {
		const expiresIn = expiresInSeconds(expiresAt);
		const client = this.requireClient();
		this.requireBucket(bucket);

		try {
			return await getSignedUrl(
				client,
				new GetObjectCommand({
					Bucket: bucket,
					Key: key,
					ResponseContentDisposition: contentDisposition(fileName),
					ResponseContentType: contentType || DEFAULT_CONTENT_TYPE,
				}),
				{ expiresIn },
			);
		} catch (error) {
			throw storageError(parseS3Error(error));
		}
	}

	async head(
		bucket: string,
		key: string,
		signal?: AbortSignal,
	): Promise<AssetStorageHead | null> {
		const client = this.requireClient();
		this.requireBucket(bucket);

		try {
			const response = await client.send(
				new HeadObjectCommand({ Bucket: bucket, Key: key }),
				{ abortSignal: signal },
			);
			if (response.ContentLength === undefined || !response.ETag) {
				throw new AssetError(
					503,
					"STORAGE_UNAVAILABLE",
					"Object storage returned incomplete metadata.",
					undefined,
					false,
				);
			}

			return {
				sizeBytes: response.ContentLength,
				etag: response.ETag,
				contentType: response.ContentType ?? null,
			};
		} catch (error) {
			if (error instanceof AssetError) throw error;
			const parsedError = parseS3Error(error);
			if (isNotFound(parsedError)) return null;
			throw storageError(parsedError);
		}
	}

	async copy(
		bucket: string,
		sourceKey: string,
		finalKey: string,
		sourceEtag: string,
		signal?: AbortSignal,
	): Promise<void> {
		const client = this.requireClient();
		this.requireBucket(bucket);

		try {
			await client.send(
				new CopyObjectCommand({
					Bucket: bucket,
					Key: finalKey,
					CopySource: `${bucket}/${sourceKey}`,
					CopySourceIfMatch: sourceEtag,
				}),
				{ abortSignal: signal },
			);
		} catch (error) {
			const parsedError = parseS3Error(error);
			if (isPreconditionFailure(parsedError)) {
				throw new AssetError(
					409,
					"SOURCE_ETAG_MISMATCH",
					"The source object changed before finalization.",
					undefined,
					false,
				);
			}
			throw storageError(parsedError);
		}
	}

	async delete(
		bucket: string,
		key: string,
		signal?: AbortSignal,
	): Promise<void> {
		const client = this.requireClient();
		this.requireBucket(bucket);

		try {
			await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
				abortSignal: signal,
			});
		} catch (error) {
			throw storageError(parseS3Error(error));
		}
	}

	private createClient(): S3Client | null {
		if (!this.configured()) return null;

		return new S3Client({
			region: "auto",
			endpoint: `https://${this.r2.accountId}.r2.cloudflarestorage.com`,
			credentials: {
				accessKeyId: this.r2.accessKeyId as string,
				secretAccessKey: this.r2.secretAccessKey as string,
			},
			maxAttempts: 1,
			requestChecksumCalculation: "WHEN_REQUIRED",
			responseChecksumValidation: "WHEN_REQUIRED",
			requestHandler: {
				connectionTimeout: ASSETS.network.connectionTimeoutMs,
				requestTimeout: ASSETS.network.requestTimeoutMs,
				throwOnRequestTimeout: true,
			},
		});
	}

	private requireClient(): S3Client {
		if (!this.configured() || !this.client) {
			throw new AssetError(
				503,
				"STORAGE_UNAVAILABLE",
				"Object storage is not configured.",
				undefined,
				false,
			);
		}

		return this.client;
	}

	private requireBucket(bucket: string): void {
		if (!bucket.trim()) {
			throw new AssetError(
				400,
				"VALIDATION_ERROR",
				"A storage bucket is required.",
				undefined,
				false,
			);
		}
	}

	private requireUploadSize(sizeBytes: number): void {
		if (
			!Number.isSafeInteger(sizeBytes) ||
			sizeBytes < 0 ||
			sizeBytes > ASSETS.maxSingleUploadBytes
		) {
			throw new AssetError(
				413,
				"UPLOAD_TOO_LARGE",
				"The file exceeds the single-upload limit.",
				{ maxBytes: ASSETS.maxSingleUploadBytes },
				false,
			);
		}
	}
}

function readR2Config(
	config?: ConfigService<EnvironmentVariables, false>,
): R2Config {
	return {
		accountId: readConfigValue(config, "R2_ACCOUNT_ID"),
		accessKeyId: readConfigValue(config, "R2_ACCESS_KEY_ID"),
		secretAccessKey: readConfigValue(config, "R2_SECRET_ACCESS_KEY"),
		bucket: readConfigValue(config, "R2_BUCKET"),
	};
}

function readConfigValue(
	config: ConfigService<EnvironmentVariables, false> | undefined,
	key: keyof Pick<
		EnvironmentVariables,
		"R2_ACCOUNT_ID" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_BUCKET"
	>,
): string | undefined {
	const configured = config?.get<string>(key);
	const value = configured ?? process.env[key];
	const normalized = value?.trim();
	return normalized || undefined;
}

function expiresInSeconds(expiresAt: Date): number {
	const remainingMs = expiresAt.getTime() - Date.now();
	const seconds = Math.ceil(remainingMs / 1_000);

	if (
		!Number.isFinite(seconds) ||
		seconds < 1 ||
		seconds > ASSETS.maxPresignSeconds
	) {
		throw new AssetError(
			400,
			"INVALID_EXPIRY",
			"The storage grant expiry is invalid.",
			{ maxSeconds: ASSETS.maxPresignSeconds },
			false,
		);
	}

	return seconds;
}

function contentDisposition(fileName: string): string {
	const fallback =
		fileName
			.normalize("NFKD")
			.replace(/[^\x20-\x7e]/g, "_")
			.replace(/[\\"]/g, "_") || "download";
	const encoded = encodeURIComponent(fileName).replace(
		/[!'()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);

	return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function parseS3Error(cause: unknown): S3Error {
	const parsed = s3ErrorSchema.safeParse(cause);
	return parsed.success ? parsed.data : {};
}

function statusCode(error: S3Error): number | undefined {
	return error.$metadata?.httpStatusCode ?? error.statusCode;
}

function errorName(error: S3Error): string | undefined {
	return error.name ?? error.Code ?? error.code;
}

function isNotFound(error: S3Error): boolean {
	const status = statusCode(error);
	const name = errorName(error);
	return (
		status === 404 ||
		name === "NotFound" ||
		name === "NoSuchKey" ||
		name === "NoSuchObject"
	);
}

function isPreconditionFailure(error: S3Error): boolean {
	const status = statusCode(error);
	const name = errorName(error);
	return status === 412 || name === "PreconditionFailed";
}

function storageError(error: S3Error): AssetError {
	const status = statusCode(error);
	const retryable = status === undefined || status >= 500 || status === 429;
	return new AssetError(
		503,
		"STORAGE_UNAVAILABLE",
		"Object storage request failed.",
		undefined,
		retryable,
	);
}
