import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, FactBand, FactStatus } from "@crm/db";
import { sweepBlankFacts } from "../agent/lib/blank-facts";
import { tenantTransaction } from "@crm/db/tenant-scope";

const suffix = crypto.randomUUID();
const ORG_A = `blank-facts-tenant-a-${suffix}`;
const ORG_B = `blank-facts-tenant-b-${suffix}`;

let contactAId = "";
let contactBId = "";
let factAId = "";
let factBId = "";

async function seedTenant(
	organizationId: string,
	name: string,
): Promise<{ contactId: string; factId: string }> {
	return tenantTransaction(organizationId, async (tx) => {
		const contact = await tx.contact.create({
			data: {
				firstName: name,
				email: `${organizationId}@example.test`,
			},
			select: { id: true },
		});
		const fact = await tx.contactFact.create({
			data: {
				contactId: contact.id,
				field: "title",
				value: `Title for ${name}`,
				score: 0.61,
				band: FactBand.PROBABLE,
				evidence: [{ kind: "web.cited-claim", detail: "a page said so" }],
				method: "web",
				status: FactStatus.PROPOSED,
			},
			select: { id: true },
		});

		return { contactId: contact.id, factId: fact.id };
	});
}

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: ORG_A,
				name: "Blank Facts Tenant A",
				slug: ORG_A,
				createdAt: new Date(),
			},
			{
				id: ORG_B,
				name: "Blank Facts Tenant B",
				slug: ORG_B,
				createdAt: new Date(),
			},
		],
	});

	const [tenantA, tenantB] = await Promise.all([
		seedTenant(ORG_A, "Tenant A Contact"),
		seedTenant(ORG_B, "Tenant B Contact"),
	]);
	contactAId = tenantA.contactId;
	contactBId = tenantB.contactId;
	factAId = tenantA.factId;
	factBId = tenantB.factId;
});

afterAll(async () => {
	await tenantTransaction(ORG_A, (tx) =>
		tx.contact.deleteMany({ where: { id: contactAId } }),
	);
	await tenantTransaction(ORG_B, (tx) =>
		tx.contact.deleteMany({ where: { id: contactBId } }),
	);
	await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
});

describe("blank fact tenant sweep", () => {
	it("fills pending facts across organizations through tenant scopes", async () => {
		const organizationCount = await db.organization.count({
			where: { id: { in: [ORG_A, ORG_B] } },
		});
		const [pendingA, pendingB] = await Promise.all([
			tenantTransaction(ORG_A, (tx) =>
				tx.contactFact.count({
					where: { organizationId: ORG_A, status: FactStatus.PROPOSED },
				}),
			),
			tenantTransaction(ORG_B, (tx) =>
				tx.contactFact.count({
					where: { organizationId: ORG_B, status: FactStatus.PROPOSED },
				}),
			),
		]);

		expect(organizationCount).toBe(2);
		expect(pendingA).toBe(1);
		expect(pendingB).toBe(1);

		const sweep = await sweepBlankFacts();
		const [tenantA, tenantB] = await Promise.all([
			tenantTransaction(ORG_A, async (tx) => ({
				contact: await tx.contact.findUnique({ where: { id: contactAId } }),
				fact: await tx.contactFact.findUnique({ where: { id: factAId } }),
			})),
			tenantTransaction(ORG_B, async (tx) => ({
				contact: await tx.contact.findUnique({ where: { id: contactBId } }),
				fact: await tx.contactFact.findUnique({ where: { id: factBId } }),
			})),
		]);

		expect(sweep.fills).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					contactId: contactAId,
					field: "title",
					value: "Title for Tenant A Contact",
				}),
				expect.objectContaining({
					contactId: contactBId,
					field: "title",
					value: "Title for Tenant B Contact",
				}),
			]),
		);
		expect(tenantA.contact?.title).toBe("Title for Tenant A Contact");
		expect(tenantA.fact?.status).toBe(FactStatus.APPLIED);
		expect(tenantB.contact?.title).toBe("Title for Tenant B Contact");
		expect(tenantB.fact?.status).toBe(FactStatus.APPLIED);
	});
});
