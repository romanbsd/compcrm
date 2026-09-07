import { Prisma } from "@crm/db";
import { MAX_ATTEMPTS, RETIRED_OUTCOME } from "@crm/db/agent-tasks";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import {
	forEachTenant,
	locateTenantRow,
	organizationIds,
} from "@crm/db/tenants";
import { DISPATCH } from "./dispatch-config";

export type LeasedTask = {
	id: string;
	organizationId: string;
	contactId: string | null;
	companyId: string | null;
	dealId: string | null;
	kind: string;
	reason: string;
	payload: Prisma.JsonValue | null;
	budget: number;
	attempts: number;
	priority: number;
	dueAt: Date;
};

export type TaskSubject = {
	id: string;
	organizationId: string;
	contactId: string | null;
	companyId: string | null;
	dealId: string | null;
	kind: string;
};

type TaskCandidate = {
	id: string;
	organizationId: string;
	priority: number;
	dueAt: Date;
};

const LEASE_MS = DISPATCH.task.leaseMs;

export async function claimDue(
	limit: number,
	kinds: { only: readonly string[] } | { except: readonly string[] },
	leaseMs = LEASE_MS,
): Promise<LeasedTask[]> {
	if (limit <= 0) return [];

	const now = new Date();
	const until = new Date(now.getTime() + leaseMs);

	const list = "only" in kinds ? [...kinds.only] : [...kinds.except];
	if ("only" in kinds && list.length === 0) return [];

	const onlyMode = "only" in kinds;
	const organizations = await organizationIds();
	const claimed: LeasedTask[] = [];

	while (claimed.length < limit) {
		const remaining = limit - claimed.length;
		const candidates = await collectTenantRows(
			organizations,
			(_organizationId, tx) =>
				tx.$queryRaw<TaskCandidate[]>(Prisma.sql`
					SELECT t.id, t."organizationId", t.priority, t."dueAt"
					FROM "agentTask" AS t
					WHERE t."finishedAt" IS NULL
						AND t."dueAt" <= ${now}
						AND (t."leasedUntil" IS NULL OR t."leasedUntil" < ${now})
						AND t."attempts" < ${MAX_ATTEMPTS}
						AND CASE
							WHEN ${onlyMode}::boolean THEN t.kind = ANY(${list}::text[])
							ELSE t.kind <> ALL(${list}::text[])
						END
					ORDER BY t.priority DESC, t."dueAt" ASC
					LIMIT ${remaining}
					FOR UPDATE SKIP LOCKED
				`),
		);
		const selected = candidates.sort(compareTaskPriority).slice(0, remaining);
		if (selected.length === 0) break;

		const batch = await claimSelectedTasks(
			selected,
			now,
			until,
			list,
			onlyMode,
		);
		claimed.push(...batch);
	}

	return claimed.sort(compareTaskPriority);
}

export async function retireExhausted(
	limit: number = DISPATCH.reconcile.retire,
): Promise<TaskSubject[]> {
	if (limit <= 0) return [];

	const now = new Date();
	const organizations = await organizationIds();
	const retired: TaskSubject[] = [];

	while (retired.length < limit) {
		const remaining = limit - retired.length;
		const candidates = await collectTenantRows(
			organizations,
			(_organizationId, tx) =>
				tx.$queryRaw<TaskCandidate[]>(Prisma.sql`
					SELECT t.id, t."organizationId", t.priority, t."dueAt"
					FROM "agentTask" AS t
					WHERE t."finishedAt" IS NULL
						AND t."attempts" >= ${MAX_ATTEMPTS}
						AND (t."leasedUntil" IS NULL OR t."leasedUntil" < ${now})
					ORDER BY t."dueAt" ASC
					LIMIT ${remaining}
					FOR UPDATE SKIP LOCKED
				`),
		);
		const selected = candidates
			.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
			.slice(0, remaining);
		if (selected.length === 0) break;

		const batch = await retireSelectedTasks(selected, now);
		retired.push(...batch);
	}

	return retired;
}

async function collectTenantRows<T>(
	organizations: readonly string[],
	query: (organizationId: string, tx: Prisma.TransactionClient) => Promise<T[]>,
): Promise<T[]> {
	const rows: T[] = [];
	await forEachTenant(
		async (organizationId, tx) => {
			rows.push(...(await query(organizationId, tx)));
		},
		{ concurrency: DISPATCH.task.tenantConcurrency, organizations },
	);
	return rows;
}

async function claimSelectedTasks(
	selected: readonly TaskCandidate[],
	now: Date,
	until: Date,
	list: readonly string[],
	onlyMode: boolean,
): Promise<LeasedTask[]> {
	return updateSelectedByTenant(selected, (_organizationId, ids, tx) =>
		tx.$queryRaw<LeasedTask[]>(Prisma.sql`
			WITH due AS (
				SELECT t.id
				FROM "agentTask" AS t
				WHERE t.id IN (${Prisma.join(ids)})
					AND t."finishedAt" IS NULL
					AND t."dueAt" <= ${now}
					AND (t."leasedUntil" IS NULL OR t."leasedUntil" < ${now})
					AND t."attempts" < ${MAX_ATTEMPTS}
					AND CASE
						WHEN ${onlyMode}::boolean THEN t.kind = ANY(${list}::text[])
						ELSE t.kind <> ALL(${list}::text[])
					END
				FOR UPDATE SKIP LOCKED
			)
			UPDATE "agentTask" AS t
			SET "leasedUntil" = ${until},
				"startedAt" = COALESCE(t."startedAt", ${now}),
				"attempts" = t."attempts" + 1
			FROM due
			WHERE t.id = due.id
			RETURNING t.id, t."contactId", t."companyId", t."dealId", t.kind, t.reason, t.payload,
				t.budget, t.attempts, t.priority, t."dueAt", t."organizationId"
		`),
	);
}

