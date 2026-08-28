import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { AgentQueueService } from "../src/agent/agent-queue.service";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { CompanyDirectoryService } from "../src/companies/company-directory.service";
import { contactListInput } from "../src/contacts/contacts.contracts";
import { ContactsService } from "../src/contacts/contacts.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { FieldsService } from "../src/fields/fields.service";

const suffix = process.env.TEST_RUN_ID ?? "contacts-search-spec";
const email = `contacts-search.${suffix}@example.test`;
const agent = {} as AgentTriggerService;
const contacts = new ContactsService(
	db,
	new CompanyDirectoryService(agent),
	agent,
	new AgentQueueService(db),
	new ActivityStampService(db),
	new FieldsService(db, agent),
);

beforeAll(async () => {
	await db.contact.deleteMany({ where: { email } });
	await db.contact.create({
		data: {
			firstName: "Stored",
			lastName: "Names",
			email: email,
		},
	});
});

afterAll(async () => {
	await db.contact.deleteMany({ where: { email } });
});

describe("ContactsService search", () => {
	it("matches a contact name in the contact list", async () => {
		const result = await contacts.list(contactListInput.parse({ q: "Stored" }));

		expect(result.rows).toContainEqual(
			expect.objectContaining({
				email,
				firstName: "Stored",
				lastName: "Names",
			}),
		);
	});
});
