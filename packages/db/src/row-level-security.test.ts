import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "./client";
import type { Prisma } from "./generated/prisma/client";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ORG_A = `test-rls-org-a-${suffix}`;
const ORG_B = `test-rls-org-b-${suffix}`;

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{ id: ORG_A, name: "RLS Org A", slug: ORG_A, createdAt: new Date() },
			{ id: ORG_B, name: "RLS Org B", slug: ORG_B, createdAt: new Date() },
		],
	});
});

afterAll(async () => {
	await db.company.deleteMany({
		where: { organizationId: { in: [ORG_A, ORG_B] } },
	});
	await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
});

function asTenant<T>(
	organizationId: string | null,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return db.$transaction(async (tx) => {
		if (organizationId !== null) {
			await tx.$executeRaw`
				SELECT set_config('app.current_organization_id', ${organizationId}, true)
			`;
		}
		return work(tx);
	});
}

describe("Postgres row-level security", () => {
	it("uses a non-bypass application database role", async () => {
		const [role] = await db.$queryRaw<
			{ bypassRls: boolean; superuser: boolean }[]
		>`
			SELECT rolbypassrls AS "bypassRls", rolsuper AS superuser
			FROM pg_roles
			WHERE rolname = current_user
		`;

		expect(role).toEqual({ bypassRls: false, superuser: false });
	});

	it("hides another organization's row from a raw select", async () => {
		const inA = await asTenant(ORG_A, (tx) =>
			tx.company.create({ data: { name: "Visible to A" } }),
		);

		const seenFromB = await asTenant(
			ORG_B,
			(tx) =>
				tx.$queryRaw<{ id: string }[]>`
					SELECT id FROM "company" WHERE id = ${inA.id}
				`,
		);

		expect(seenFromB).toHaveLength(0);
	});

	it("refuses an insert for another organization", async () => {
		await expect(
			asTenant(
				ORG_A,
				(tx) =>
					tx.$executeRaw`
						INSERT INTO "company" (id, "organizationId", name, "createdAt", "updatedAt")
						VALUES (${`${ORG_B}-sneak`}, ${ORG_B}, 'Sneak', now(), now())
					`,
			),
		).rejects.toThrow();
	});

	it("forces policies for the table owner", async () => {
		const [company] = await db.$queryRaw<
			{ currentUser: string; forceRowSecurity: boolean; tableOwner: string }[]
		>`
			SELECT
				current_user AS "currentUser",
				pg_get_userbyid(c.relowner) AS "tableOwner",
				c.relforcerowsecurity AS "forceRowSecurity"
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = current_schema() AND c.relname = 'company'
		`;

		expect(company?.currentUser).toBe(company?.tableOwner);
		expect(company?.forceRowSecurity).toBe(true);

		const rows = await asTenant(
			ORG_A,
			(tx) =>
				tx.$queryRaw<{ organizationId: string }[]>`
					SELECT "organizationId"
					FROM "company"
					WHERE "organizationId" = ${ORG_B}
				`,
		);

		expect(rows).toHaveLength(0);
	});

	it("defaults organizationId from the transaction tenant", async () => {
		const created = await asTenant(ORG_A, (tx) =>
			tx.company.create({ data: { name: "Defaulted" } }),
		);

		expect(created.organizationId).toBe(ORG_A);
	});

	it("fails closed without a tenant transaction", async () => {
		await expect(
			asTenant(null, (tx) =>
				tx.company.create({ data: { name: "No tenant context" } }),
			),
		).rejects.toThrow();
	});
});
