import { describe, expect, it } from "bun:test";
import { oauthSignInOptions } from "@/lib/oauth-query";

describe("oauthSignInOptions", () => {
	it("returns the plain sign-in page when there is no OAuth request", () => {
		expect(oauthSignInOptions(null, "https://crm.example")).toEqual({
			errorCallbackURL: "https://crm.example/sign-in",
		});
	});

	it("carries the OAuth request into the error URL and the callback", () => {
		expect(
			oauthSignInOptions("client_id=cmp&scope=crm.read", "https://crm.example"),
		).toEqual({
			errorCallbackURL:
				"https://crm.example/sign-in?client_id=cmp&scope=crm.read",
			oauth_query: "client_id=cmp&scope=crm.read",
		});
	});
});
