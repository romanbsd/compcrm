import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { z } from "zod";

const ssoRoutingBody = z
	.object({
		domain: z.string().optional(),
		email: z.string().optional(),
		organizationId: z.string().optional(),
		organizationSlug: z.string().optional(),
		providerId: z.string().optional(),
	})
	.loose();

export interface SsoTenantRequest {
	body?: unknown;
	originalUrl?: string;
	url?: string;
}

export async function runSsoRequestInTenant<T>(
	request: SsoTenantRequest,
	next: () => T | PromiseLike<T>,
): Promise<T> {
	const organizationId = await resolveSsoRequestOrganizationId(request);

	if (!organizationId) {
		return Promise.resolve(next());
	}

	return runInTenant(organizationId, next);
}

export async function resolveSsoRequestOrganizationId(
	request: SsoTenantRequest,
): Promise<string | undefined> {
	const url = requestUrl(request);
	const path = url.pathname;

	if (!isSsoPath(path)) {
		return undefined;
	}

	const pathProviderId = providerIdFromPath(path);
	if (pathProviderId) {
		return organizationForProvider(pathProviderId);
	}

	const parsedBody = ssoRoutingBody.safeParse(request.body);
	const body = parsedBody.success ? parsedBody.data : undefined;
	const providerId = body?.providerId ?? url.searchParams.get("providerId");
	if (providerId) {
		return organizationForProvider(providerId);
	}

	if (path.endsWith("/sso/register") && body?.organizationId) {
		return body.organizationId;
	}

	if (!path.endsWith("/sign-in/sso")) {
		return undefined;
	}

	if (body?.organizationSlug) {
		const organization = await db.organization.findUnique({
			where: { slug: body.organizationSlug },
			select: { id: true },
		});
		return organization?.id;
	}

	const domain = body?.domain ?? body?.email?.split("@")[1];
	if (!domain) {
		return undefined;
	}

	const locators = await db.ssoProviderLocator.findMany({
		select: { organizationId: true, domain: true },
	});
	return locators.find((locator) => domainMatches(domain, locator.domain))
		?.organizationId;
}

function requestUrl(request: SsoTenantRequest): URL {
	return new URL(request.originalUrl ?? request.url ?? "/", "http://localhost");
}

function isSsoPath(path: string): boolean {
	return path.includes("/sso/") || path.endsWith("/sign-in/sso");
}

function providerIdFromPath(path: string): string | undefined {
	const match = path.match(
		/\/sso\/(?:callback|saml2\/sp\/(?:acs|slo)|saml2\/logout)\/([^/]+)\/?$/,
	);
	if (!match?.[1]) {
		return undefined;
	}

	try {
		return decodeURIComponent(match[1]);
	} catch {
		return undefined;
	}
}

async function organizationForProvider(
	providerId: string,
): Promise<string | undefined> {
	const locator = await db.ssoProviderLocator.findUnique({
		where: { providerId },
		select: { organizationId: true },
	});
	return locator?.organizationId;
}

function domainMatches(searchDomain: string, domainList: string): boolean {
	const search = searchDomain.trim().toLowerCase();
	if (!search) {
		return false;
	}

	return domainList
		.split(",")
		.map((domain) => domain.trim().toLowerCase())
		.filter(Boolean)
		.some((domain) => search === domain || search.endsWith(`.${domain}`));
}