async function retireSelectedTasks(
	selected: readonly TaskCandidate[],
	now: Date,
): Promise<TaskSubject[]> {
	return updateSelectedByTenant(selected, (_organizationId, ids, tx) =>
		tx.$queryRaw<TaskSubject[]>(Prisma.sql`
			WITH exhausted AS (
				SELECT t.id
				FROM "agentTask" AS t
				WHERE t.id IN (${Prisma.join(ids)})
					AND t."finishedAt" IS NULL
					AND t."attempts" >= ${MAX_ATTEMPTS}
					AND (t."leasedUntil" IS NULL OR t."leasedUntil" < ${now})
				FOR UPDATE SKIP LOCKED
			)
			UPDATE "agentTask" AS t
			SET "finishedAt" = ${now},
				"outcome" = ${RETIRED_OUTCOME}
			FROM exhausted
			WHERE t.id = exhausted.id
			RETURNING t.id, t."organizationId", t."contactId", t."companyId", t."dealId", t.kind
		`),
	);
}

async function updateSelectedByTenant<T>(
	selected: readonly TaskCandidate[],
	update: (
		organizationId: string,
		ids: readonly string[],
		tx: Prisma.TransactionClient,
	) => Promise<T[]>,
): Promise<T[]> {
	const groups = new Map<string, string[]>();
	for (const task of selected) {
		const ids = groups.get(task.organizationId) ?? [];
		ids.push(task.id);
		groups.set(task.organizationId, ids);
	}
	return collectTenantRows([...groups.keys()], (organizationId, tx) =>
		update(organizationId, groups.get(organizationId) ?? [], tx),
	);
}

function compareTaskPriority(a: TaskCandidate, b: TaskCandidate): number {
	return b.priority - a.priority || a.dueAt.getTime() - b.dueAt.getTime();
}

export async function completeTask(
	taskId: string,
	outcome: string,
	sessionId?: string,
): Promise<TaskSubject | null> {
	const { count } = await scopedDb.agentTask.updateMany({
		where: { id: taskId, finishedAt: null },
		data: {
			finishedAt: new Date(),
			outcome: outcome.slice(0, 500),
			sessionId: sessionId || undefined,
		},
	});

	if (count === 0) return null;

	return await scopedDb.agentTask.findUnique({
		where: { id: taskId },
		select: {
			id: true,
			organizationId: true,
			contactId: true,
			companyId: true,
			dealId: true,
			kind: true,
		},
	});
}

export async function taskSubject(taskId: string): Promise<TaskSubject | null> {
	return await scopedDb.agentTask.findUnique({
		where: { id: taskId },
		select: {
			id: true,
			organizationId: true,
			contactId: true,
			companyId: true,
			dealId: true,
			kind: true,
		},
	});
}

export function runTaskInTenant<T>(
	task: { organizationId: string },
	action: () => T,
): T {
	return runInTenant(task.organizationId, action);
}

export async function withTaskTenant<T>(
	taskId: string,
	action: () => Promise<T>,
): Promise<T | null> {
	const located = await locateTenantRow(() =>
		scopedDb.agentTask.findUnique({
			where: { id: taskId },
			select: { id: true },
		}),
	);

	if (!located) return null;

	return runInTenant(located.organizationId, action);
}

export async function noteSession(
	taskId: string,
	sessionId: string,
): Promise<void> {
	await scopedDb.agentTask.updateMany({
		where: { id: taskId, finishedAt: null },
		data: { sessionId },
	});
}

export async function scheduleTask(input: {
	organizationId: string;
	contactId?: string | null;
	companyId?: string | null;
	dealId?: string | null;
	kind: string;
	reason: string;
	payload?: Prisma.InputJsonValue | null;
	dueAt: Date;
	priority?: number;
	budget?: number;
}): Promise<{ id: string }> {
	const existing = await scopedDb.agentTask.findFirst({
		where: {
			kind: input.kind,
			finishedAt: null,
			contactId: input.contactId ?? undefined,
			companyId: input.companyId ?? undefined,
			dealId: input.dealId ?? undefined,
		},
		select: { id: true },
	});

	if (existing) {
		await scopedDb.agentTask.update({
			where: { id: existing.id },
			data: { dueAt: input.dueAt, reason: input.reason },
		});
		return existing;
	}

	return await scopedDb.agentTask.create({
		data: {
			contactId: input.contactId ?? null,
			companyId: input.companyId ?? null,
			dealId: input.dealId ?? null,
			kind: input.kind,
			reason: input.reason,
			payload: input.payload ?? undefined,
			dueAt: input.dueAt,
			priority: input.priority ?? 0,
			budget: input.budget ?? 4,
		},
		select: { id: true },
	});
}

export async function lastDecision(contactId: string) {
	return await scopedDb.agentTask.findFirst({
		where: { contactId },
		orderBy: { createdAt: "desc" },
		select: {
			kind: true,
			reason: true,
			dueAt: true,
			finishedAt: true,
			outcome: true,
		},
	});
}

export type { Prisma };
