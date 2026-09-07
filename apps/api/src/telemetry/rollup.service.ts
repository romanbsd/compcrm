import {
	ActivityType,
	type Db,
	DealStage,
	EnrichmentStatus,
	FactBand,
	FactStatus,
	type Prisma,
	RecordSource,
} from "@crm/db";
import { RETIRED_OUTCOME } from "@crm/db/agent-tasks";
import { readAgentModel } from "@crm/db/settings";
import { forEachTenant, organizationIds } from "@crm/db/tenants";
import { CONTACT_CAP_REASON } from "@crm/db/tracking";
import {
	bucket,
	claimRollup,
	dayBucket,
	drainCounters,
	installDaily,
	type Properties,
	permittedEvidenceKind,
	permittedMethod,
	permittedTaskKind,
	permittedTool,
	releaseRollup,
	restoreCounters,
	telemetryDisabled,
} from "@crm/telemetry";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { FunnelService } from "./funnel.service";
import { SEED_OWNER_PREFIX } from "./seed";

const WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

const SUPERSEDE_WINDOW_DAYS = 7;

const SANDBOX_TOOLS = new Set([
	"bash",
	"glob",
	"grep",
	"read_file",
	"write_file",
]);

type Counted = { key: string; count: number };

type AgentModel = Awaited<ReturnType<typeof readAgentModel>>;

type ToolMetrics = {
	calls: Record<string, number>;
	errors: Record<string, number>;
	sandbox: boolean;
};

type SessionMetrics = {
	started: number;
	completed: number;
	failed: number;
	withTools: number;
};

type TaskMetrics = {
	claimed: Record<string, number>;
	completed: Record<string, number>;
	retired: Record<string, number>;
};

type AttemptMetric = { mean: number; max: number; count: number };

type AgentMetrics = {
	tools: ToolMetrics;
	sessions: SessionMetrics;
	tasks: TaskMetrics;
	attempts: Record<string, AttemptMetric>;
	rechecks: { total: number; buckets: Record<string, number> };
	conversations: number;
};

type LedgerMetrics = {
	statuses: Counted[];
	bands: Counted[];
	methods: Counted[];
	evidenceKinds: Counted[];
	superseded: number;
};

type CrmMetrics = {
	contacts: number;
	companies: number;
	deals: number;
	activities: number;
	contactSources: Counted[];
	companySources: Counted[];
	stages: Counted[];
	types: Counted[];
	syncs: Counted[];
	threads: number;
	messages: number;
	enrichment: Counted[];
	suppressedDomains: number;
	suppressedContacts: number;
	workspaceProfiles: number;
	nonSeedContacts: number;
	trackingSites: number;
	trackingDomains: number;
	trackingViews: number;
	trackingForms: number;
	trackingContacts: number;
	trackingCapped: number;
	trackingPaused: number;
};

type TenantMetrics = {
	model: AgentModel;
	contextConfigured: boolean;
	ssoProviders: number;
	agent: AgentMetrics;
	ledger: LedgerMetrics;
	crm: CrmMetrics;
};

export type RollupOutcome = {
	sent: boolean;
	reason?: string;
	milestones: string[];
};

@Injectable()
export class RollupService {
	private readonly logger = new Logger(RollupService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly funnel: FunnelService,
	) {}

	async run(force = false): Promise<RollupOutcome> {
		if (telemetryDisabled()) {
			return { sent: false, reason: "telemetry is off", milestones: [] };
		}

		const milestones = await this.funnel.sweep();

		const now = new Date();
		const claim = await claimRollup(now, force);
		if (!claim.claimed) {
			return { sent: false, reason: claim.reason, milestones };
		}

		const since = new Date(now.getTime() - WINDOW_HOURS * HOUR_MS);
		let counters: Record<string, number> = {};

		try {
			const gathered = await this.gather(since);
			counters = gathered.counters;

			if (!(await installDaily(gathered.properties, now))) {
				await this.giveBack(claim.previous, counters);

				return { sent: false, reason: "not delivered", milestones };
			}

			this.logger.log({
				message: "Telemetry rollup sent",
				windowHours: WINDOW_HOURS,
				milestones: milestones.length,
			});

			return { sent: true, milestones };
		} catch (error) {
			await this.giveBack(claim.previous, counters);

			this.logger.debug({
				message: "Telemetry rollup could not be built",
				reason: error instanceof Error ? error.message : String(error),
			});

			return { sent: false, reason: "failed", milestones };
		}
	}

