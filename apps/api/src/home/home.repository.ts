import { ActivityType, type Db } from "@crm/db";
import { OPEN_DEAL_STAGES } from "@crm/db/deal-stage";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import { HOME } from "./home.config";
import type {
	HomeApproval,
	HomeDeal,
	HomeTask,
	HomeWork,
} from "./home-snapshot";

const runDealInput = z
	.object({
		dealId: z.string().trim().min(1).optional(),
	})
	.passthrough();

@Injectable()
export class HomeRepository {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async load(
		userId: string,
		now: Date,
	): Promise<{
		deals: HomeDeal[];
		approvals: HomeApproval[];
		tasks: HomeTask[];
		recentWork: HomeWork[];
	}> {
		const dayStart = utcDayStart(now);
		const dayEnd = new Date(dayStart.getTime() + HOME.dayMs);
		const open = {
			stage: { in: [...OPEN_DEAL_STAGES] },
			archivedAt: null,
		};

		const [dealRows, approvalRows, taskRows, meetingRows, workRows] =
			await Promise.all([
				this.db.deal.findMany({
					where: open,
					select: {
						id: true,
						name: true,
						stage: true,
						amount: true,
						currency: true,
						baseAmount: true,
						baseCurrency: true,
						expectedCloseDate: true,
						lastActivityAt: true,
						company: { select: { name: true } },
					},
				}),
				this.db.agentRun.findMany({
					where: { status: "WAITING_FOR_APPROVAL" },
					select: {
						id: true,
						createdAt: true,
						agentId: true,
						sessionId: true,
						input: true,
						agent: { select: { name: true } },
						actions: {
							select: { targetType: true, targetId: true },
						},
					},
				}),
				this.db.activity.findMany({
					where: {
						type: ActivityType.TASK,
						completedAt: null,
						createdById: userId,
						dealId: { not: null },
						deal: open,
					},
					select: {
						id: true,
						subject: true,
						createdAt: true,
						dueAt: true,
						dealId: true,
						deal: { select: { name: true } },
					},
				}),
				this.db.activity.findMany({
					where: {
						type: ActivityType.MEETING,
						dealId: { not: null },
						deal: open,
						calendarEvent: {
							startsAt: { gte: dayStart, lt: dayEnd },
						},
					},
					select: {
						dealId: true,
						calendarEvent: { select: { startsAt: true } },
					},
				}),
				this.db.agentRun.findMany({
					where: {
						status: "SUCCEEDED",
						summary: { not: null },
					},
					orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
					take: HOME.recentWorkPool,
					select: {
						id: true,
						summary: true,
						finishedAt: true,
						createdAt: true,
						agentId: true,
						sessionId: true,
						input: true,
						agent: { select: { name: true } },
					},
				}),
			]);

		const sessionIds = [
			...approvalRows.map((row) => row.sessionId),
			...workRows.map((row) => row.sessionId),
		].filter((id): id is string => Boolean(id));

		const conversations =
			sessionIds.length === 0
				? []
				: await this.db.agentConversation.findMany({
						where: { sessionId: { in: sessionIds }, dealId: { not: null } },
						select: { sessionId: true, dealId: true },
					});

		const dealIdBySession = new Map(
			conversations.flatMap((row) =>
				row.sessionId && row.dealId
					? [[row.sessionId, row.dealId] as const]
					: [],
			),
		);

		const approvalDealIds = [
			...new Set(
				approvalRows.flatMap((row) => {
					const id = dealIdForRun(row, dealIdBySession);
					return id ? [id] : [];
				}),
			),
		];

		const dealById = new Map(dealRows.map((row) => [row.id, row]));
		const missingDealIds = approvalDealIds.filter((id) => !dealById.has(id));
		if (missingDealIds.length > 0) {
			const extra = await this.db.deal.findMany({
				where: { id: { in: missingDealIds }, ...open },
				select: {
					id: true,
					name: true,
					stage: true,
					amount: true,
					currency: true,
					baseAmount: true,
					baseCurrency: true,
					expectedCloseDate: true,
					lastActivityAt: true,
					company: { select: { name: true } },
				},
			});
			for (const row of extra) dealById.set(row.id, row);
		}

		const meetingByDeal = new Map<string, Date>();
		for (const row of meetingRows) {
			if (!row.dealId || !row.calendarEvent) continue;
			const current = meetingByDeal.get(row.dealId);
			if (!current || row.calendarEvent.startsAt < current) {
				meetingByDeal.set(row.dealId, row.calendarEvent.startsAt);
			}
		}

		return {
			deals: dealRows.map((row) => ({
				id: row.id,
				name: row.name,
				stage: row.stage,
				amount: decimalAmount(row.amount),
				currency: row.currency,
				baseAmount: decimalAmount(row.baseAmount),
				baseCurrency: row.baseCurrency,
				expectedCloseDate: row.expectedCloseDate,
				lastActivityAt: row.lastActivityAt,
				companyName: row.company.name,
				meetingTodayAt: meetingByDeal.get(row.id) ?? null,
			})),
			approvals: approvalRows.flatMap((row) => {
				const dealId = dealIdForRun(row, dealIdBySession);
				const deal = dealId ? dealById.get(dealId) : undefined;
				if (!deal) return [];
				return [
					{
						id: row.id,
						createdAt: row.createdAt,
						agentId: row.agentId,
						agentName: row.agent.name,
						dealId: deal.id,
						dealName: deal.name,
						dealStage: deal.stage,
						amount: decimalAmount(deal.amount),
						currency: deal.currency,
						baseAmount: decimalAmount(deal.baseAmount),
						baseCurrency: deal.baseCurrency,
					},
				];
			}),
			tasks: taskRows.flatMap((row) => {
				const subject = row.subject?.trim();
				if (!subject || !row.dealId || !row.deal) return [];
				return [
					{
						id: row.id,
						subject,
						createdAt: row.createdAt,
						dueAt: row.dueAt,
						dealId: row.dealId,
						dealName: row.deal.name,
					},
				];
			}),
			recentWork: workRows.flatMap((row) => {
				const summary = row.summary?.trim();
				if (!summary) return [];
				return [
					{
						id: row.id,
						summary,
						occurredAt: row.finishedAt ?? row.createdAt,
						agentId: row.agentId,
						agentName: row.agent.name,
						dealId: dealIdForRun(row, dealIdBySession),
					},
				];
			}),
		};
	}
}

function dealIdForRun(
	row: {
		sessionId: string | null;
		input: unknown;
		actions?: Array<{ targetType: string | null; targetId: string | null }>;
	},
	dealIdBySession: Map<string, string>,
): string | null {
	const fromInput = runDealInput.safeParse(row.input);
	if (fromInput.success && fromInput.data.dealId) return fromInput.data.dealId;

	const fromAction = row.actions?.find(
		(action) =>
			action.targetId &&
			(action.targetType === "deal" || action.targetType === "Deal"),
	);
	if (fromAction?.targetId) return fromAction.targetId;

	if (row.sessionId) return dealIdBySession.get(row.sessionId) ?? null;
	return null;
}

function utcDayStart(now: Date): Date {
	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
}

function decimalAmount(value: { toNumber(): number } | null): number | null {
	return value === null ? null : value.toNumber();
}
