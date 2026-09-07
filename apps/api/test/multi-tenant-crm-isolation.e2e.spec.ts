import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import {
	companyCreateInput,
	companyListInput,
} from "../src/companies/companies.contracts";
import { CompaniesService } from "../src/companies/companies.service";
import {
	contactCreateInput,
	contactListInput,
} from "../src/contacts/contacts.contracts";
import { ContactsService } from "../src/contacts/contacts.service";
import { dealCreateInput, dealListInput } from "../src/deals/deals.contracts";
import { DealsService } from "../src/deals/deals.service";

const suffix = process.env.TEST_RUN_ID ?? crypto.randomUUID();
const organizationA = `mt-crm-a-${suffix}`;
const organizationB = `mt-crm-b-${suffix}`;
const ownerA = `mt-crm-owner-a-${suffix}`;
const ownerB = `mt-crm-owner-b-${suffix}`;
const sharedEmail = `shared-${suffix}@example.com`;

let moduleFixture: TestingModule | undefined;
let companies: CompaniesService;
let contacts: ContactsService;
let deals: DealsService;

beforeAll(async () => {
	const { AppModule } = await import("../src/app.module");

	moduleFixture = await Test.createTestingModule({
		imports: [AppModule],
	}).compile();
	companies = moduleFixture.get(CompaniesService);
	contacts = moduleFixture.get(ContactsService);
	deals = moduleFixture.get(DealsService);

	await db.organization.createMany({
		data: [
			{
				id: organizationA,
				name: "Isolation Organization A",
				slug: organizationA,
				createdAt: new Date(),
			},
			{
				id: organizationB,
				name: "Isolation Organization B",
				slug: organizationB,
				createdAt: new Date(),
			},
		],
	});
	await db.user.createMany({
		data: [
			{
				id: ownerA,
				name: "Isolation Owner A",
				email: `${ownerA}@example.com`,
				emailVerified: true,
			},
			{
				id: ownerB,
				name: "Isolation Owner B",
				email: `${ownerB}@example.com`,
				emailVerified: true,
			},
		],
	});
	await Promise.all([
		runInTenant(organizationA, () =>
			scopedDb.appSetting.create({
				data: { organizationId: organizationA, reportingCurrency: "USD" },
			}),
		),
		runInTenant(organizationB, () =>
			scopedDb.appSetting.create({
				data: { organizationId: organizationB, reportingCurrency: "USD" },
			}),
		),
	]);
});

afterAll(async () => {
	await moduleFixture?.close();
	await db.organization.deleteMany({
		where: { id: { in: [organizationA, organizationB] } },
	});
	await db.user.deleteMany({ where: { id: { in: [ownerA, ownerB] } } });
});

describe("cross-tenant CRM isolation through Nest services", () => {
	it("isolates company writes, lists, and reads", async () => {
		const companyA = await runInTenant(organizationA, () =>
			companies.create(
				companyCreateInput.parse({ name: "Company A", ownerId: ownerA }),
			),
		);
		await runInTenant(organizationB, () =>
			companies.create(
				companyCreateInput.parse({ name: "Company B", ownerId: ownerB }),
			),
		);

		const listA = await runInTenant(organizationA, () =>
			companies.list(companyListInput.parse({ pageSize: 100 })),
		);

		expect(listA.rows.map((row) => row.name)).toEqual(["Company A"]);
		await expect(
			runInTenant(organizationB, () => companies.byId(companyA.id)),
		).rejects.toThrow(`No company with id ${companyA.id}.`);
	});

	it("permits the same contact email without cross-tenant reads", async () => {
		await runInTenant(organizationA, () =>
			contacts.create(
				contactCreateInput.parse({
					firstName: "Contact A",
					email: sharedEmail,
				}),
			),
		);
		await runInTenant(organizationB, () =>
			contacts.create(
				contactCreateInput.parse({
					firstName: "Contact B",
					email: sharedEmail,
				}),
			),
		);

		const listA = await runInTenant(organizationA, () =>
			contacts.list(contactListInput.parse({ pageSize: 100 })),
		);

		expect(listA.rows.map((row) => row.firstName)).toEqual(["Contact A"]);
	});

	it("isolates deal writes and lists", async () => {
		const companyA = await runInTenant(organizationA, () =>
			companies.create(companyCreateInput.parse({ name: "Deal Company A" })),
		);
		const companyB = await runInTenant(organizationB, () =>
			companies.create(companyCreateInput.parse({ name: "Deal Company B" })),
		);
		await runInTenant(organizationA, () =>
			deals.create(
				dealCreateInput.parse({
					name: "Deal A",
					companyId: companyA.id,
					ownerId: ownerA,
					amountCents: 10_000,
					currency: "USD",
				}),
			),
		);
		await runInTenant(organizationB, () =>
			deals.create(
				dealCreateInput.parse({
					name: "Deal B",
					companyId: companyB.id,
					ownerId: ownerB,
					amountCents: 20_000,
					currency: "USD",
				}),
			),
		);

		const listA = await runInTenant(organizationA, () =>
			deals.list(dealListInput.parse({ pageSize: 100 })),
		);

		expect(listA.rows.map((row) => row.name)).toEqual(["Deal A"]);
	});
});
