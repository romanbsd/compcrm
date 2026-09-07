import { z } from "zod";

export const workspaceGate = z.object({
	organizationId: z.string().min(1).nullable(),
	slug: z.string().min(1).nullable(),
	onboarded: z.boolean().nullable(),
	canRename: z.boolean().nullable(),
});

export type WorkspaceGate = z.infer<typeof workspaceGate>;
