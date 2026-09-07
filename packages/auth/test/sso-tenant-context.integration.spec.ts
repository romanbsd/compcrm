import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runInTenant, tryCurrentOrganizationId } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import { auth } from "../src/auth";
import {
	resolveSsoRequestOrganizationId,
	runSsoRequestInTenant,
} from "../src/sso-tenant-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const organizationA = `sso-request-org-a-${suffix}`;
const organizationB = `sso-request-org-b-${suffix}`;
const providerA = `sso-request-provider-a-${suffix}`;
const providerB = `sso-request-provider-b-${suffix}`;

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: organizationA,
				name: `SSO Request A ${suffix}`,
				slug: organizationA,
				createdAt: new Date(),
			},
			{
				id: organizationB,
				name: `SSO Request B ${suffix}`,
				slug: organizationB,
				createdAt: new Date(),
			},
		],
	});
	await runInTenant(organizationA, () =>
		scopedDb.ssoProvider.create({
			data: {
				id: `sso-request-row-a-${suffix}`,
				providerId: providerA,
				issuer: "https://a.example.com",
				domain: "a.example.com, parent.example.com",
			},
		}),
	);
	await runInTenant(organizationB, () =>
		scopedDb.ssoProvider.create({
			data: {
				id: `sso-request-row-b-${suffix}`,
				providerId: providerB,
				issuer: "https://b.example.com",
				domain: "b.example.com",
			},
		}),
	);
});

afterAll(async () => {
	await db.organization.deleteMany({
		where: { id: { in: [organizationA, organizationB] } },
	});
});

describe("SSO request tenant routing", () => {
	it("scopes the Better Auth SSO adapter", async () => {
		const adapter = (await auth.$context).adapter;

		await expect(
			Promise.resolve(
				adapter.findOne({
					model: "ssoProvider",
					where: [{ field: "providerId", value: providerA }],
				}),
			),
		).rejects.toThrow("No active tenant context");

		const provider = await runSsoRequestInTenant(
			{
				url: "/api/auth/sign-in/sso",
				body: { providerId: providerA },
			},
			() =>
				adapter.findOne({
					model: "ssoProvider",
					where: [{ field: "providerId", value: providerA }],
				}),
		);

		expect(provider?.organizationId).toBe(organizationA);
	});

	it("routes provider sign-in and callback requests", async () => {
		expect(
			await resolveSsoRequestOrganizationId({
				originalUrl: "/api/auth/sign-in/sso",
				body: { providerId: providerA },
			}),
		).toBe(organizationA);

		expect(
			await resolveSsoRequestOrganizationId({
				originalUrl: `/api/auth/sso/callback/${providerB}?code=ok`,
			}),
		).toBe(organizationB);
	});

	it("routes domain, email, and organization sign-in requests", async () => {
		expect(
			await resolveSsoRequestOrganizationId({
				url: "/api/auth/sign-in/sso",
				body: { domain: "child.parent.example.com" },
			}),
		).toBe(organizationA);

		expect(
			await resolveSsoRequestOrganizationId({
				url: "/api/auth/sign-in/sso",
				body: { email: "person@b.example.com" },
			}),
		).toBe(organizationB);

		expect(
			await resolveSsoRequestOrganizationId({
				url: "/api/auth/sign-in/sso",
				body: { organizationSlug: organizationA },
			}),
		).toBe(organizationA);
	});

	it("routes provider management requests", async () => {
		expect(
			await resolveSsoRequestOrganizationId({
				url: `/api/auth/sso/get-provider?providerId=${providerA}`,
			}),
		).toBe(organizationA);

		expect(
			await resolveSsoRequestOrganizationId({
				url: "/api/auth/sso/register",
				body: { organizationId: organizationB },
			}),
		).toBe(organizationB);
	});

	it("does not create context for unrelated or unresolved requests", async () => {
		await runSsoRequestInTenant({ url: "/api/auth/session" }, async () => {
			expect(tryCurrentOrganizationId()).toBeUndefined();
		});

		await runSsoRequestInTenant(
			{
				url: "/api/auth/sign-in/sso",
				body: { providerId: `missing-${suffix}` },
			},
			async () => {
				expect(tryCurrentOrganizationId()).toBeUndefined();
			},
		);
	});

	it("keeps concurrent tenant contexts separate", async () => {
		const seen = await Promise.all(
			[providerA, providerB].map((providerId) =>
				runSsoRequestInTenant(
					{
						url: "/api/auth/sign-in/sso",
						body: { providerId },
					},
					async () => {
						await Promise.resolve();
						return tryCurrentOrganizationId();
					},
				),
			),
		);

		expect(seen).toEqual([organizationA, organizationB]);
		expect(tryCurrentOrganizationId()).toBeUndefined();
	});
});
