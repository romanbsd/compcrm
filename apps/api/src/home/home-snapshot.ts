import { minorUnitsOf, normalizeCurrency } from "@crm/db/currency";
import { DealStage } from "@crm/db/enums";
import { HOME, LIFECYCLE_BY_STAGE, PRIORITY_RANK } from "./home.config";
import type {
	ActivitySummary,
	AttentionItem,
	HomeActor,
	HomeActorRole,
	HomeLifecycle,
	HomePriority,
	HomeSnapshot,
	ProjectSummary,
} from "./home.contracts";

export type HomeDeal = {
	id: string;
	name: string;
	stage: DealStage;
	amount: number | null;
	currency: string;
	baseAmount: number | null;
	baseCurrency: string | null;
	expectedCloseDate: Date | null;
	lastActivityAt: Date | null;
	companyName: string;
	meetingTodayAt: Date | null;
};

export type HomeApproval = {
	id: string;
	createdAt: Date;
	agentId: string;
	agentName: string;
	dealId: string | null;
	dealName: string | null;
	dealStage: DealStage | null;
	amount: number | null;
	currency: string;
	baseAmount: number | null;
	baseCurrency: string | null;
};

export type HomeTask = {
	id: string;
	subject: string;
	createdAt: Date;
	dueAt: Date | null;
	dealId: string | null;
	dealName: string | null;
};

export type HomeWork = {
	id: string;
	summary: string;
	occurredAt: Date;
	agentId: string;
	agentName: string;
	dealId: string | null;
};

export type HomeSnapshotInput = {
	now: Date;
	reportingCurrency: string;
	deals: HomeDeal[];
	approvals: HomeApproval[];
	tasks: HomeTask[];
	recentWork: HomeWork[];
};

export function assembleHomeSnapshot(input: HomeSnapshotInput): HomeSnapshot {
	const attention = rankAttention([
		...input.approvals.flatMap((row) =>
			attentionFromApproval(row, input.reportingCurrency),
		),
		...input.tasks.flatMap((row) => attentionFromTask(row, input.now)),
	]);
	const attentionDealIds = new Set(attention.map((row) => row.projectId));

	return {
		activeProjectCount: input.deals.length,
		attentionCount: attention.length,
		unreadNotificationCount: HOME.unreadNotificationCount,
		attention: attention.slice(0, HOME.previewLimit),
		projects: rankProjects(input.deals, attentionDealIds, input.now).slice(
			0,
			HOME.previewLimit,
		),
		recentWork: selectRecentWork(input.recentWork),
	};
}

export function homeActorFromName(id: string, name: string): HomeActor {
	return { id, name, role: actorRole(name) };
}

export function formatHomeMoney(amount: number, currency: string): string {
	const code = normalizeCurrency(currency);
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: code,
		minimumFractionDigits: 0,
		maximumFractionDigits: minorUnitsOf(code),
	}).format(amount);
}

function actorRole(name: string): HomeActorRole {
	const value = name.toLowerCase();
	if (/\bsecretary\b|\breception\b|\binbox\b/.test(value)) return "secretary";
	if (/\bcfo\b|\bfinance\b|\bbookkeep/.test(value)) return "cfo";
	if (/\bproject\s*manager\b|\bpm\b|\bbob\b/.test(value)) {
		return "projectManager";
	}
	return "system";
}

function lifecycleFor(stage: DealStage): HomeLifecycle | null {
	switch (stage) {
		case DealStage.DEMO_BOOKED:
			return LIFECYCLE_BY_STAGE[DealStage.DEMO_BOOKED];
		case DealStage.QUALIFIED_TO_BUY:
			return LIFECYCLE_BY_STAGE[DealStage.QUALIFIED_TO_BUY];
		case DealStage.DECISION_MAKER_BOUGHT_IN:
			return LIFECYCLE_BY_STAGE[DealStage.DECISION_MAKER_BOUGHT_IN];
		case DealStage.CONTRACT_SENT:
			return LIFECYCLE_BY_STAGE[DealStage.CONTRACT_SENT];
		default:
			return null;
	}
}

function attentionFromApproval(
	row: HomeApproval,
	reportingCurrency: string,
): AttentionItem[] {
	if (!row.dealId || !row.dealName || !row.dealStage) return [];

	const proposal =
		row.dealStage === DealStage.QUALIFIED_TO_BUY ||
		row.dealStage === DealStage.CONTRACT_SENT;
	const keyValue = moneyFor(row, reportingCurrency);

	if (proposal) {
		return [
			{
				id: row.id,
				projectId: row.dealId,
				projectName: row.dealName,
				actor: homeActorFromName(row.agentId, row.agentName),
				title: "Proposal ready for approval",
				keyValue,
				supportingText: null,
				actionLabel: "Review proposal",
				action: "reviewProposal",
				createdAt: row.createdAt.toISOString(),
				priority: "customerApproval",
			},
		];
	}

	if (row.dealStage === DealStage.DEMO_BOOKED) {
		return [
			{
				id: row.id,
				projectId: row.dealId,
				projectName: row.dealName,
				actor: homeActorFromName(row.agentId, row.agentName),
				title: "An update is ready for review",
				keyValue: null,
				supportingText: null,
				actionLabel: "Review update",
				action: "reviewUpdate",
				createdAt: row.createdAt.toISOString(),
				priority: "ordinary",
			},
		];
	}

	return [
		{
			id: row.id,
			projectId: row.dealId,
			projectName: row.dealName,
			actor: homeActorFromName(row.agentId, row.agentName),
			title: "Needs your approval",
			keyValue,
			supportingText: null,
			actionLabel: "Review",
			action: "other",
			createdAt: row.createdAt.toISOString(),
			priority: "ordinary",
		},
	];
}

