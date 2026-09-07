import { EnrichmentStatus, type Prisma } from "@crm/db";
import {
	MAX_ATTEMPTS,
	ownsCompanyStatus,
	ownsContactStatus,
} from "@crm/db/agent-tasks";
import { tenantTransaction } from "@crm/db/tenant-scope";
import { forEachTenant } from "@crm/db/tenants";
import { DISPATCH } from "./dispatch-config";
import { settle } from "./enrichment";
import { retireExhausted, runTaskInTenant, type TaskSubject } from "./tasks";

const SCAN = DISPATCH.reconcile.scan;

const LANDED_OUTCOME =
	"The record was already up to date when this was checked again.";

const RETIRED_ERROR =
	"Research was attempted several times and never completed.";

const UNTARGETED_OUTCOME =
	"No record was ever attached to this task, so it can never be worked. Retired.";

export type StaleTaskSweep = {
	scanned: number;
	closed: number;
	retired: number;
	released: number;
	waiting: number;
	unscanned: number;
	error: string | null;
};

type OpenTask = {
	id: string;
	organizationId: string;
	kind: string;
	contactId: string | null;
	companyId: string | null;
	dealId: string | null;
	attempts: number;
	leasedUntil: Date | null;
	startedAt: Date | null;
	dueAt: Date;
};

type TenantScan = {
	open: number;
	tasks: OpenTask[];
};

let lastSweep: StaleTaskSweep | null = null;

export function staleTaskSweep(): StaleTaskSweep | null {
	return lastSweep;
}

export async function retireAbandoned(): Promise<TaskSubject[]> {
	let abandoned: TaskSubject[] = [];

	try {
		abandoned = await retireExhausted();
	} catch {
		return [];
	}

	for (const task of abandoned) {
		await runTaskInTenant(task, () =>
			settle(task, EnrichmentStatus.FAILED, RETIRED_ERROR),
		).catch(() => {});
	}

	return abandoned;
}

export async function reconcileStaleTasks(): Promise<StaleTaskSweep> {
	const sweep: StaleTaskSweep = {
		scanned: 0,
		closed: 0,
		retired: 0,
		released: 0,
		waiting: 0,
		unscanned: 0,
		error: null,
	};

	try {
		await runSweep(sweep);
	} catch (cause) {
		sweep.error = cause instanceof Error ? cause.message : String(cause);
		console.error(`[agent] Stale task reconciliation failed: ${sweep.error}`);
	}

	lastSweep = sweep;
	return sweep;
}

