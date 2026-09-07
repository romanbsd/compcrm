import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { isGoogleConfigured, ssoProviderName } from "@crm/auth";
import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { type ScopedDb, scopedDb } from "@crm/db/tenant-scope";
import { ForbiddenException } from "@nestjs/common";
import { SsoService } from "../src/sso/sso.service";
import { tenantContext } from "@crm/db/test-support";

type Row = {
	providerId: string;
	issuer: string;
	domain: string;
	oidcConfig: string | null;
	samlConfig: string | null;
};

const LIST = {
	q: "",
	sort: "providerId",
	dir: "asc" as const,
	page: 1,
	pageSize: 25,
};
const organizationId = "sso-spec-organization";
const publicSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const publicOrganizationId = `sso-public-org-${publicSuffix}`;
const publicProviderId = `sso-public-provider-${publicSuffix}`;

const inTenant = tenantContext(organizationId);

type Seen = { providerWhere?: unknown };

function service(role: string | null, rows: Row[] = []) {
	const seen: Seen = {};

	const db = {
		member: {
			findUnique: async () => (role === null ? null : { role }),
		},
		ssoProvider: {
			findMany: async ({ where }: { where: unknown }) => {
				seen.providerWhere = where;
				return rows;
			},
			count: async () => rows.length,
		},
	} as unknown as ScopedDb;

	return { sso: new SsoService(db), seen };
}

const OKTA: Row = {
	providerId: "okta",
	issuer: "https://acme.okta.com",
	domain: "acme.com, subsidiary.com",
	oidcConfig: JSON.stringify({
		clientId: "0oa1b2c3d4WXYZ",
		clientSecret: "shhh",
	}),
	samlConfig: null,
};

describe("who may configure SSO", () => {
	it("lets an owner and an admin", async () => {
		for (const role of ["owner", "admin"]) {
			const { sso } = service(role);
			expect((await inTenant(() => sso.settings("u1"))).canConfigure).toBe(
				true,
			);
		}
	});

	it("refuses a member, and refuses them the writes too", async () => {
		const { sso } = service("member");

		expect((await inTenant(() => sso.settings("u1"))).canConfigure).toBe(false);

		expect(
			inTenant(() => sso.remove("u1", new Headers(), { providerId: "okta" })),
		).rejects.toBeInstanceOf(ForbiddenException);

		expect(
			inTenant(() =>
				sso.register("u1", new Headers(), {
					providerId: "okta",
					issuer: "https://acme.okta.com",
					domain: "acme.com",
					clientId: "id",
					clientSecret: "secret",
				}),
			),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("refuses somebody who is not in the workspace at all", async () => {
		const { sso } = service(null);
		expect((await inTenant(() => sso.settings("u1"))).canConfigure).toBe(false);
	});
});

describe("what a provider looks like once it is saved", () => {
	it("never hands back the client secret", async () => {
		const { sso } = service("owner", [OKTA]);
		const [provider] = (await inTenant(() => sso.list(LIST))).rows;

		expect(JSON.stringify(provider)).not.toContain("shhh");
		expect(provider?.clientIdLastFour).toBe("WXYZ");
	});

	it("splits the domains and names the callback the IdP needs", async () => {
		const { sso } = service("owner", [OKTA]);
		const [provider] = (await inTenant(() => sso.list(LIST))).rows;

		expect(provider?.domains).toEqual(["acme.com", "subsidiary.com"]);
		expect(provider?.type).toBe("oidc");
		expect(provider?.name).toBe("Okta");
		expect(provider?.callbackURL).toEndWith("/api/auth/sso/callback/okta");
	});

	it("reads only the one workspace, never an organization it was passed", async () => {
		const { sso, seen } = service("owner", [OKTA]);
		await inTenant(() => sso.list(LIST));

		expect(seen.providerWhere).toEqual({ organizationId });
	});

	it("searches the name, the domain and the issuer", async () => {
		const { sso, seen } = service("owner", [OKTA]);
		await inTenant(() => sso.list({ ...LIST, q: " acme " }));

		expect(seen.providerWhere).toEqual({
			organizationId,
			OR: [
				{ providerId: { contains: "acme", mode: "insensitive" } },
				{ domain: { contains: "acme", mode: "insensitive" } },
				{ issuer: { contains: "acme", mode: "insensitive" } },
			],
		});
	});
});

describe("the sign-in page's read", () => {
	beforeAll(async () => {
		await db.organization.create({
			data: {
				id: publicOrganizationId,
				name: `SSO Public ${publicSuffix}`,
				slug: publicOrganizationId,
				createdAt: new Date(),
			},
		});
		await runInTenant(publicOrganizationId, () =>
			scopedDb.ssoProvider.create({
				data: {
					id: `sso-public-row-${publicSuffix}`,
					organizationId: publicOrganizationId,
					providerId: publicProviderId,
					issuer: "https://public.example.com",
					domain: "public.example.com",
				},
			}),
		);
	});

	afterAll(async () => {
		await db.organization.delete({ where: { id: publicOrganizationId } });
	});

	it("carries the name and nothing else", async () => {
		const { sso } = service(null);
		const provider = (await sso.signInOptions()).providers.find(
			(row) => row.providerId === publicProviderId,
		);

		expect(provider).toEqual({
			providerId: publicProviderId,
			name: ssoProviderName(publicProviderId),
		});
	});

	it("keeps the public locator synchronized with the protected provider", async () => {
		const providerId = `${publicProviderId}-trigger`;

		await runInTenant(publicOrganizationId, () =>
			scopedDb.ssoProvider.create({
				data: {
					id: `sso-public-trigger-${publicSuffix}`,
					organizationId: publicOrganizationId,
					providerId,
					issuer: "https://trigger.example.com",
					domain: "first.example.com",
				},
			}),
		);

		try {
			expect(
				await db.ssoProviderLocator.findUnique({ where: { providerId } }),
			).toMatchObject({
				providerId,
				organizationId: publicOrganizationId,
				domain: "first.example.com",
			});

			await runInTenant(publicOrganizationId, () =>
				scopedDb.ssoProvider.update({
					where: { providerId },
					data: { domain: "second.example.com" },
				}),
			);

			expect(
				await db.ssoProviderLocator.findUnique({ where: { providerId } }),
			).toMatchObject({ domain: "second.example.com" });
		} finally {
			await runInTenant(publicOrganizationId, () =>
				scopedDb.ssoProvider.delete({ where: { providerId } }),
			);
		}

		expect(
			await db.ssoProviderLocator.findUnique({ where: { providerId } }),
		).toBeNull();
	});

	it("says whether Google is configured, so the page can offer nothing", async () => {
		const { sso } = service(null);

		expect((await sso.signInOptions()).google).toBe(isGoogleConfigured());
	});
});
