import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { ConversionService } from "../src/currency/conversion.service";
import { dealCreateInput } from "../src/deals/deals.contracts";
import { DealsService } from "../src/deals/deals.service";
import { FieldsService } from "../src/fields/fields.service";
import { withDiscardedCrmEvents } from "./agent-trigger.stub";

const suffix = process.env.TEST_RUN_ID ?? "deal-contacts-spec";
const userId = `user-${suffix}`;
const domain = `dealpeople-${suffix}.test`;
const otherDomain = `elsewhere-${suffix}.test`;

const agent = {
	withCrmEvents: withDiscardedCrmEvents,
} as unknown as AgentTriggerService;

const deals = new DealsService(
	db,
	agent,
	new ActivityStampService(db),
	new ConversionService(db),
	new FieldsService(db, { fieldBackfill: async () => undefined } as never),
);

let companyId: string;
let dealId: string;
let championId: string;
let colleagueId: string;
let outsiderId: string;

async function clean() {
	await db.deal.deleteMany({ where: { company: { domain } } });
	await db.contact.deleteMany({
		where: { company: { domain: { in: [domain, otherDomain] } } },
	});
	await db.company.deleteMany({
		where: { domain: { in: [domain, otherDomain] } },
	});
	await db.user.deleteMany({ where: { id: userId } });
}

beforeAll(async () => {
	await clean();

	await db.user.create({
		data: {
			id: userId,
			name: "Deal Rep",
			email: `${userId}@example.test`,
			emailVerified: true,
		},
	});

	const company = await db.company.create({
		data: { name: `People Co ${suffix}`, domain },
		select: { id: true },
	});
	companyId = company.id;

	const other = await db.company.create({
		data: { name: `Other Co ${suffix}`, domain: otherDomain },
		select: { id: true },
	});

	const champion = await db.contact.create({
		data: {
			firstName: "Ada",
			lastName: "Champion",
			companyId,
		},
		select: { id: true },
	});
	championId = champion.id;
	await db.company.update({
		where: { id: companyId },
		data: { primaryContactId: championId },
	});

	const colleague = await db.contact.create({
		data: { firstName: "Beau", lastName: "Colleague", companyId },
		select: { id: true },
	});
	colleagueId = colleague.id;

	const outsider = await db.contact.create({
		data: { firstName: "Cass", lastName: "Outsider", companyId: other.id },
		select: { id: true },
	});
	outsiderId = outsider.id;

	const deal = await deals.create({
		name: `Renewal ${suffix}`,
		companyId,
		ownerId: userId,
	});
	dealId = deal.id;
});

afterAll(clean);

