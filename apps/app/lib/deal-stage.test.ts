import { describe, expect, it } from "bun:test";
import { DealStage } from "@crm/db/enums";
import {
	DEAL_STAGE_OPTIONS,
	dealStageLabel,
	isClosedStage,
	OPEN_STAGES,
} from "./deal-stage";

describe("project statuses", () => {
	it("lists the construction workflow in order", () => {
		expect(DEAL_STAGE_OPTIONS).toEqual([
			{ value: DealStage.LEAD, label: "Lead" },
			{ value: DealStage.ESTIMATING, label: "Estimating" },
			{ value: DealStage.CONTRACTED, label: "Contracted" },
			{ value: DealStage.IN_PROGRESS, label: "In progress" },
			{ value: DealStage.COMPLETE, label: "Complete" },
			{ value: DealStage.LOST, label: "Lost" },
		]);
	});

	it("treats complete and lost projects as closed", () => {
		expect(OPEN_STAGES).toEqual([
			DealStage.LEAD,
			DealStage.ESTIMATING,
			DealStage.CONTRACTED,
			DealStage.IN_PROGRESS,
		]);
		expect(isClosedStage(DealStage.COMPLETE)).toBe(true);
		expect(isClosedStage(DealStage.LOST)).toBe(true);
		expect(isClosedStage(DealStage.IN_PROGRESS)).toBe(false);
		expect(dealStageLabel(DealStage.COMPLETE)).toBe("Complete");
	});
});
