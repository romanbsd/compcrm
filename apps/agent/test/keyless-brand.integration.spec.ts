import { describe, expect } from "bun:test";
import { EnrichmentStatus, db as rawDb } from "@crm/db";
import { readContextDevKey, writeContextDevKey } from "@crm/db/settings";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb as db } from "@crm/db/tenant-scope";
import { runBrand } from "../agent/lib/brand";
import { settle as settleWithoutTenant } from "../agent/lib/enrichment";
import {
	tenantAfterAll,
	tenantAfterEach,
	tenantBeforeAll,
	tenantTest,
} from "@crm/db/test-support";

/**
 * An install with no Context key still creates companies, and a `brand` task
 * with nowhere to look is consumed and marked done. What must survive that is
 * the *record*: the sign-in sweep re-queues companies whose enrichment never
 * succeeded, and it decides that on `enrichmentStatus` being PENDING or FAILED.
 *
 * `runBrand` settles SKIPPED before anything marks the row RUNNING, and
 * `settle` only writes over a RUNNING row — so the row stays PENDING and the
 * sweep picks it up once a key exists. That is load bearing and entirely
 * implicit, which is why it is pinned here: a `settle` that wrote
 * unconditionally would strand every company added before the key, with
 * nothing to say so.
 */
const created: string[] = [];
const tasks: string[] = [];
const organizationId = `keyless-brand-${crypto.randomUUID()}`;
const it = tenantTest(organizationId);
const beforeAll = tenantBeforeAll(organizationId);
const afterEach = tenantAfterEach(organizationId);
const afterAll = tenantAfterAll(organizationId);
const settle: typeof settleWithoutTenant = (subject, status, error) =>
	runInTenant(organizationId, () =>
		settleWithoutTenant(subject, status, error),
	);

beforeAll(async () => {
	await rawDb.organization.create({
		data: {
			id: organizationId,
			name: "Keyless brand tests",
			slug: organizationId,
			createdAt: new Date(),
		},
	});
});

afterAll(async () => {
	await rawDb.organization.deleteMany({ where: { id: organizationId } });
});

afterEach(async () => {
	if (tasks.length > 0) {
		await db.agentTask.deleteMany({ where: { id: { in: tasks.splice(0) } } });
	}
	if (created.length === 0) return;
	await db.company.deleteMany({ where: { id: { in: created.splice(0) } } });
});

async function company(status: EnrichmentStatus) {
	const row = await db.company.create({
		data: {
			organizationId,
			name: "Keyless Probe",
			domain: `keyless-${created.length}-${status}.test`.toLowerCase(),
			enrichmentStatus: status,
		},
		select: { id: true },
	});

	created.push(row.id);
	return row.id;
}

const subjectOf = (companyId: string) => ({
	id: `keyless-${companyId}`,
	kind: "brand",
	contactId: null,
	companyId,
	dealId: null,
});

async function retiredSubjectOf(companyId: string) {
	await db.$executeRaw`
		UPDATE "company"
		SET "updatedAt" = NOW() - INTERVAL '1 second'
		WHERE id = ${companyId}
	`;

	const row = await db.agentTask.create({
		data: {
			organizationId,
			companyId,
			kind: "brand",
			reason: "keyless",
			attempts: 3,
			dueAt: new Date(),
			finishedAt: new Date(),
		},
		select: { id: true },
	});

	tasks.push(row.id);
	return { ...subjectOf(companyId), id: row.id };
}

const statusOf = async (id: string) =>
	(
		await db.company.findUnique({
			where: { id },
			select: { enrichmentStatus: true },
		})
	)?.enrichmentStatus;

describe("a brand task with no key", () => {
	it("leaves the company where the sweep will find it again", async () => {
		const id = await company(EnrichmentStatus.PENDING);

		await settle(
			subjectOf(id),
			EnrichmentStatus.SKIPPED,
			"Context.dev is not configured, so there is nowhere to look.",
		);

		expect(await statusOf(id)).toBe(EnrichmentStatus.PENDING);
	});

	it("does not strand a company that had already failed", async () => {
		const id = await company(EnrichmentStatus.FAILED);

		await settle(subjectOf(id), EnrichmentStatus.SKIPPED, "no key");

		expect(await statusOf(id)).toBe(EnrichmentStatus.FAILED);
	});

	it("still settles a lookup that genuinely ran", async () => {
		const id = await company(EnrichmentStatus.RUNNING);

		await settle(subjectOf(id), EnrichmentStatus.SKIPPED, "No brand.");

		expect(await statusOf(id)).toBe(EnrichmentStatus.SKIPPED);
	});

	it("records a failure on a company that never started", async () => {
		const id = await company(EnrichmentStatus.PENDING);

		await settle(
			await retiredSubjectOf(id),
			EnrichmentStatus.FAILED,
			"Research was attempted several times and never completed.",
		);

		expect(await statusOf(id)).toBe(EnrichmentStatus.FAILED);
	});

	it("does not revive a company that already completed", async () => {
		const id = await company(EnrichmentStatus.COMPLETE);

		await settle(
			await retiredSubjectOf(id),
			EnrichmentStatus.FAILED,
			"too late",
		);

		expect(await statusOf(id)).toBe(EnrichmentStatus.COMPLETE);
	});
});

async function domainlessCompany(status: EnrichmentStatus) {
	const row = await db.company.create({
		data: {
			organizationId,
			name: `Keyless Probe ${created.length}`,
			enrichmentStatus: status,
		},
		select: { id: true },
	});

	created.push(row.id);
	return row.id;
}

describe("a brand task on a company with no domain", () => {
	let key: string | null;

	beforeAll(async () => {
		key = await runInTenant(organizationId, () => readContextDevKey(db));
	});

	afterAll(async () => {
		await runInTenant(organizationId, () => writeContextDevKey(db, key ?? ""));
	});

	it("marks the company skipped, because no sweep will find it again", async () => {
		await runInTenant(organizationId, () =>
			writeContextDevKey(db, "ctx-test-key"),
		);
		const id = await domainlessCompany(EnrichmentStatus.PENDING);

		const result = await runInTenant(organizationId, () =>
			runBrand({ companyId: id }),
		);

		expect(result.enriched).toBe(false);
		expect(await statusOf(id)).toBe(EnrichmentStatus.SKIPPED);
	});

	it("still leaves a keyless install's company pending for the sweep", async () => {
		await runInTenant(organizationId, () => writeContextDevKey(db, ""));
		const id = await domainlessCompany(EnrichmentStatus.PENDING);

		const result = await runInTenant(organizationId, () =>
			runBrand({ companyId: id }),
		);

		expect(result.enriched).toBe(false);
		expect(await statusOf(id)).toBe(EnrichmentStatus.PENDING);
	});
});
