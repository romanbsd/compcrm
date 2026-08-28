import { z } from "zod";

export const jsonObjectSchema = z.record(z.string(), z.json());
export const exportJsonValueSchema = z.json();

export const exportInvocationSchema = z
	.object({
		requestId: z.string().trim().min(1).max(160),
		operation: z.string().trim().min(1).max(128),
		caller: z.string().trim().min(1).max(3071).optional(),
	})
	.strict();

export const exportInvocationRequestSchema = exportInvocationSchema.extend({
	arguments: exportJsonValueSchema,
});

export const exportProgressSchema = z
	.object({
		stage: z.string().optional(),
		percent: z.number().optional(),
		message: z.string().optional(),
	})
	.strict();

const exportIssueSchema = z
	.object({
		path: z.string(),
		message: z.string(),
	})
	.strict();

export const exportStreamEventSchema = z.discriminatedUnion("type", [
	z
		.object({ type: z.literal("progress"), update: exportProgressSchema })
		.strict(),
	z
		.object({
			type: z.literal("result"),
			value: exportJsonValueSchema,
			sessionId: z.string().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("error"),
			error: z
				.object({
					code: z.string(),
					message: z.string(),
					issues: z.array(exportIssueSchema).optional(),
				})
				.strict(),
		})
		.strict(),
]);

export type ExportInvocation = z.infer<typeof exportInvocationSchema>;
export type ExportProgress = z.infer<typeof exportProgressSchema>;
export type ExportStreamEvent = z.infer<typeof exportStreamEventSchema>;
export type ExportJsonObject = z.infer<typeof jsonObjectSchema>;
export type ExportJsonValue = z.infer<typeof exportJsonValueSchema>;
