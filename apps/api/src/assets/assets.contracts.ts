import { z } from "zod";

export const assetId = z.string().min(1).max(128);
export const assetSource = z.enum([
	"MANUAL",
	"MOBILE_RECORDING",
	"EMAIL_ATTACHMENT",
]);
export const emailSource = z.strictObject({
	messageId: z.string().min(1).max(255),
	attachmentId: z.string().min(1).max(255),
});
export const createUploadInput = z
	.strictObject({
		fileName: z
			.string()
			.min(1)
			.max(255)
			.regex(/^[^/\\\p{Cc}]+$/u),
		contentType: z
			.string()
			.min(1)
			.max(255)
			.regex(/^[^\p{Cc}]+$/u)
			.default("application/octet-stream"),
		sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
		kind: z.string().min(1).max(64).default("file"),
		source: assetSource,
		activityId: assetId.nullable().optional(),
		durationMilliseconds: z
			.number()
			.int()
			.nonnegative()
			.max(Number.MAX_SAFE_INTEGER)
			.nullable()
			.optional(),
		capturedAt: z.iso.datetime({ offset: true }).nullable().optional(),
		emailSource: emailSource.nullable().optional(),
	})
	.superRefine((input, context) => {
		if ((input.source === "EMAIL_ATTACHMENT") !== (input.emailSource != null)) {
			context.addIssue({
				code: "custom",
				path: ["emailSource"],
				message:
					"Email attachments require an email source. Other sources cannot include one.",
			});
		}
	});
export type CreateUploadInput = z.infer<typeof createUploadInput>;
export const projectUploadCreateInput = createUploadInput.safeExtend({
	projectId: assetId,
});
export const projectUploadInput = z.strictObject({
	projectId: assetId,
	uploadId: assetId,
});
export const projectAssetInput = z.strictObject({
	projectId: assetId,
	assetId,
});

export const assetListInput = z.strictObject({
	page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
	activityId: assetId.optional(),
	kind: z.string().min(1).max(64).optional(),
	source: assetSource.optional(),
});
export const customerAssetListInput = assetListInput.extend({
	projectId: assetId.optional(),
});
export type AssetListInput = z.infer<typeof customerAssetListInput>;
export const projectAssetListInput = assetListInput.extend({
	projectId: assetId,
});
export const customerAssetListArgs = customerAssetListInput.extend({
	customerId: assetId,
});

export const uploadSchema = z.object({
	id: assetId,
	customerId: assetId,
	projectId: assetId,
	status: z.enum([
		"PENDING",
		"FINALIZING",
		"READY",
		"FAILED",
		"CANCELED",
		"EXPIRED",
	]),
	expiresAt: z.iso.datetime(),
	assetId: assetId.nullable(),
	failure: z
		.object({
			code: z.enum([
				"UPLOAD_VERIFICATION_FAILED",
				"UPLOAD_FINALIZATION_FAILED",
			]),
			message: z.string(),
		})
		.nullable(),
});
export const uploadGrantSchema = z.object({
	upload: uploadSchema,
	transfer: z
		.object({
			method: z.literal("PUT"),
			url: z.url(),
			headers: z.object({
				"Content-Type": z.string(),
				"Content-Length": z.string(),
			}),
			expiresAt: z.iso.datetime(),
			maxBytes: z.number().int(),
		})
		.nullable(),
});
export const uploadStateSchema = z.object({
	upload: uploadSchema,
	pollAfterSeconds: z.number().int().nullable(),
});
export const uploadConfirmationSchema = z.object({
	uploadId: assetId,
	statusUrl: z.string(),
});
export const uploadCancellationSchema = z.object({
	uploadId: assetId,
	status: z.literal("CANCELED"),
});

export const assetSchema = z.object({
	id: assetId,
	customerId: assetId,
	projectId: assetId,
	activityId: assetId.nullable(),
	fileName: z.string(),
	contentType: z.string(),
	sizeBytes: z.number().int().nonnegative().nullable(),
	kind: z.string(),
	source: assetSource.nullable(),
	emailSource: emailSource.nullable(),
	uploadedById: assetId.nullable(),
	durationMilliseconds: z.number().int().nonnegative().nullable(),
	capturedAt: z.iso.datetime().nullable(),
	createdAt: z.iso.datetime(),
	status: z.enum(["UNVERIFIED", "READY", "DELETING", "DELETED"]),
	deletedAt: z.iso.datetime().nullable(),
});
export const assetDetailSchema = z.object({ asset: assetSchema });
export const assetListSchema = z.object({
	items: z.array(assetSchema),
	page: z.number().int(),
	pageSize: z.number().int(),
	total: z.number().int(),
	hasNextPage: z.boolean(),
});
export const assetDownloadSchema = z.object({
	assetId,
	url: z.url(),
	method: z.literal("GET"),
	headers: z.object({}),
	expiresAt: z.iso.datetime(),
	fileName: z.string(),
	contentType: z.string(),
	sizeBytes: z.number().int().nonnegative(),
});
export const assetDeletionSchema = z.object({
	assetId,
	status: z.enum(["DELETING", "DELETED"]),
});

export const assetErrorEnvelopeSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		requestId: z.string(),
		retryable: z.boolean(),
		details: z
			.object({
				state: z.string().optional(),
				maxBytes: z.number().optional(),
				fields: z
					.array(z.object({ field: z.string(), message: z.string() }))
					.optional(),
			})
			.optional(),
	}),
});
