import { describe, expect, it } from "bun:test";
import { contactName } from "../components/crm/contact-name";

describe("contactName", () => {
	it("uses the name parts", () => {
		expect(contactName({ firstName: "Alex", lastName: "Morgan" })).toBe(
			"Alex Morgan",
		);
	});
});