async function runSweep(sweep: StaleTaskSweep): Promise<void> {
	const now = new Date();
	const where: Prisma.AgentTaskWhereInput = {
		finishedAt: null,
		dueAt: { lte: now },
		OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
	};
	const scans: TenantScan[] = [];

	await forEachTenant(
		async (_organizationId, tx) => {
			const tenantWhere: Prisma.AgentTaskWhereInput = {
				...where,
			};
			const [open, tasks] = await Promise.all([
				tx.agentTask.count({ where: tenantWhere }),
				tx.agentTask.findMany({
					where: tenantWhere,
					orderBy: [{ dueAt: "asc" }],
					take: SCAN,
					select: {
						id: true,
						organizationId: true,
						kind: true,
						contactId: true,
						companyId: true,
						dealId: true,
						attempts: true,
						leasedUntil: true,
						startedAt: true,
						dueAt: true,
					},
				}),
			]);
			scans.push({ open, tasks });
		},
		{ concurrency: DISPATCH.task.tenantConcurrency },
	);

	const open = scans.reduce((total, scan) => total + scan.open, 0);
	const tasks = scans
		.flatMap((scan) => scan.tasks)
		.sort(compareDueAt)
		.slice(0, SCAN);

	sweep.scanned = tasks.length;
	sweep.unscanned = Math.max(0, open - tasks.length);
	const groups = groupTasksByTenant(tasks);

	for (const [organizationId, tenantTasks] of groups) {
		await tenantTransaction(organizationId, async (tx) => {
			const completed = await completedSubjects(tx, tenantTasks);
			const landed: string[] = [];
			const untargeted: string[] = [];
			const dead: string[] = [];

			for (const task of tenantTasks) {
				if (isUntargetedFieldBackfill(task)) {
					untargeted.push(task.id);
					continue;
				}

				if (finishedElsewhere(task, completed)) {
					landed.push(task.id);
					continue;
				}

				if (task.attempts >= MAX_ATTEMPTS) continue;

				if (task.leasedUntil !== null) dead.push(task.id);
				else sweep.waiting += 1;
			}

			if (landed.length > 0) {
				const { count } = await tx.agentTask.updateMany({
					where: {
						id: { in: landed },
						finishedAt: null,
						OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
					},
					data: { finishedAt: now, outcome: LANDED_OUTCOME },
				});
				sweep.closed += count;
			}

			if (untargeted.length > 0) {
				const { count } = await tx.agentTask.updateMany({
					where: {
						id: { in: untargeted },
						finishedAt: null,
						OR: [{ leasedUntil: null }, { leasedUntil: { lt: now } }],
					},
					data: { finishedAt: now, outcome: UNTARGETED_OUTCOME },
				});
				sweep.closed += count;
			}

			if (dead.length > 0) {
				const { count } = await tx.agentTask.updateMany({
					where: {
						id: { in: dead },
						finishedAt: null,
						leasedUntil: { lt: now },
					},
					data: { leasedUntil: null },
				});
				sweep.released += count;
			}
		});
	}

	sweep.retired = (await retireAbandoned()).length;
}

async function completedSubjects(
	tx: Prisma.TransactionClient,
	tasks: readonly OpenTask[],
): Promise<Map<string, Date>> {
	const contactIds = unique(tasks.map((task) => task.contactId));
	const companyIds = unique(tasks.map((task) => task.companyId));

	const [contacts, companies] = await Promise.all([
		contactIds.length === 0
			? []
			: tx.contact.findMany({
					where: {
						id: { in: contactIds },
						enrichmentStatus: EnrichmentStatus.COMPLETE,
						enrichedAt: { not: null },
					},
					select: { id: true, enrichedAt: true },
				}),
		companyIds.length === 0
			? []
			: tx.company.findMany({
					where: {
						id: { in: companyIds },
						enrichmentStatus: EnrichmentStatus.COMPLETE,
						enrichedAt: { not: null },
					},
					select: { id: true, enrichedAt: true },
				}),
	]);

	const completed = new Map<string, Date>();

	for (const row of [...contacts, ...companies]) {
		if (row.enrichedAt) completed.set(row.id, row.enrichedAt);
	}

	return completed;
}

function groupTasksByTenant(
	tasks: readonly OpenTask[],
): Map<string, OpenTask[]> {
	const groups = new Map<string, OpenTask[]>();
	for (const task of tasks) {
		const tenantTasks = groups.get(task.organizationId) ?? [];
		tenantTasks.push(task);
		groups.set(task.organizationId, tenantTasks);
	}
	return groups;
}

function compareDueAt(a: OpenTask, b: OpenTask): number {
	return a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id);
}

function finishedElsewhere(
	task: OpenTask,
	completed: Map<string, Date>,
): boolean {
	if (task.attempts === 0 || task.startedAt === null) return false;

	const subjectId = task.contactId ?? task.companyId;
	if (!subjectId) return false;

	const owns = task.contactId
		? ownsContactStatus(task.kind)
		: ownsCompanyStatus(task.kind);
	if (!owns) return false;

	const enrichedAt = completed.get(subjectId);
	if (!enrichedAt) return false;

	return enrichedAt.getTime() >= task.startedAt.getTime();
}

function isUntargetedFieldBackfill(task: OpenTask): boolean {
	return (
		task.kind === "field-backfill" &&
		!task.contactId &&
		!task.companyId &&
		!task.dealId
	);
}

function unique(ids: readonly (string | null)[]): string[] {
	return [...new Set(ids.filter((id): id is string => id !== null))];
}
