import { DealStage } from "./generated/prisma/enums";

export const OPEN_DEAL_STAGES = [
	DealStage.LEAD,
	DealStage.ESTIMATING,
	DealStage.CONTRACTED,
	DealStage.IN_PROGRESS,
] as const;

export const CLOSED_DEAL_STAGES = [DealStage.COMPLETE, DealStage.LOST] as const;

export const LOSING_DEAL_STAGES = [DealStage.LOST] as const;

const CLOSED = new Set<DealStage>(CLOSED_DEAL_STAGES);

export function isClosedStage(stage: DealStage): boolean {
	return CLOSED.has(stage);
}
