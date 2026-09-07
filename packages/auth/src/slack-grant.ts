import { getCurrentAuthContext } from "@better-auth/core/context";
import type { Prisma } from "@crm/db";
import { lockIdempotencyKey } from "@crm/db/idempotency";
import {
	runInTenant,
	TenantContextError,
	tryCurrentOrganizationId,
} from "@crm/db/tenant-context";
import { scopedTransaction } from "@crm/db/tenant-scope";
import type { OauthAccess } from "@crm/validation";
import { getSessionFromCtx } from "better-auth/api";
import { activeOrganizationIdOf } from "./organization";
import { SLACK_CONNECTION } from "./slack-config";

export async function rememberSlackInstall(grant: OauthAccess): Promise<void> {
	const { team, authed_user: installer } = grant;
	if (!team || !installer) return;

	const organizationId = await currentSlackOrganizationId();

	const install = {
		teamId: team.id,
		teamName: team.name ?? null,
		botToken: grant.access_token ?? null,
		botScopes: grant.scope ?? "",
		userToken: installer.access_token ?? null,
		userScopes: installer.scope ?? "",
		createdAt: new Date(),
	};

	await runInTenant(organizationId, () =>
		scopedTransaction(async (tx) => {
			await tx.slackInstallation.upsert({
				where: {
					organizationId_installerId: {
						organizationId,
						installerId: installer.id,
					},
				},
				create: { installerId: installer.id, ...install },
				update: install,
			});

			await forgetStaleInstalls(tx);
		}),
	);
}

export async function replaceSlackConnection(account: {
	accountId: string;
}): Promise<void> {
	const organizationId = await currentSlackOrganizationId();

	await runInTenant(organizationId, () =>
		scopedTransaction(async (tx) => {
			await lockIdempotencyKey(
				tx,
				`${SLACK_CONNECTION.locks.connection}:${organizationId}`,
			);

			const install = await tx.slackInstallation.findUnique({
				where: {
					organizationId_installerId: {
						organizationId,
						installerId: account.accountId,
					},
				},
			});
			if (!install) return;

			await tx.slackInstallation.delete({
				where: {
					organizationId_installerId: {
						organizationId,
						installerId: account.accountId,
					},
				},
			});

			await tx.slackWorkspaceGrant.deleteMany({
				where: { teamId: { not: install.teamId } },
			});

			if (!install.userToken) return;

			const grant = {
				teamName: install.teamName,
				botToken: install.botToken,
				botScopes: install.botScopes,
				userToken: install.userToken,
				userScopes: install.userScopes,
			};

			await tx.slackWorkspaceGrant.upsert({
				where: {
					organizationId_teamId: {
						organizationId,
						teamId: install.teamId,
					},
				},
				create: { teamId: install.teamId, ...grant },
				update: grant,
			});
		}),
	);
}

async function forgetStaleInstalls(
	tx: Prisma.TransactionClient,
): Promise<void> {
	await tx.slackInstallation.deleteMany({
		where: {
			createdAt: {
				lt: new Date(Date.now() - SLACK_CONNECTION.install.staleMs),
			},
		},
	});
}

async function currentSlackOrganizationId(): Promise<string> {
	const organizationId = tryCurrentOrganizationId();
	if (organizationId) return organizationId;

	const context = await getCurrentAuthContext().catch(() => {
		throw new TenantContextError();
	});
	const session = await getSessionFromCtx(
		context as unknown as Parameters<typeof getSessionFromCtx>[0],
		{
			disableCookieCache: true,
		},
	);
	const activeOrganizationId = activeOrganizationIdOf(session);

	if (!activeOrganizationId) throw new TenantContextError();
	return activeOrganizationId;
}