	private async giveBack(
		previous: Date | null,
		counters: Record<string, number>,
	): Promise<void> {
		await releaseRollup(previous);
		await restoreCounters(counters);
	}

	private async gather(
		since: Date,
	): Promise<{ properties: Properties; counters: Record<string, number> }> {
		const counters = await drainCounters();
		const organizations = await organizationIds(this.db);
		const [postgres, memberRows, tenants] = await Promise.all([
			this.postgresMajor(),
			this.db.$queryRaw<{ count: bigint }[]>`
				SELECT COUNT(DISTINCT "userId") AS count
				FROM member;
			`,
			this.tenantMetrics(organizations, since),
		]);
		const members = Number(memberRows[0]?.count ?? 0);
		const shape = this.shape(tenants, members, postgres);
		const agent = aggregateAgent(tenants, counters);
		const ledger = aggregateLedger(tenants);
		const crm = aggregateCrm(tenants);

		return {
			properties: { ...shape, ...agent, ...ledger, ...crm },
			counters,
		};
	}

	private async tenantMetrics(
		organizations: readonly string[],
		since: Date,
	): Promise<TenantMetrics[]> {
		const tenants: TenantMetrics[] = [];

		await forEachTenant(
			async (organizationId, tx) => {
				const [model, ssoProviders, contextKey, agent, ledger, crm] =
					await Promise.all([
						readAgentModel(tx),
						tx.ssoProvider.count(),
						tx.appSetting.findFirst({
							select: { contextDevApiKey: true },
						}),
						this.agent(tx, since),
						this.ledger(tx),
						this.crm(tx, since),
					]);

				tenants.push({
					model,
					ssoProviders,
					contextConfigured: Boolean(contextKey?.contextDevApiKey?.trim()),
					agent,
					ledger,
					crm,
				});
			},
			{ organizations, concurrency: 1 },
		);

		return tenants;
	}

	private shape(
		tenants: readonly TenantMetrics[],
		members: number,
		postgres: string | null,
	): Properties {
		const model = sharedModel(tenants.map((tenant) => tenant.model));

		return {
			node_version: process.versions.node.split(".")[0] ?? null,
			postgres_version: postgres,
			members_bucket: bucket(members),

			cap_perplexity: isSet("PERPLEXITY_API_KEY"),
			cap_context_dev: tenants.some((tenant) => tenant.contextConfigured),
			cap_blob: isSet("BLOB_READ_WRITE_TOKEN"),
			cap_github: isSet("GITHUB_TOKEN"),
			cap_redis: isSet("REDIS_URL"),
			cap_agent_bridge: isSet("AGENT_BRIDGE_SECRET"),
			cap_cron_secret: isSet("CRON_SECRET"),
			cap_ai_gateway: isSet("AI_GATEWAY_API_KEY"),
			cap_google_oauth:
				isSet("GOOGLE_CLIENT_ID") && isSet("GOOGLE_CLIENT_SECRET"),
			cap_sso_provider: tenants.some((tenant) => tenant.ssoProviders > 0),
			is_marketing: process.env.IS_MARKETING === "true",

			agent_model_id: model.id,
			agent_model_context_window: model.contextWindowTokens,
		};
	}

	private async postgresMajor(): Promise<string | null> {
		try {
			const rows = await this.db.$queryRaw<{ version: string }[]>`
				SELECT current_setting('server_version_num') AS version;
			`;

			const raw = Number(rows[0]?.version);
			if (!Number.isFinite(raw)) return null;

			return String(Math.floor(raw / 10_000));
		} catch {
			return null;
		}
	}

	private async agent(
		db: Prisma.TransactionClient,
		since: Date,
	): Promise<AgentMetrics> {
		const [tools, sessions, tasks, attempts, rechecks, conversations] =
			await Promise.all([
				this.toolCalls(db, since),
				this.sessions(db, since),
				this.tasks(db, since),
				this.attempts(db, since),
				this.rechecks(db, since),
				db.agentConversation.count(),
			]);

		return { tools, sessions, tasks, attempts, rechecks, conversations };
	}

