import { afterEach, describe, expect, it } from "bun:test";
import {
	currentOrganizationId,
	runInTenant,
	TenantContextError,
	tryCurrentOrganizationId,
} from "./tenant-context";

describe("tenant context", () => {
	afterEach(() => {
		expect.hasAssertions();
	});

	it("has no context outside runInTenant", () => {
		expect(tryCurrentOrganizationId()).toBeUndefined();
	});

	it("throws TenantContextError when currentOrganizationId is used outside context", () => {
		expect(() => {
			currentOrganizationId();
		}).toThrow(TenantContextError);
	});

	it("makes the organization ID available inside runInTenant", () => {
		const organizationId = runInTenant("org-1", () => {
			return currentOrganizationId();
		});

		expect(organizationId).toBe("org-1");
	});

	it("returns the callback result from runInTenant", () => {
		const result = runInTenant("org-2", () => {
			return {
				ok: true,
				organizationId: currentOrganizationId(),
			};
		});

		expect(result).toEqual({
			ok: true,
			organizationId: "org-2",
		});
	});

	it("does not leak context between sibling runs", async () => {
		const [a, b] = await Promise.all([
			runInTenant("org-1", async () => {
				await Promise.resolve();
				return currentOrganizationId();
			}),
			runInTenant("org-2", async () => {
				await Promise.resolve();
				return currentOrganizationId();
			}),
		]);

		expect(a).toBe("org-1");
		expect(b).toBe("org-2");
		expect(tryCurrentOrganizationId()).toBeUndefined();
		expect(() => {
			currentOrganizationId();
		}).toThrow(TenantContextError);
	});

	it("restores outer context when nested runInTenant calls", () => {
		const result = runInTenant("outer", () => {
			expect(currentOrganizationId()).toBe("outer");

			const inner = runInTenant("inner", () => {
				expect(currentOrganizationId()).toBe("inner");
				return currentOrganizationId();
			});

			expect(currentOrganizationId()).toBe("outer");
			expect(inner).toBe("inner");

			return currentOrganizationId();
		});

		expect(result).toBe("outer");
	});

	it("propagates context across Promise boundaries", async () => {
		const result = await runInTenant("org-async", async () => {
			await Promise.resolve("step");
			return currentOrganizationId();
		});

		expect(result).toBe("org-async");
	});
});
