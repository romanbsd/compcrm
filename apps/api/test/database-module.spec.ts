import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { db } from "@crm/db";
import { runInTenant, TenantContextError } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import { Test, type TestingModule } from "@nestjs/testing";
import { DATABASE, SCOPED_DATABASE } from "../src/database/database.constants";
import { DatabaseModule } from "../src/database/database.module";

const makeName = (label: string) =>
	`${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const makeOrganizationId = (label: string) => makeName(`org-${label}`);

let database: Db;
let scoped: typeof scopedDb;
let moduleFixture: TestingModule;
const organizationIds: string[] = [];

beforeAll(async () => {
	moduleFixture = await Test.createTestingModule({
		imports: [DatabaseModule],
	}).compile();

	database = moduleFixture.get(DATABASE);
	scoped = moduleFixture.get(SCOPED_DATABASE);
});

afterAll(async () => {
	await db.company.deleteMany({
		where: { organizationId: { in: organizationIds } },
	});

	await db.organization.deleteMany({
		where: { id: { in: organizationIds } },
	});

	await moduleFixture.close();
});

describe("database module", () => {
	it("resolves raw and scoped providers from dependency injection", () => {
		expect(database).toBe(db);
		expect(scoped).toBe(scopedDb);
	});

	it("rejects tenant access on scoped models when outside tenant context", async () => {
		await expect(Promise.resolve(scoped.company.findMany())).rejects.toThrow(
			TenantContextError,
		);
		await expect(
			Promise.resolve(
				scoped.company.create({
					data: { name: makeName("outside") },
				} as never),
			),
		).rejects.toThrow(TenantContextError);
	});

	it("stamps the active tenant on scoped Company writes", async () => {
		const organizationId = makeOrganizationId("write");
		const companyName = makeName("company");
		organizationIds.push(organizationId);

		await db.organization.create({
			data: {
				id: organizationId,
				name: `Org ${organizationId}`,
				slug: `org-${organizationId}`,
				createdAt: new Date(),
			},
		});

		const created = await runInTenant(organizationId, () =>
			Promise.resolve(
				scoped.company.create({
					data: { name: companyName } as never,
				}),
			),
		);

		expect(created.organizationId).toBe(organizationId);
	});
});
