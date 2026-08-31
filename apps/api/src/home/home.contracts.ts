import { z } from "zod";

export const homeActorRole = z.enum([
	"secretary",
	"projectManager",
	"cfo",
	"system",
]);

export const homeAttentionAction = z.enum([
	"reviewProposal",
	"reviewUpdate",
	"reply",
	"approveChangeOrder",
	"reviewExpense",
	"selectSubcontractor",
	"reviewPayment",
	"other",
]);

export const homePriority = z.enum([
	"blocked",
	"customerApproval",
	"financial",
	"schedule",
	"ordinary",
]);

export const homeLifecycle = z.enum([
	"discovery",
	"proposal",
	"preConstruction",
	"inProgress",
	"finishing",
]);

export const homeActor = z.object({
	id: z.string(),
	name: z.string(),
	role: homeActorRole,
});

export const attentionItem = z.object({
	id: z.string(),
	projectId: z.string(),
	projectName: z.string(),
	actor: homeActor,
	title: z.string(),
	keyValue: z.string().nullable(),
	supportingText: z.string().nullable(),
	actionLabel: z.string(),
	action: homeAttentionAction,
	createdAt: z.string(),
	priority: homePriority,
});

export const projectSummary = z.object({
	id: z.string(),
	name: z.string(),
	customerName: z.string(),
	lifecycle: homeLifecycle,
	operationalState: z.string(),
	needsUserAttention: z.boolean(),
});

export const activitySummary = z.object({
	id: z.string(),
	actor: homeActor,
	description: z.string(),
	occurredAt: z.string(),
	projectId: z.string().nullable(),
});

export const homeSnapshot = z.object({
	activeProjectCount: z.number().int().nonnegative(),
	attentionCount: z.number().int().nonnegative(),
	unreadNotificationCount: z.number().int().nonnegative(),
	attention: z.array(attentionItem),
	projects: z.array(projectSummary),
	recentWork: z.array(activitySummary),
});

export type HomeActorRole = z.infer<typeof homeActorRole>;
export type HomeAttentionAction = z.infer<typeof homeAttentionAction>;
export type HomePriority = z.infer<typeof homePriority>;
export type HomeLifecycle = z.infer<typeof homeLifecycle>;
export type HomeActor = z.infer<typeof homeActor>;
export type AttentionItem = z.infer<typeof attentionItem>;
export type ProjectSummary = z.infer<typeof projectSummary>;
export type ActivitySummary = z.infer<typeof activitySummary>;
export type HomeSnapshot = z.infer<typeof homeSnapshot>;
