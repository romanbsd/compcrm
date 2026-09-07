import type { Db } from "./client";
import { db } from "./client";
import type { Prisma } from "./generated/prisma/client";
import { runLimited } from "./pool";
import { runInTenant } from "./tenant-context";
import { tenantTransaction } from "./tenant-scope";

type OrganizationReader = Pick<Db, "organization">;

export async function organizationIds(
	client: OrganizationReader = db,
): Promise<string[]> {
	const organizations = await client.organization.findMany({
		orderBy: { id: "asc" },
		select: { id: true },
	});
	return organizations.map(({ id }) => id);
}

export interface ForEachTenantOptions {
	concurrency?: number;
	organizations?: readonly string[];
}

export async function forEachTenant(
	work: (organizationId: string, tx: Prisma.TransactionClient) => Promise<void>,
	options: ForEachTenantOptions = {},
): Promise<void> {
	const organizations = options.organizations ?? (await organizationIds());
	await runLimited(
		options.concurrency ?? organizations.length,
		organizations,
		(organizationId) =>
			tenantTransaction(organizationId, (tx) => work(organizationId, tx)),
	);
}

export async function collectAcrossTenants<T>(
	query: (organizationId: string) => Promise<T[]>,
	options: ForEachTenantOptions = {},
): Promise<T[]> {
	const rows: T[] = [];
	await forEachTenant(async (organizationId) => {
		rows.push(...(await query(organizationId)));
	}, options);
	return rows;
}

export async function locateTenantRow<T>(
	query: (organizationId: string) => Promise<T | null>,
): Promise<{ organizationId: string; row: T } | null> {
	for (const organizationId of await organizationIds()) {
		const row = await runInTenant(organizationId, () => query(organizationId));
		if (row) return { organizationId, row };
	}
	return null;
}
