import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { parseApiKeyPrincipalMetadata } from "../src/auth/api-key-principal";

describe("parseApiKeyPrincipalMetadata", () => {
	it("returns the API key creator", () => {
		expect(parseApiKeyPrincipalMetadata({ createdByUserId: "user-1" })).toEqual(
			{ createdByUserId: "user-1" },
		);
	});

	it("rejects missing creator metadata", () => {
		expect(() => parseApiKeyPrincipalMetadata({})).toThrow(z.ZodError);
	});
});