function attentionFromTask(row: HomeTask, now: Date): AttentionItem[] {
	if (!row.dealId || !row.dealName) return [];

	return [
		{
			id: row.id,
			projectId: row.dealId,
			projectName: row.dealName,
			actor: { id: "system", name: "System", role: "system" },
			title: row.subject,
			keyValue: null,
			supportingText: null,
			actionLabel: "Reply",
			action: "reply",
			createdAt: row.createdAt.toISOString(),
			priority: taskPriority(row.dueAt, now),
		},
	];
}

function taskPriority(dueAt: Date | null, now: Date): HomePriority {
	if (dueAt && dueAt.getTime() < now.getTime()) return "blocked";
	if (dueAt && sameUtcDay(dueAt, now)) return "schedule";
	return "ordinary";
}

function rankAttention(items: AttentionItem[]): AttentionItem[] {
	return items.toSorted((left, right) => {
		const byPriority =
			PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
		if (byPriority !== 0) return byPriority;
		return right.createdAt.localeCompare(left.createdAt);
	});
}

function rankProjects(
	deals: HomeDeal[],
	attentionDealIds: Set<string>,
	now: Date,
): ProjectSummary[] {
	return deals
		.flatMap((row) => {
			const lifecycle = lifecycleFor(row.stage);
			if (!lifecycle) return [];
			const needsUserAttention = attentionDealIds.has(row.id);
			return [
				{
					id: row.id,
					name: row.name,
					customerName: row.companyName,
					lifecycle,
					operationalState: operationalState(row, needsUserAttention, now),
					needsUserAttention,
					rank: projectRank(row, needsUserAttention, now),
					activity: row.lastActivityAt?.getTime() ?? 0,
				},
			];
		})
		.toSorted((left, right) => {
			if (left.rank !== right.rank) return left.rank - right.rank;
			return right.activity - left.activity;
		})
		.map(({ rank: _rank, activity: _activity, ...project }) => project);
}

function projectRank(
	row: HomeDeal,
	needsUserAttention: boolean,
	now: Date,
): number {
	if (needsUserAttention) return 0;
	if (row.meetingTodayAt || isToday(row.expectedCloseDate, now)) return 1;
	return 2;
}

function operationalState(
	row: HomeDeal,
	needsUserAttention: boolean,
	now: Date,
): string {
	if (needsUserAttention) return "Waiting for your approval";
	if (row.meetingTodayAt) {
		return `Meeting today · ${formatTime(row.meetingTodayAt)}`;
	}
	if (isToday(row.expectedCloseDate, now)) return "Close date today";
	if (row.expectedCloseDate) {
		return `Close ${formatDay(row.expectedCloseDate)}`;
	}
	return "No close date set";
}

function selectRecentWork(rows: HomeWork[]): ActivitySummary[] {
	const newest = rows
		.filter((row) => row.summary.trim().length > 0)
		.toSorted(
			(left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
		);

	const chosen: HomeWork[] = [];
	const roles = new Set<HomeActorRole>();

	for (const row of newest) {
		if (chosen.length >= HOME.previewLimit) break;
		const role = actorRole(row.agentName);
		if (
			roles.has(role) &&
			newest.some(
				(candidate) =>
					!roles.has(actorRole(candidate.agentName)) &&
					!chosen.includes(candidate),
			)
		) {
			continue;
		}
		chosen.push(row);
		roles.add(role);
	}

	return chosen.map((row) => ({
		id: row.id,
		actor: homeActorFromName(row.agentId, row.agentName),
		description: row.summary.trim(),
		occurredAt: row.occurredAt.toISOString(),
		projectId: row.dealId,
	}));
}

function moneyFor(
	row: Pick<
		HomeApproval,
		"amount" | "currency" | "baseAmount" | "baseCurrency"
	>,
	reportingCurrency: string,
): string | null {
	if (
		row.baseAmount !== null &&
		row.baseCurrency &&
		normalizeCurrency(row.baseCurrency) === normalizeCurrency(reportingCurrency)
	) {
		return formatHomeMoney(row.baseAmount, reportingCurrency);
	}
	if (row.amount !== null) return formatHomeMoney(row.amount, row.currency);
	return null;
}

function isToday(value: Date | null, now: Date): boolean {
	return value ? sameUtcDay(value, now) : false;
}

function sameUtcDay(left: Date, right: Date): boolean {
	return (
		left.getUTCFullYear() === right.getUTCFullYear() &&
		left.getUTCMonth() === right.getUTCMonth() &&
		left.getUTCDate() === right.getUTCDate()
	);
}

function formatTime(value: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		minute: "2-digit",
		timeZone: "UTC",
	}).format(value);
}

function formatDay(value: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	}).format(value);
}
