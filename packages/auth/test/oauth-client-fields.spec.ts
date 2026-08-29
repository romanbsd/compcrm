import { describe, expect, it } from "bun:test";

process.env.API_URL = "https://crm.example.test";
process.env.APP_URL = "https://crm.example.app";

const { oauthClientFields, OAUTH_SCOPES } = await import("../src/oauth-config");

describe("oauthClientFields", () => {
	const fields = oauthClientFields({
		clientId: "custom-client",
		name: "Custom client",
		redirectUris: ["https://app.example/callback"],
		postLogoutRedirectUris: ["https://app.example/logout"],
		skipConsent: false,
	});

	it("identifies the client by its clientId", () => {
		expect(fields.clientId).toBe("custom-client");
	});

	it("grants every declared scope", () => {
		expect(fields.scopes).toEqual([...OAUTH_SCOPES]);
	});

	it("demands PKCE for the native flow", () => {
		expect(fields.requirePKCE).toBe(true);
		expect(fields.tokenEndpointAuthMethod).toBe("none");
	});

	it("supports only the authorization-code grant", () => {
		expect(fields.grantTypes).toEqual(["authorization_code", "refresh_token"]);
		expect(fields.responseTypes).toEqual(["code"]);
	});
});
