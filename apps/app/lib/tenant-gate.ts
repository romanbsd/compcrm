import { db } from "@crm/db";

export type TenantOrganization = { id: string; name: string; slug: string };

export type TenantGateResult =
	| { status: "not-found" }
	| { status: "forbidden" }
	| {
			status: "ok";
			organization: TenantOrganization;
			organizations: TenantOrganization[];
			needsActiveOrgSwitch: boolean;
	  };

export async function resolveTenantForSlug(
	slug: string,
	userId: string,
	currentActiveOrganizationId?: string | null,
): Promise<TenantGateResult> {
	const [organization, memberships] = await Promise.all([
		db.organization.findUnique({
			where: { slug },
			select: { id: true },
		}),
		db.member.findMany({
			where: { userId },
			select: {
				organization: { select: { id: true, name: true, slug: true } },
			},
		}),
	]);

	if (!organization) {
		return { status: "not-found" };
	}

	const organizations = memberships.map(
		(membership) => membership.organization,
	);
	const currentOrganization = organizations.find(
		(candidate) => candidate.id === organization.id,
	);

	if (!currentOrganization) {
		return { status: "forbidden" };
	}

	return {
		status: "ok",
		organization: currentOrganization,
		organizations,
		needsActiveOrgSwitch:
			currentActiveOrganizationId !== currentOrganization.id,
	};
}
