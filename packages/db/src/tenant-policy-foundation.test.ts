import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "./client";
import { Prisma } from "./generated/prisma/client";
import { runInTenant } from "./tenant-context";
import { scopedTransaction } from "./tenant-scope";

const TABLES = [
	"company",
	"contact",
	"deal",
	"dealContact",
	"activity",
	"fieldDefinition",
	"fieldOption",
	"fieldValue",
	"companyEnrichment",
	"contactFact",
	"contactBrief",
	"agentTask",
	"agentEvent",
	"agentConversation",
	"agentConversationFeedback",
	"agentConversationShare",
	"agentConversationSubmission",
	"agentConversationAttachment",
	"agentDefinition",
	"agentVersion",
	"agentBuilderArtifact",
	"agentTrigger",
	"agentRun",
	"agentRunEvent",
	"agentAction",
	"agentAuditEvent",
	"mailboxSync",
	"emailThread",
	"emailMessage",
	"calendarEvent",
	"calendarAttendee",
	"appSetting",
	"workspaceProfile",
	"ssoProvider",
	"slackInstallation",
	"slackWorkspaceGrant",
	"slackChannel",
	"slackMemberMatch",
	"trackedDomain",
	"trackedVisitor",
	"trackedEvent",
	"trackedPageDaily",
	"formSubmission",
	"trackingCounter",
	"suppressedDomain",
	"suppressedContact",
	"savedView",
] as const;

type PolicyState = {
	tableName: string;
	rowSecurity: boolean;
	forceRowSecurity: boolean;
	defaultExpression: string;
	policyName: string;
	policyCommand: string;
	usingExpression: string;
	checkExpression: string;
};

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const organizationId = `tenant-policy-org-${suffix}`;

beforeAll(async () => {
	await db.organization.create({
		data: {
			id: organizationId,
			name: `Tenant Policy ${suffix}`,
			slug: organizationId,
			createdAt: new Date(),
		},
	});
});

afterAll(async () => {
	await runInTenant(organizationId, () =>
		scopedTransaction((tx) => tx.company.deleteMany()),
	);
	await db.organization.deleteMany({ where: { id: organizationId } });
});

describe("tenant policy foundation", () => {
	it("creates one active tenant policy and one tenant default on every scoped table", async () => {
		const rows = await db.$queryRaw<PolicyState[]>(Prisma.sql`
			SELECT
				c.relname AS "tableName",
				c.relrowsecurity AS "rowSecurity",
				c.relforcerowsecurity AS "forceRowSecurity",
				pg_get_expr(d.adbin, d.adrelid) AS "defaultExpression",
				p.polname AS "policyName",
				p.polcmd::text AS "policyCommand",
				pg_get_expr(p.polqual, p.polrelid) AS "usingExpression",
				pg_get_expr(p.polwithcheck, p.polrelid) AS "checkExpression"
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organizationId'
			JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
			JOIN pg_policy p ON p.polrelid = c.oid
			WHERE n.nspname = current_schema()
				AND c.relname IN (${Prisma.join(TABLES)})
			ORDER BY c.relname
		`);

		expect(rows.map((row) => row.tableName)).toEqual([...TABLES].sort());

		for (const row of rows) {
			expect(row.rowSecurity).toBe(true);
			expect(row.forceRowSecurity).toBe(true);
			expect(row.defaultExpression).toBe(
				"current_setting('app.current_organization_id'::text, true)",
			);
			expect(row.policyName).toBe("tenant_isolation");
			expect(row.policyCommand).toBe("*");
			expect(row.usingExpression).toContain(
				"current_setting('app.current_organization_id'::text, true)",
			);
			expect(row.checkExpression).toContain(
				"current_setting('app.current_organization_id'::text, true)",
			);
		}
	});

	it("fills organizationId from the transaction-local tenant value", async () => {
		const created = await db.$transaction(async (tx) => {
			await tx.$executeRaw`
				SELECT set_config('app.current_organization_id', ${organizationId}, true)
			`;

			return tx.company.create({
				data: { name: `Defaulted Company ${suffix}` },
			});
		});

		expect(created.organizationId).toBe(organizationId);
	});
});