	private async toolCalls(
		db: Prisma.TransactionClient,
		since: Date,
	): Promise<{
		calls: Record<string, number>;
		errors: Record<string, number>;
		sandbox: boolean;
	}> {
		const rows = await db.$queryRaw<
			{ tool: string | null; failed: boolean; count: bigint }[]
		>`
			SELECT
				"data"->'result'->>'toolName' AS tool,
				COALESCE("data"->>'status', 'completed') <> 'completed' AS failed,
				COUNT(*) AS count
			FROM "agentEvent"
			WHERE "type" = 'action.result'
				AND "emittedAt" >= ${since}
			GROUP BY 1, 2;
		`;

		const calls: Record<string, number> = {};
		const errors: Record<string, number> = {};
		let sandbox = false;

		for (const row of rows) {
			const tool = permittedTool(row.tool);
			const count = Number(row.count);

			calls[tool] = (calls[tool] ?? 0) + count;
			if (row.failed) errors[tool] = (errors[tool] ?? 0) + count;
			if (SANDBOX_TOOLS.has(tool)) sandbox = true;
		}

		return { calls, errors, sandbox };
	}

	private async sessions(
		db: Prisma.TransactionClient,
		since: Date,
	): Promise<{
		started: number;
		completed: number;
		failed: number;
		withTools: number;
	}> {
		const rows = await db.$queryRaw<{ type: string; sessions: bigint }[]>`
			SELECT "type", COUNT(DISTINCT "sessionId") AS sessions
			FROM "agentEvent"
			WHERE "emittedAt" >= ${since}
				AND "type" IN ('session.started', 'session.waiting', 'session.failed', 'action.result')
			GROUP BY 1;
		`;

		const of = (type: string) =>
			Number(rows.find((row) => row.type === type)?.sessions ?? 0);

		return {
			started: of("session.started"),
			completed: of("session.waiting"),
			failed: of("session.failed"),
			withTools: of("action.result"),
		};
	}

	private async tasks(
		db: Prisma.TransactionClient,
		since: Date,
	): Promise<{
		claimed: Record<string, number>;
		completed: Record<string, number>;
		retired: Record<string, number>;
	}> {
		const [claimed, finished] = await Promise.all([
			db.agentTask.groupBy({
				by: ["kind"],
				where: { startedAt: { gte: since } },
				_count: { _all: true },
			}),
			db.agentTask.groupBy({
				by: ["kind", "outcome"],
				where: { finishedAt: { gte: since } },
				_count: { _all: true },
			}),
		]);

		const completed: Record<string, number> = {};
		const retired: Record<string, number> = {};

		for (const row of finished) {
			const kind = permittedTaskKind(row.kind);
			const into = row.outcome === RETIRED_OUTCOME ? retired : completed;
			into[kind] = (into[kind] ?? 0) + row._count._all;
		}

		return {
			claimed: byKind(
				claimed.map((row) => ({ key: row.kind, count: row._count._all })),
			),
			completed,
			retired,
		};
	}

	private async attempts(
		db: Prisma.TransactionClient,
		since: Date,
	): Promise<Record<string, AttemptMetric>> {
		const rows = await db.agentTask.groupBy({
			by: ["kind"],
			where: { finishedAt: { gte: since } },
			_count: { _all: true },
			_avg: { attempts: true },
			_max: { attempts: true },
		});

		const attempts: Record<string, AttemptMetric> = {};

		for (const row of rows) {
			const kind = permittedTaskKind(row.kind);
			const existing = attempts[kind] ?? { mean: 0, max: 0, count: 0 };
			const count = row._count._all;
			const combined = existing.count + count;
			attempts[kind] = {
				mean: combined
					? (existing.mean * existing.count +
							(row._avg.attempts ?? 0) * count) /
						combined
					: 0,
				max: Math.max(existing.max, row._max.attempts ?? 0),
				count: combined,
			};
		}

		return attempts;
	}

	private async rechecks(
		db: Prisma.TransactionClient,
		since: Date,
	): Promise<{ total: number; buckets: Record<string, number> }> {
		const rows = await db.agentTask.findMany({
			where: { kind: "recheck", createdAt: { gte: since } },
			select: { createdAt: true, dueAt: true },
		});

		const buckets: Record<string, number> = {};

		for (const row of rows) {
			const days = Math.max(
				0,
				(row.dueAt.getTime() - row.createdAt.getTime()) / (24 * HOUR_MS),
			);
			const label = dayBucket(days);
			buckets[label] = (buckets[label] ?? 0) + 1;
		}

		return { total: rows.length, buckets };
	}

