import { z } from "zod";

export const pushPlatformSchema = z.enum(["ios", "android"]);

export const registerPushTokenInput = z.object({
	token: z.string().trim().min(1),
	platform: pushPlatformSchema,
});

export type RegisterPushTokenInput = z.infer<typeof registerPushTokenInput>;
