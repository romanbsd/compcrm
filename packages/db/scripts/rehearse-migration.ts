import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { WORKSPACE_ID } from "../src/workspace";

const MIGRATION = join(
	dirname(import.meta.dirname),
	"prisma",
	"migrations",
	"20260905120000_multi_tenant_schema",
	"migration.sql",
);

const ORGANIZATION_DEFAULT =
	"current_setting('app.current_organization_id'::text, true)";

const SEEDED_MINIMUMS = {
	company: 15,
	contact: 25,
	deal: 20,
	dealContact: 20,
	activity: 80,
	fieldDefinition: 7,
	fieldOption: 18,
	fieldValue: 100,
	appSetting: 1,
} as const;

type CountRow = {
	total: bigint;
	wrongOrganization: bigint;
};

type ColumnRow = {
	isNullable: "YES" | "NO";
	columnDefault: string | null;
};

type ForeignKeyRow = {
	count: bigint;
};

type RlsRow = {
	policyCount: bigint;
	rowSecurity: boolean;
	forceRowSecurity: boolean;
};

function tenantTables(): string[] {
	const sql = readFileSync(MIGRATION, "utf8");
	const added = Array.from(
		sql.matchAll(/ALTER TABLE "([^"]+)" ADD COLUMN "organizationId"/g),
		(match) => match[1],
	);
	const renamed = Array.from(
		sql.matchAll(
			/ALTER TABLE "([^"]+)" RENAME COLUMN "id" TO "organizationId"/g,
		),
		(match) => match[1],
	);

	return [...new Set([...added, ...renamed])].sort();
}

function rlsTables(): string[] {
	const sql = readFileSync(MIGRATION, "utf8");
	const array = sql.match(/FOREACH tbl IN ARRAY ARRAY\[(.*?)\]\s*LOOP/s)?.[1];

	if (!array) throw new Error("RLS migration table list does not exist.");

	return Array.from(array.matchAll(/'([^']+)'/g), (match) => match[1]).sort();
}

function quotedIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

async function counts(audit: PrismaClient, table: string): Promise<CountRow> {
	const rows = await audit.$queryRawUnsafe<CountRow[]>(
		`SELECT COUNT(*)::bigint AS "total", COUNT(*) FILTER (WHERE "organizationId" IS DISTINCT FROM $1)::bigint AS "wrongOrganization" FROM ${quotedIdentifier(table)}`,
		WORKSPACE_ID,
	);
	const row = rows[0];

	if (!row) throw new Error(`No count result returned for ${table}.`);

	return row;
}

async function column(audit: PrismaClient, table: string): Promise<ColumnRow> {
	const rows = await audit.$queryRawUnsafe<ColumnRow[]>(
		`SELECT "is_nullable" AS "isNullable", "column_default" AS "columnDefault" FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'organizationId'`,
		table,
	);
	const row = rows[0];

	if (!row) throw new Error(`${table}.organizationId does not exist.`);

	return row;
}

async function foreignKey(audit: PrismaClient, table: string): Promise<number> {
	const rows = await audit.$queryRawUnsafe<ForeignKeyRow[]>(
		`SELECT COUNT(*)::bigint AS "count" FROM pg_constraint c JOIN pg_class source ON source.oid = c.conrelid JOIN pg_namespace n ON n.oid = source.relnamespace JOIN unnest(c.conkey) AS key(attnum) ON true JOIN pg_attribute a ON a.attrelid = source.oid AND a.attnum = key.attnum WHERE c.contype = 'f' AND n.nspname = current_schema() AND source.relname = $1 AND a.attname = 'organizationId' AND c.confrelid = 'organization'::regclass`,
		table,
	);

	return Number(rows[0]?.count ?? 0n);
}

async function checkRlsCoverage(audit: PrismaClient): Promise<number> {
	const tables = rlsTables();
	let failures = 0;

	console.log(`Checking RLS coverage on ${tables.length} tenant tables.`);

	for (const table of tables) {
		const rows = await audit.$queryRawUnsafe<RlsRow[]>(
			`SELECT c.relrowsecurity AS "rowSecurity", c.relforcerowsecurity AS "forceRowSecurity", COUNT(p.policyname)::bigint AS "policyCount" FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname AND p.policyname = 'tenant_isolation' WHERE n.nspname = current_schema() AND c.relname = $1 GROUP BY c.relrowsecurity, c.relforcerowsecurity`,
			table,
		);
		const row = rows[0];
		const problems: string[] = [];

		if (!row?.rowSecurity) problems.push("row-level security is disabled");
		if (!row?.forceRowSecurity)
			problems.push("row-level security is not forced");
		if (row?.policyCount !== 1n)
			problems.push("tenant_isolation policy count is not one");

		if (problems.length > 0) {
			console.error(`FAIL ${table}: ${problems.join("; ")}`);
			failures += 1;
			continue;
		}

		console.log(`ok   ${table}: RLS enabled and forced`);
	}

	return failures;
}

async function rehearse(audit: PrismaClient): Promise<void> {
	const tables = tenantTables();
	let failures = 0;

	console.log(
		`Checking ${tables.length} tables changed by the tenant backfill migration.`,
	);

	for (const table of tables) {
		const organizationColumn = await column(audit, table);
		const [rowCounts, organizationForeignKeys] = await Promise.all([
			counts(audit, table),
			foreignKey(audit, table),
		]);
		const minimum = SEEDED_MINIMUMS[table as keyof typeof SEEDED_MINIMUMS];
		const problems: string[] = [];

		if (rowCounts.wrongOrganization > 0n) {
			problems.push(`${rowCounts.wrongOrganization} row(s) use another tenant`);
		}
		if (organizationColumn.isNullable !== "NO") {
			problems.push("organizationId accepts null");
		}
		if (organizationColumn.columnDefault !== ORGANIZATION_DEFAULT) {
			problems.push("organizationId has the wrong tenant default");
		}
		if (organizationForeignKeys !== 1) {
			problems.push("organizationId lacks one organization foreign key");
		}
		if (minimum !== undefined && rowCounts.total < BigInt(minimum)) {
			problems.push(`seeded volume is below ${minimum}`);
		}

		if (problems.length > 0) {
			console.error(
				`FAIL ${table}: ${rowCounts.total} row(s); ${problems.join("; ")}`,
			);
			failures += 1;
			continue;
		}

		console.log(`ok   ${table}: ${rowCounts.total} row(s)`);
	}

	failures += await checkRlsCoverage(audit);

	if (failures > 0) {
		throw new Error(`${failures} tenant migration check(s) failed.`);
	}

	console.log("Tenant migration rehearsal passed.");
}

async function main(): Promise<void> {
	const auditUrl = process.env.AUDIT_DATABASE_URL;

	if (!auditUrl) {
		throw new Error(
			"AUDIT_DATABASE_URL is required for the migration rehearsal. See docs/environment.md.",
		);
	}

	const audit = new PrismaClient({
		adapter: new PrismaPg({ connectionString: auditUrl }),
	});

	try {
		await rehearse(audit);
	} finally {
		await audit.$disconnect();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
