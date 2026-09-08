import { HttpException } from "@nestjs/common";
import { z } from "zod";

const assetErrorDetails = z.object({
	state: z.string().optional(),
	maxBytes: z.number().optional(),
	maxSeconds: z.number().optional(),
	fields: z
		.array(z.object({ field: z.string(), message: z.string() }))
		.optional(),
});
export type AssetErrorDetails = z.infer<typeof assetErrorDetails>;

export class AssetError extends HttpException {
	constructor(
		status: number,
		readonly code: string,
		message: string,
		readonly details?: AssetErrorDetails,
		readonly retryable = false,
	) {
		super({ code, message, details, retryable }, status);
		this.name = "AssetError";
	}
}
