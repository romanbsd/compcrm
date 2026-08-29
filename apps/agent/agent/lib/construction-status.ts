const CONSTRUCTION_STATUS = {
	DEMO_BOOKED: "Lead",
	QUALIFIED_TO_BUY: "Estimating",
	CONTRACT_SENT: "Contracted",
	DECISION_MAKER_BOUGHT_IN: "In progress",
	CLOSED_WON: "Complete",
	CLOSED_LOST: "Lost",
	UNQUALIFIED_TO_BUY: "Disqualified",
} as const satisfies Record<string, string>;

export function constructionStatus(stage: string): string {
	if (!Object.hasOwn(CONSTRUCTION_STATUS, stage)) return stage;
	return CONSTRUCTION_STATUS[stage as keyof typeof CONSTRUCTION_STATUS];
}