	private async ledger(
		db: Prisma.TransactionClient,
	): Promise<LedgerMetrics> {
		const [byStatus, byBand, methods, kinds, superseded] = await Promise.all([
			db.contactFact.groupBy({
				by: ["status"],
				_count: { _all: true },
			}),
			db.contactFact.groupBy({
				by: ["band"],
				_count: { _all: true },
			}),
			db.contactFact.groupBy({
				by: ["method"],
				_count: { _all: true },
			}),
			this.evidenceKinds(db),
			this.supersededWithin(db, SUPERSEDE_WINDOW_DAYS),
		]);

		return {
			statuses: byStatus.map((row) => ({
				key: row.status,
				count: row._count._all,
			})),
			bands: byBand.map((row) => ({
				key: row.band,
				count: row._count._all,
			})),
			methods: methods.map((row) => ({
				key: permittedMethod(row.method),
				count: row._count._all,
			})),
			evidenceKinds: kinds,
			superseded,
		};
	}

	private async evidenceKinds(
		db: Prisma.TransactionClient,
	): Promise<Counted[]> {
		const rows = await db.$queryRaw<{ kind: string; count: bigint }[]>`
			SELECT item->>'kind' AS kind, COUNT(*) AS count
			FROM "contactFact", jsonb_array_elements("evidence") AS item
			WHERE jsonb_typeof("evidence") = 'array'
			GROUP BY 1;
		`;

		return rows.map((row) => ({
			key: permittedEvidenceKind(row.kind),
			count: Number(row.count),
		}));
	}

	private async supersededWithin(
		db: Prisma.TransactionClient,
		days: number,
	): Promise<number> {
		const rows = await db.$queryRaw<{ count: bigint }[]>`
			SELECT COUNT(*) AS count
			FROM "contactFact"
			WHERE "supersededAt" IS NOT NULL
				AND "supersededAt" - "observedAt" < make_interval(days => ${days});
		`;

		return Number(rows[0]?.count ?? 0);
	}

	private async crm(
		db: Prisma.TransactionClient,
		since: Date,
	): Promise<CrmMetrics> {
		const [
			contacts,
			companies,
			deals,
			activities,
			contactSources,
			companySources,
			stages,
			types,
			syncs,
			threads,
			messages,
			enrichment,
			suppressedDomains,
			suppressedContacts,
			workspaceProfile,
			nonSeedContacts,
		] = await Promise.all([
			db.contact.count(),
			db.company.count(),
			db.deal.count(),
			db.activity.count(),
			db.contact.groupBy({
				by: ["source"],
				_count: { _all: true },
			}),
			db.company.groupBy({
				by: ["source"],
				_count: { _all: true },
			}),
			db.deal.groupBy({
				by: ["stage"],
				_count: { _all: true },
			}),
			db.activity.groupBy({
				by: ["type"],
				_count: { _all: true },
			}),
			db.mailboxSync.groupBy({
				by: ["status"],
				_count: { _all: true },
			}),
			db.emailThread.count({
				where: { createdAt: { gte: since } },
			}),
			db.emailMessage.count({
				where: { createdAt: { gte: since } },
			}),
			db.company.groupBy({
				by: ["enrichmentStatus"],
				_count: { _all: true },
			}),
			db.suppressedDomain.count(),
			db.suppressedContact.count(),
			db.workspaceProfile.count(),
			db.contact.count({
				where: {
					OR: [
						{ ownerId: null },
						{ ownerId: { not: { startsWith: SEED_OWNER_PREFIX } } },
					],
				},
			}),
		]);

		const [
			trackingSite,
			trackingDomains,
			trackingViews,
			trackingForms,
			trackingContacts,
			trackingCapped,
			trackingPaused,
		] = await Promise.all([
			db.appSetting.count({
				where: { trackingSiteId: { not: null } },
			}),
			db.trackedDomain.count(),
			db.trackedEvent.count({
				where: {
					type: "page_view",
					occurredAt: { gte: since },
				},
			}),
			db.formSubmission.count({
				where: { createdAt: { gte: since } },
			}),
			db.contact.count({
				where: {
					createdAt: { gte: since },
					source: RecordSource.TRACKING,
				},
			}),
			db.formSubmission.count({
				where: {
					createdAt: { gte: since },
					skipReason: CONTACT_CAP_REASON,
				},
			}),
			db.appSetting.count({ where: { trackingPaused: true } }),
		]);

		return {
			contacts,
			companies,
			deals,
			activities,
			contactSources: counted(contactSources, "source"),
			companySources: counted(companySources, "source"),
			stages: counted(stages, "stage"),
			types: counted(types, "type"),
			syncs: counted(syncs, "status"),
			threads,
			messages,
			enrichment: counted(enrichment, "enrichmentStatus"),
			suppressedDomains,
			suppressedContacts,
			workspaceProfiles: workspaceProfile,
			nonSeedContacts,
			trackingSites: trackingSite,
			trackingDomains,
			trackingViews,
			trackingForms,
			trackingContacts,
			trackingCapped,
			trackingPaused,
		};
	}
}

