import { describe, expect } from "bun:test";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb as db } from "@crm/db/tenant-scope";
import {
	archiveField,
	createField,
	listFields,
	readFields,
	updateFieldBrief,
	writeField,
} from "../agent/lib/fields";
import { tenantAfterAll, tenantBeforeAll, tenantTest } from "@crm/db/test-support";

const suffix = process.env.TEST_RUN_ID ?? crypto.randomUUID();
const organizationId = `fields-org-${suffix}`;
const it = tenantTest(organizationId);
const beforeAll = tenantBeforeAll(organizationId);
const afterAll = tenantAfterAll(organizationId);
const contactId = `fields-contact-${suffix}`;

beforeAll(async () => {
	await db.organization.create({
		data: {
			id: organizationId,
			name: "Fields Test",
			slug: organizationId,
			createdAt: new Date(),
		},
	});
	await db.contact.create({
		data: {
			id: contactId,
			organizationId,
			firstName: "Field",
			email: `${suffix}@fields.test`,
		},
	});
});

afterAll(async () => {
	await db.organization.delete({ where: { id: organizationId } });
});

describe("custom field persistence", () => {
	it("creates, writes, updates, reads, and archives through tenant transactions", async () => {
		await runInTenant(organizationId, async () => {
			const created = await createField({
				entity: "CONTACT",
				label: "Research Note",
				type: "TEXT",
				agentBrief: "Record verified research.",
			});

			if ("created" in created) throw new Error(created.reason);
			expect(created.key).toBe("research_note");

			const listed = await listFields("CONTACT");
			expect(listed.map((field) => field.key)).toContain("research_note");

			const written = await writeField({
				entity: "CONTACT",
				recordId: contactId,
				key: "research_note",
				value: "Confirmed by the customer.",
			});
			expect(written).toEqual({
				written: true,
				key: "research_note",
				value: "Confirmed by the customer.",
			});

			const fields = await readFields("CONTACT", contactId);
			expect(fields.find((field) => field.key === "research_note")?.value).toBe(
				"Confirmed by the customer.",
			);

			const updated = await updateFieldBrief({
				entity: "CONTACT",
				key: "research_note",
				agentBrief: "A rep maintains this field.",
				agentFilled: false,
			});
			if ("updated" in updated) throw new Error(updated.reason);
			expect(updated.agentFilled).toBe(false);

			const refused = await writeField({
				entity: "CONTACT",
				recordId: contactId,
				key: "research_note",
				value: "Agent replacement",
			});
			expect(refused.written).toBe(false);

			expect(
				await archiveField({ entity: "CONTACT", key: "research_note" }),
			).toEqual({ archived: true });
			expect(await listFields("CONTACT")).toEqual([]);
		});
	});

	it("rejects a field write when the record does not exist", async () => {
		await runInTenant(organizationId, async () => {
			const created = await createField({
				entity: "CONTACT",
				label: "Source Detail",
				type: "TEXT",
			});
			if ("created" in created) throw new Error(created.reason);

			const result = await writeField({
				entity: "CONTACT",
				recordId: "missing-contact",
				key: created.key,
				value: "Never stored",
			});

			expect(result).toEqual({
				written: false,
				reason: 'There is no contact with id "missing-contact".',
			});
		});
	});
});
