import { z } from "zod";

const apiKeyPrincipalMetadata = z.object({
	createdByUserId: z.string().trim().min(1),
});

export function parseApiKeyPrincipalMetadata(value: unknown): {
	createdByUserId: string;
} {
	return apiKeyPrincipalMetadata.parse(value);
}
