import { describe, expect, it } from "bun:test";
import { contactName } from "../components/crm/contact-name";

describe("contactName", () => {
	it("uses displayName before the name parts", () => {
		expect(
			contactName({
				displayName: "Northwind owner",
				firstName: "Alex",
				lastName: "Morgan",
			}),
		).toBe("Northwind owner");
	});

	it("falls back to the name parts", () => {
		expect(
			contactName({ displayName: null, firstName: "Alex", lastName: "Morgan" }),
		).toBe("Alex Morgan");
	});
});