function aggregateAgent(
	tenants: readonly TenantMetrics[],
	counters: Record<string, number>,
): Properties {
	const tools = mergeMaps(tenants.map((tenant) => tenant.agent.tools.calls));
	const toolErrors = mergeMaps(
		tenants.map((tenant) => tenant.agent.tools.errors),
	);
	const sessions = tenants.reduce<SessionMetrics>(
		(total, tenant) => ({
			started: total.started + tenant.agent.sessions.started,
			completed: total.completed + tenant.agent.sessions.completed,
			failed: total.failed + tenant.agent.sessions.failed,
			withTools: total.withTools + tenant.agent.sessions.withTools,
		}),
		{ started: 0, completed: 0, failed: 0, withTools: 0 },
	);
	const attempts = mergeAttempts(
		tenants.map((tenant) => tenant.agent.attempts),
	);
	const total = Object.values(tools).reduce((sum, count) => sum + count, 0);

	return {
		tool_calls: tools,
		tool_calls_total: total,
		tool_errors: toolErrors,
		sandbox_used: tenants.some((tenant) => tenant.agent.tools.sandbox),
		sessions_started: sessions.started,
		sessions_completed: sessions.completed,
		sessions_failed: sessions.failed,
		tools_per_session_mean: sessions.withTools
			? round(total / sessions.withTools)
			: 0,
		tasks_claimed: mergeMaps(
			tenants.map((tenant) => tenant.agent.tasks.claimed),
		),
		tasks_completed: mergeMaps(
			tenants.map((tenant) => tenant.agent.tasks.completed),
		),
		tasks_retired: mergeMaps(
			tenants.map((tenant) => tenant.agent.tasks.retired),
		),
		task_attempts_mean: Object.fromEntries(
			Object.entries(attempts).map(([kind, value]) => [
				kind,
				round(value.mean),
			]),
		),
		task_attempts_max: Object.fromEntries(
			Object.entries(attempts).map(([kind, value]) => [kind, value.max]),
		),
		budget_exhausted: counters.budget_exhausted ?? 0,
		recheck_scheduled: tenants.reduce(
			(total, tenant) => total + tenant.agent.rechecks.total,
			0,
		),
		recheck_interval_days: mergeMaps(
			tenants.map((tenant) => tenant.agent.rechecks.buckets),
		),
		agent_conversations: tenants.reduce(
			(total, tenant) => total + tenant.agent.conversations,
			0,
		),
	};
}

function aggregateLedger(tenants: readonly TenantMetrics[]): Properties {
	const statuses = countsOf(
		tenants.flatMap((tenant) => tenant.ledger.statuses),
		Object.values(FactStatus),
	);
	const dismissed = statuses[FactStatus.DISMISSED] ?? 0;
	const proposed = statuses[FactStatus.PROPOSED] ?? 0;
	const judged = dismissed + (statuses[FactStatus.APPLIED] ?? 0) + proposed;

	return {
		facts_by_status: statuses,
		facts_by_band: countsOf(
			tenants.flatMap((tenant) => tenant.ledger.bands),
			Object.values(FactBand),
		),
		facts_by_method: merge(tenants.flatMap((tenant) => tenant.ledger.methods)),
		facts_by_evidence_kind: merge(
			tenants.flatMap((tenant) => tenant.ledger.evidenceKinds),
		),
		fact_dismissal_rate: judged ? round(dismissed / judged) : 0,
		facts_superseded_within_7_days: tenants.reduce(
			(total, tenant) => total + tenant.ledger.superseded,
			0,
		),
	};
}

