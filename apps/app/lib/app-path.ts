import { workspaceUrl } from "@/lib/workspace-url";

const LANDING_PATH = "/";
const NO_ORGANIZATION_PATH = "/no-organization";
const SECTIONS = ["/companies", "/contacts", "/deals", "/settings"];

export function appPath(
	pathname: string,
	workspace: { slug: string | null; hasOrganization: boolean | null },
	onboardingPath = "/onboarding",
	researchPath = "/onboarding/research",
): string {
	if (workspace.hasOrganization !== true || !workspace.slug) {
		return NO_ORGANIZATION_PATH;
	}

	if (
		pathname === LANDING_PATH ||
		pathname === onboardingPath ||
		pathname === researchPath
	) {
		return workspaceUrl(workspace.slug);
	}

	if (SECTIONS.some((section) => isUnder(pathname, section))) {
		return workspaceUrl(workspace.slug, pathname);
	}

	const [, first, ...rest] = pathname.split("/");
	return first === workspace.slug
		? pathname
		: workspaceUrl(
				workspace.slug,
				rest.length ? `/${rest.join("/")}` : "/",
			);
}

export function isUnder(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
