import { afterAll, describe, expect, it } from "bun:test";
import { googleHostedDomain } from "../src/workspace";

const originalAllowList = process.env.ALLOWED_SIGN_IN;

afterAll(() => {
	if (originalAllowList === undefined) {
		delete process.env.ALLOWED_SIGN_IN;
		return;
	}
	process.env.ALLOWED_SIGN_IN = originalAllowList;
});

describe("googleHostedDomain", () => {
	it("uses the only allowed domain", () => {
		process.env.ALLOWED_SIGN_IN = "majesticlabs.dev";
		expect(googleHostedDomain()).toBe("majesticlabs.dev");
	});

	it("does not restrict Google when an address is allowed", () => {
		process.env.ALLOWED_SIGN_IN = "david@paluy.org, majesticlabs.dev";
		expect(googleHostedDomain()).toBeUndefined();
	});

	it("does not restrict Google when multiple domains are allowed", () => {
		process.env.ALLOWED_SIGN_IN = "majesticlabs.dev, altertx.com";
		expect(googleHostedDomain()).toBeUndefined();
	});
});