function aggregateCrm(tenants: readonly TenantMetrics[]): Properties {
	const total = (read: (metrics: CrmMetrics) => number) =>
		tenants.reduce((sum, tenant) => sum + read(tenant.crm), 0);
	const contacts = total((crm) => crm.contacts);
	const nonSeedContacts = total((crm) => crm.nonSeedContacts);
	const syncs = tenants.flatMap((tenant) => tenant.crm.syncs);

	return {
		seed_only: contacts > 0 && nonSeedContacts === 0,
		contacts_bucket: bucket(contacts),
		companies_bucket: bucket(total((crm) => crm.companies)),
		deals_bucket: bucket(total((crm) => crm.deals)),
		activities_bucket: bucket(total((crm) => crm.activities)),
		contacts_by_source: countsOf(
			tenants.flatMap((tenant) => tenant.crm.contactSources),
			Object.values(RecordSource),
		),
		companies_by_source: countsOf(
			tenants.flatMap((tenant) => tenant.crm.companySources),
			Object.values(RecordSource),
		),
		deals_by_stage: countsOf(
			tenants.flatMap((tenant) => tenant.crm.stages),
			Object.values(DealStage),
		),
		activities_by_type: countsOf(
			tenants.flatMap((tenant) => tenant.crm.types),
			Object.values(ActivityType),
		),
		cap_tracking: total((crm) => crm.trackingSites) > 0,
		tracking_domains: bucket(total((crm) => crm.trackingDomains)),
		tracking_page_views: total((crm) => crm.trackingViews),
		tracking_forms: total((crm) => crm.trackingForms),
		tracking_contacts_created: total((crm) => crm.trackingContacts),
		tracking_capped: total((crm) => crm.trackingCapped),
		tracking_paused: total((crm) => crm.trackingPaused) > 0,
		mailbox_sync_configured: syncs.some((row) => row.count > 0),
		mailbox_sync_status: merge(syncs),
		threads_ingested: total((crm) => crm.threads),
		messages_ingested: total((crm) => crm.messages),
		enrichment_by_status: countsOf(
			tenants.flatMap((tenant) => tenant.crm.enrichment),
			Object.values(EnrichmentStatus),
		),
		suppressed_domains: total((crm) => crm.suppressedDomains),
		suppressed_contacts: total((crm) => crm.suppressedContacts),
		workspace_profile_written: total((crm) => crm.workspaceProfiles) > 0,
	};
}

function sharedModel(models: readonly AgentModel[]): {
	id: string | null;
	contextWindowTokens: number | null;
} {
	const first = models[0];
	if (!first) return { id: null, contextWindowTokens: null };
	if (
		models.every(
			(model) =>
				model.id === first.id &&
				model.contextWindowTokens === first.contextWindowTokens,
		)
	) {
		return {
			id: first.id,
			contextWindowTokens: first.contextWindowTokens,
		};
	}

	return { id: "mixed", contextWindowTokens: null };
}

function mergeAttempts(
	groups: readonly Record<string, AttemptMetric>[],
): Record<string, AttemptMetric> {
	const combined: Record<string, AttemptMetric> = {};

	for (const group of groups) {
		for (const [kind, metric] of Object.entries(group)) {
			const existing = combined[kind] ?? { mean: 0, max: 0, count: 0 };
			const count = existing.count + metric.count;
			combined[kind] = {
				mean: count
					? (existing.mean * existing.count + metric.mean * metric.count) /
						count
					: 0,
				max: Math.max(existing.max, metric.max),
				count,
			};
		}
	}

	return combined;
}

function mergeMaps(groups: readonly Record<string, number>[]): CountsByKey {
	return merge(
		groups.flatMap((group) =>
			Object.entries(group).map(([key, count]) => ({ key, count })),
		),
	);
}

function counted<K extends string>(
	rows: readonly ({ _count: { _all: number } } & Record<K, string>)[],
	key: K,
): Counted[] {
	return rows.map((row) => ({ key: row[key], count: row._count._all }));
}

function isSet(name: string): boolean {
	return Boolean(process.env[name]?.trim());
}

type CountsByKey = Record<string, number>;

function byKind(rows: Counted[]): CountsByKey {
	return merge(
		rows.map((row) => ({ ...row, key: permittedTaskKind(row.key) })),
	);
}

function merge(rows: Counted[]): CountsByKey {
	const counts: CountsByKey = {};

	for (const row of rows) {
		counts[row.key] = (counts[row.key] ?? 0) + row.count;
	}

	return counts;
}

function countsOf(rows: Counted[], keys: readonly string[]): CountsByKey {
	const merged = merge(rows);
	const complete: CountsByKey = {};

	for (const key of keys) complete[key] = merged[key] ?? 0;

	return complete;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
