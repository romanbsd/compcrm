import { z } from "zod";
import {
	activitySummary,
	attentionItem,
	homeActor,
	homeSnapshot,
	projectSummary,
} from "./home.contracts";

export const HOME_OPENAPI_SCHEMAS = {
	HomeActor: z.toJSONSchema(homeActor),
	AttentionItem: z.toJSONSchema(attentionItem),
	ProjectSummary: z.toJSONSchema(projectSummary),
	ActivitySummary: z.toJSONSchema(activitySummary),
	HomeSnapshot: z.toJSONSchema(homeSnapshot),
} as const;
