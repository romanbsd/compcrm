import { describe, expect, it } from "bun:test";

process.env.API_URL = "https://crm.example.test";
process.env.APP_URL = "https://crm.example.app";

const { bearerChallenge, oauthScopeFailure, requiredCrmScope } = await import(
	"../src/oauth-scope"
);

describe("requiredCrmScope", () => {
	it("returns the read scope for reads", () => {
		expect(requiredCrmScope(false)).toBe("crm.read");
	});

	it("returns the write scope for writes", () => {
		expect(requiredCrmScope(true)).toBe("crm.write");
	});
});

describe("bearerChallenge", () => {
	it("names only the realm when there is no error", () => {
		expect(bearerChallenge()).toBe('Bearer realm="compcrm"');
	});

	it("adds the error code when given one", () => {
		expect(bearerChallenge("invalid_token")).toBe(
			'Bearer realm="compcrm", error="invalid_token"',
		);
	});

	it("adds the scope alongside the error", () => {
		expect(bearerChallenge("insufficient_scope", "crm.write")).toBe(
			'Bearer realm="compcrm", error="insufficient_scope", scope="crm.write"',
		);
	});
});

describe("oauthScopeFailure", () => {
	it("returns null when the scope is granted", () => {
		expect(oauthScopeFailure(new Set(["crm.read"]), "crm.read")).toBeNull();
	});

	it("returns the challenge and message when the scope is missing", () => {
		const failure = oauthScopeFailure(new Set(["crm.read"]), "crm.write");

		expect(failure).toEqual({
			challenge:
				'Bearer realm="compcrm", error="insufficient_scope", scope="crm.write"',
			message: "The token requires crm.write.",
		});
	});
});
