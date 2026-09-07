import { auth } from "@crm/auth";
import { headers } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, AppHeaderFallback } from "@/components/app-header";
import { AppIconRail, AppIconRailFallback } from "@/components/app-icon-rail";
import { QuickSwitcher } from "@/components/crm/quick-switcher";
import { RecordSheetHost } from "@/components/crm/record-sheet/record-sheet-host";
import { MobileNavProvider } from "@/components/mobile-nav";
import { requireMailboxAccess } from "@/lib/session";
import { resolveTenantForSlug } from "@/lib/tenant-gate";
import { HydrateClient } from "@/lib/trpc/hydrate";

export default function AppLayout({
	children,
	params,
}: LayoutProps<"/[slug]">) {
	return (
		<MobileNavProvider>
			<div className="isolate flex h-svh flex-col">
				<Suspense fallback={<AppHeaderFallback />}>
					<WorkspaceHeader params={params} />
				</Suspense>

				<div className="flex min-h-0 flex-1">
					<Suspense fallback={<AppIconRailFallback />}>
						<AppIconRail />
					</Suspense>
					{children}
				</div>

				<Suspense fallback={null}>
					<RecordSheetHost />
				</Suspense>

				<Suspense fallback={null}>
					<QuickSwitcher />
				</Suspense>
			</div>
		</MobileNavProvider>
	);
}

async function WorkspaceHeader({
	params,
}: Pick<LayoutProps<"/[slug]">, "params">) {
	await connection();
	const [session, { slug }] = await Promise.all([
		requireMailboxAccess(),
		params,
	]);
	const gate = await resolveTenantForSlug(
		slug,
		session.user.id,
		session.session.activeOrganizationId,
	);

	if (gate.status === "not-found") notFound();
	if (gate.status === "forbidden") forbidden();

	if (gate.needsActiveOrgSwitch) {
		await auth.api.setActiveOrganization({
			headers: await headers(),
			body: { organizationId: gate.organization.id },
		});
		redirect(`/${gate.organization.slug}`);
	}

	const { user } = session;

	return (
		<HydrateClient>
			<AppHeader
				user={{
					name: user.name,
					email: user.email,
					image: user.image ?? null,
				}}
				organizationSwitcher={{
					current: gate.organization,
					options: gate.organizations,
				}}
			/>
		</HydrateClient>
	);
}
