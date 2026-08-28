import { DealStage } from "@crm/db/enums";
import type { StatusTone } from "@crm/ui/components/status-indicator";

const ORDER = [
	DealStage.LEAD,
	DealStage.ESTIMATING,
	DealStage.CONTRACTED,
	DealStage.IN_PROGRESS,
	DealStage.COMPLETE,
	DealStage.LOST,
] as const;

type DealStagePresentation = Record<
	DealStage,
	{ label: string; tone: StatusTone }
>;

const PRESENTATION: DealStagePresentation = {
	LEAD: { label: "Lead", tone: "neutral" },
	ESTIMATING: { label: "Estimating", tone: "info" },
	CONTRACTED: { label: "Contracted", tone: "warning" },
	IN_PROGRESS: { label: "In progress", tone: "info" },
	COMPLETE: { label: "Complete", tone: "success" },
	LOST: { label: "Lost", tone: "error" },
};

export const OPEN_STAGES = ORDER.slice(0, 4) as readonly DealStage[];

export const LOSING_STAGES: readonly DealStage[] = [DealStage.LOST];

export const DEAL_STAGE_OPTIONS = ORDER.map((value) => ({
	value,
	label: PRESENTATION[value].label,
}));

const OPEN_STAGE_COLORS = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
] as const;

export function isClosedStage(stage: DealStage): boolean {
	return !OPEN_STAGES.includes(stage);
}

export function dealStageColor(stage: DealStage): string {
	return OPEN_STAGE_COLORS[OPEN_STAGES.indexOf(stage)] ?? "var(--chart-5)";
}

export function dealStageLabel(stage: DealStage): string {
	return PRESENTATION[stage].label;
}

export function dealStagePresentation(stage: DealStage) {
	return PRESENTATION[stage];
}
