import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { SearchService } from "../src/search/search.service";

const suffix = process.env.TEST_RUN_ID ?? "search-spec";
const displayEmail = `display.${suffix}@example.test`;
const fallbackEmail = `fallback.${suffix}@example.test`;
const search = new SearchService(db);

beforeAll(async () => {
	await db.contact.deleteMany({
		where: { email: { in: [displayEmail, fallbackEmail] } },
	});
	await db.contact.createMany({
		data: [
			{
				firstName: "Stored",
				lastName: "Names",
				email: displayEmail,
			},
			{
				firstName: "Legacy",
				lastName: "Contact",
				email: fallbackEmail,
			},
		],
	});
});

afterAll(async () => {
	await db.contact.deleteMany({
		where: { email: { in: [displayEmail, fallbackEmail] } },
	});
});

describe("SearchService", () => {
	it("matches and returns a contact name", async () => {
		const result = await search.quick("Stored");

		expect(result.hits).toContainEqual({
			kind: "contact",
			id: expect.any(String),
			label: "Stored Names",
			detail: displayEmail,
			iconUrl: null,
			iconDarkUrl: null,
			iconTone: null,
			imageUrl: null,
		});
	});

	it("keeps first and last name fallback behavior", async () => {
		const result = await search.quick(fallbackEmail);

		expect(result.hits.find((hit) => hit.kind === "contact")?.label).toBe(
			"Legacy Contact",
		);
	});
});