describe("bringing a contact onto a deal", () => {
	it("creates a project for a customer and keeps its project fields", async () => {
		const project = await deals.create({
			name: `Kitchen ${suffix}`,
			companyId,
			ownerId: userId,
			leadSource: "Referral",
			projectType: "Kitchen",
			addressLine1: "1 Main Street",
			addressLine2: "Unit 2",
			city: "Austin",
			state: "TX",
			postalCode: "78701",
		});

		const detail = await deals.byId(project.id);
		expect(detail.stage).toBe("LEAD");
		expect(detail.company?.id).toBe(companyId);
		expect(detail.leadSource).toBe("Referral");
		expect(detail.addressLine1).toBe("1 Main Street");

		await deals.purge(project.id);
	});

	it("lists the company primary contact separately from its customer", async () => {
		const project = await deals.create({
			name: `Primary contact project ${suffix}`,
			companyId,
			ownerId: userId,
		});
		await deals.attachContact({
			dealId: project.id,
			contactId: championId,
		});

		const list = await deals.list({
			q: "",
			page: 1,
			pageSize: 100,
			sort: "createdAt",
			dir: "desc",
			status: "all",
			owner: [],
			stage: [],
			closing: [],
			fields: {},
			archived: false,
		});

		const projectRow = list.rows.find((row) => row.id === project.id);
		const companyRow = list.rows.find((row) => row.id === dealId);
		expect(projectRow).toMatchObject({
			company: { id: companyId },
			primaryContact: {
				id: championId,
				firstName: "Ada",
				lastName: "Champion",
			},
		});
		expect(companyRow?.company?.id).toBe(companyId);
		expect(companyRow?.primaryContact).toMatchObject({
			id: championId,
			firstName: "Ada",
			lastName: "Champion",
		});

		await deals.purge(project.id);
	});

	it("finds customer projects by an attached contact", async () => {
		const contactProject = await deals.create({
			name: `Contact project ${suffix}`,
			companyId,
			ownerId: userId,
		});
		await deals.attachContact({
			dealId: contactProject.id,
			contactId: championId,
		});

		const contactMatches = await deals.list({
			q: "Ada Champion",
			page: 1,
			pageSize: 100,
			sort: "createdAt",
			dir: "desc",
			status: "all",
			owner: [],
			stage: [],
			closing: [],
			fields: {},
			archived: false,
		});
		expect(contactMatches.rows.map((row) => row.id)).toContain(
			contactProject.id,
		);

		const nameProject = await deals.create({
			name: `Fallback name project ${suffix}`,
			companyId,
			ownerId: userId,
		});
		await deals.attachContact({
			dealId: nameProject.id,
			contactId: colleagueId,
		});

		const nameMatches = await deals.list({
			q: "Beau Colleague",
			page: 1,
			pageSize: 100,
			sort: "createdAt",
			dir: "desc",
			status: "all",
			owner: [],
			stage: [],
			closing: [],
			fields: {},
			archived: false,
		});
		expect(nameMatches.rows.map((row) => row.id)).toContain(nameProject.id);

		await deals.purge(contactProject.id);
		await deals.purge(nameProject.id);
	});

	it("allows open initial stages and rejects closed project stages", async () => {
		const base = { name: "Stage validation", companyId, ownerId: userId };

		expect(
			dealCreateInput.safeParse({ name: base.name, ownerId: userId }).success,
		).toBe(false);
		expect(
			dealCreateInput.safeParse({ ...base, companyId: null }).success,
		).toBe(false);

		expect(dealCreateInput.safeParse({ ...base, stage: "LOST" }).success).toBe(
			false,
		);
		expect(
			dealCreateInput.safeParse({ ...base, stage: "COMPLETE" }).success,
		).toBe(false);
		expect(
			dealCreateInput.safeParse({ ...base, stage: "IN_PROGRESS" }).success,
		).toBe(true);

		const project = await deals.create({
			name: "Open stage project",
			companyId,
			ownerId: userId,
			stage: "IN_PROGRESS",
		});
		expect((await deals.byId(project.id)).stage).toBe("IN_PROGRESS");
		await deals.purge(project.id);
	});

	it("offers active contacts that are not already attached", async () => {
		const options = await deals.contactOptions(dealId);
		const ids = options.map((option) => option.id);

		expect(ids).toContain(championId);
		expect(ids).toContain(colleagueId);
		expect(ids).toContain(outsiderId);
	});

	it("attaches with a role and reads back on the deal", async () => {
		await deals.attachContact({
			dealId,
			contactId: championId,
			role: "Champion",
		});

		const deal = await deals.byId(dealId);

		expect(deal.contacts).toHaveLength(1);
		expect(deal.contacts[0]?.id).toBe(championId);
		expect(deal.contacts[0]?.role).toBe("Champion");
		expect(deal.contacts[0]?.firstName).toBe("Ada");
		expect(deal.contacts[0]?.lastName).toBe("Champion");
	});

	it("stops offering somebody already on it", async () => {
		const options = await deals.contactOptions(dealId);

		expect(options.map((option) => option.id)).not.toContain(championId);
	});

	it("attaching twice keeps the role it already has", async () => {
		await deals.attachContact({ dealId, contactId: championId });

		const deal = await deals.byId(dealId);

		expect(deal.contacts).toHaveLength(1);
		expect(deal.contacts[0]?.role).toBe("Champion");
	});

	it("attaches somebody who works somewhere else", async () => {
		await deals.attachContact({ dealId, contactId: outsiderId });

		const deal = await deals.byId(dealId);
		expect(deal.contacts.map((contact) => contact.id)).toContain(outsiderId);
		await deals.detachContact({ dealId, contactId: outsiderId });
	});

	it("blanks a role rather than storing an empty string", async () => {
		await deals.setContactRole({ dealId, contactId: championId, role: "  " });

		const deal = await deals.byId(dealId);

		expect(deal.contacts[0]?.role).toBeNull();
	});

	it("will not set a role on somebody who is not on the deal", async () => {
		await expect(
			deals.setContactRole({
				dealId,
				contactId: colleagueId,
				role: "Blocker",
			}),
		).rejects.toThrow("That contact is not on this project.");
	});

	it("takes them off again, leaving the contact in the CRM", async () => {
		await deals.detachContact({ dealId, contactId: championId });

		const deal = await deals.byId(dealId);

		expect(deal.contacts).toHaveLength(0);
		expect(await db.contact.count({ where: { id: championId } })).toBe(1);
	});

	it("says so when they were never on it", async () => {
		await expect(
			deals.detachContact({ dealId, contactId: championId }),
		).rejects.toThrow("That contact is not on this project.");
	});

	it("allows multiple contacts per deal", async () => {
		await deals.attachContact({
			dealId,
			contactId: championId,
		});
		await deals.attachContact({
			dealId,
			contactId: colleagueId,
		});

		const links = await db.dealContact.findMany({
			where: { dealId },
			select: { contactId: true, role: true },
		});
		expect(links.map((link) => link.contactId)).toEqual(
			expect.arrayContaining([championId, colleagueId]),
		);
	});

	it("allows draft documents without an issue date", async () => {
		const document = await db.document.create({
			data: {
				dealId,
				type: "ESTIMATE",
				number: `DRAFT-${suffix}`,
				status: "DRAFT",
				recipientSnapshot: { name: "Homeowner" },
				contractorSnapshot: { name: "Builder" },
				projectSnapshot: { name: "Kitchen" },
				subtotal: "100.00",
				tax: "8.25",
				total: "108.25",
				lineItems: {
					create: {
						description: "Cabinets",
						quantity: "1.00",
						unitPrice: "100.00",
						total: "100.00",
						position: 0,
					},
				},
			},
			select: {
				id: true,
				currency: true,
				issuedAt: true,
				lineItems: { select: { description: true } },
			},
		});

		expect(document.issuedAt).toBeNull();
		expect(document.currency).toBe("USD");
		expect(document.lineItems[0]?.description).toBe("Cabinets");

		await db.document.delete({ where: { id: document.id } });
	});
});
