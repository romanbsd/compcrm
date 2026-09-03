import { DealStage } from "@crm/db/enums";
import type { HomeLifecycle, HomePriority } from "./home.contracts";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const HOME = {
	previewLimit: 3,
	unreadNotificationCount: 0,
	recentWorkPool: 12,
	dayMs: DAY_MS,
} as const;

export const LIFECYCLE_BY_STAGE = {
	[DealStage.DEMO_BOOKED]: "discovery",
	[DealStage.QUALIFIED_TO_BUY]: "proposal",
	[DealStage.DECISION_MAKER_BOUGHT_IN]: "preConstruction",
	[DealStage.CONTRACT_SENT]: "inProgress",
} as const satisfies Partial<Record<DealStage, HomeLifecycle>>;

export const PRIORITY_RANK = {
	blocked: 0,
	customerApproval: 1,
	financial: 2,
	schedule: 3,
	ordinary: 4,
} as const satisfies Record<HomePriority, number>;
