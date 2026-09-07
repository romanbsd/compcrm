import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, type Prisma } from "@crm/db";
import { runInTenant, TenantContextError } from "@crm/db/tenant-context";
import { scopedTransaction } from "@crm/db/tenant-scope";
import type { OauthAccess } from "@crm/validation";
import { SLACK_PROVIDER_ID } from "../src/scopes";
import { SLACK_CONNECTION } from "../src/slack-config";
import {
	rememberSlackInstall,
	replaceSlackConnection,
} from "../src/slack-grant";

const suffix =
	process.env.TEST_RUN_ID ??
	`slack-grant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ORGANIZATION_A = `slack-grant-${suffix}-organization-a`;
const ORGANIZATION_B = `slack-grant-${suffix}-organization-b`;
const INSTALLER_ID = `slack-grant-${suffix}-installer`;
const EXTERNAL_INSTALLER_ID = `${INSTALLER_ID}-other-org`;
const USER_ID = `slack-grant-${suffix}-user`;
const ACCOUNT_ID = `slack-grant-${suffix}-account`;
const STALE_TEAM_ID_B = `${suffix}-stale-org-b`;

const grant: OauthAccess = {
	ok: true,
	access_token: "xoxb-test-token",
	scope: "chat:write,channels:read",
	team: { id: `slack-grant-${suffix}-team`, name: "Test Team" },
	authed_user: {
		id: INSTALLER_ID,
		access_token: "xoxp-test-token",
		scope: "channels:read",
	},
};

async function inTenant<T>(
	organizationId: string,
	fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return runInTenant(organizationId, () => scopedTransaction(fn));
}

async function clearSlackRows(): Promise<void> {
	for (const organizationId of [ORGANIZATION_A, ORGANIZATION_B]) {
		await inTenant(organizationId, async (tx) => {
			await tx.slackWorkspaceGrant.deleteMany({
				where: {
					teamId: {
						in: [
							grant.team.id,
							`${grant.team.id}-stale-a`,
							`${grant.team.id}-stale-b`,
							STALE_TEAM_ID_B,
						],
					},
				},
			});
			await tx.slackInstallation.deleteMany({
				where: {
					installerId: {
						in: [
							INSTALLER_ID,
							EXTERNAL_INSTALLER_ID,
							`${INSTALLER_ID}-stale-a`,
						],
					},
				},
			});
		});
	}
}

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: ORGANIZATION_A,
				name: "Organization A",
				slug: ORGANIZATION_A,
				createdAt: new Date(),
			},
			{
				id: ORGANIZATION_B,
				name: "Organization B",
				slug: ORGANIZATION_B,
				createdAt: new Date(),
			},
		],
		skipDuplicates: true,
	});

	await db.user.upsert({
		where: { id: USER_ID },
		update: {},
		create: {
			id: USER_ID,
			name: "Slack grant owner",
			email: `${USER_ID}@example.test`,
		},
	});

	await db.account.deleteMany({ where: { id: ACCOUNT_ID } });
	await clearSlackRows();
});

afterAll(async () => {
	await db.account.deleteMany({ where: { id: ACCOUNT_ID } });
	await clearSlackRows();
	await db.user.deleteMany({ where: { id: USER_ID } });
	await db.organization.deleteMany({
		where: { id: { in: [ORGANIZATION_A, ORGANIZATION_B] } },
	});
});

describe("rememberSlackInstall", () => {
	it("requires tenant context", async () => {
		await expect(rememberSlackInstall(grant)).rejects.toThrow(
			TenantContextError,
		);
	});

	it("stores the active organization", async () => {
		await runInTenant(ORGANIZATION_A, () => rememberSlackInstall(grant));

		const installation = await inTenant(ORGANIZATION_A, (tx) =>
			tx.slackInstallation.findUnique({
				where: {
					organizationId_installerId: {
						organizationId: ORGANIZATION_A,
						installerId: INSTALLER_ID,
					},
				},
				select: { organizationId: true, botToken: true, botScopes: true },
			}),
		);

		expect(installation).toMatchObject({
			organizationId: ORGANIZATION_A,
			botToken: "xoxb-test-token",
			botScopes: "chat:write,channels:read",
		});
	});

	it("keeps each organization's installation separate", async () => {
		await runInTenant(ORGANIZATION_A, () => rememberSlackInstall(grant));
		await runInTenant(ORGANIZATION_B, () => rememberSlackInstall(grant));

		const [installationA, installationB] = await Promise.all([
			inTenant(ORGANIZATION_A, (tx) =>
				tx.slackInstallation.findUnique({
					where: {
						organizationId_installerId: {
							organizationId: ORGANIZATION_A,
							installerId: INSTALLER_ID,
						},
					},
				}),
			),
			inTenant(ORGANIZATION_B, (tx) =>
				tx.slackInstallation.findUnique({
					where: {
						organizationId_installerId: {
							organizationId: ORGANIZATION_B,
							installerId: INSTALLER_ID,
						},
					},
				}),
			),
		]);

		expect(installationA?.organizationId).toBe(ORGANIZATION_A);
		expect(installationB?.organizationId).toBe(ORGANIZATION_B);
	});

	it("does not clear stale installations outside the active tenant", async () => {
		await inTenant(ORGANIZATION_A, (tx) =>
			tx.slackInstallation.create({
				data: {
					installerId: `${INSTALLER_ID}-stale-a`,
					organizationId: ORGANIZATION_A,
					teamId: `${suffix}-stale-team-a`,
					teamName: "Old Team A",
					userToken: null,
					userScopes: "channels:read",
					createdAt: new Date(
						Date.now() - SLACK_CONNECTION.install.staleMs - 60_000,
					),
				},
			}),
		);

		await inTenant(ORGANIZATION_B, (tx) =>
			tx.slackInstallation.create({
				data: {
					installerId: EXTERNAL_INSTALLER_ID,
					organizationId: ORGANIZATION_B,
					teamId: STALE_TEAM_ID_B,
					teamName: "Old Team B",
					userToken: null,
					userScopes: "channels:read",
					createdAt: new Date(
						Date.now() - SLACK_CONNECTION.install.staleMs - 60_000,
					),
				},
			}),
		);

		await runInTenant(ORGANIZATION_A, () => rememberSlackInstall(grant));

		const staleA = await inTenant(ORGANIZATION_A, (tx) =>
			tx.slackInstallation.findUnique({
				where: {
					organizationId_installerId: {
						organizationId: ORGANIZATION_A,
						installerId: `${INSTALLER_ID}-stale-a`,
					},
				},
			}),
		);
		const staleB = await inTenant(ORGANIZATION_B, (tx) =>
			tx.slackInstallation.findUnique({
				where: {
					organizationId_installerId: {
						organizationId: ORGANIZATION_B,
						installerId: EXTERNAL_INSTALLER_ID,
					},
				},
			}),
		);

		expect(staleA).toBeNull();
		expect(staleB?.organizationId).toBe(ORGANIZATION_B);
	});

	it("replaces only the active organization's workspace grant", async () => {
		await runInTenant(ORGANIZATION_A, () => rememberSlackInstall(grant));

		await db.account.create({
			data: {
				id: ACCOUNT_ID,
				accountId: INSTALLER_ID,
				issuer: "local:oauth:slack",
				providerId: SLACK_PROVIDER_ID,
				userId: USER_ID,
			},
		});

		await inTenant(ORGANIZATION_A, (tx) =>
			tx.slackWorkspaceGrant.create({
				data: {
					id: `slack-grant-${suffix}-stale-a`,
					organizationId: ORGANIZATION_A,
					teamId: `${grant.team.id}-stale-a`,
					userToken: "stale-token-a",
					userScopes: "channels:read",
				},
			}),
		);

		await inTenant(ORGANIZATION_B, (tx) =>
			tx.slackWorkspaceGrant.create({
				data: {
					id: `slack-grant-${suffix}-stale-b`,
					organizationId: ORGANIZATION_B,
					teamId: `${grant.team.id}-stale-b`,
					userToken: "stale-token-b",
					userScopes: "channels:read",
				},
			}),
		);

		await runInTenant(ORGANIZATION_A, () =>
			replaceSlackConnection({ accountId: INSTALLER_ID }),
		);

		const replaced = await inTenant(ORGANIZATION_A, (tx) =>
			tx.slackWorkspaceGrant.findUnique({
				where: {
					organizationId_teamId: {
						organizationId: ORGANIZATION_A,
						teamId: grant.team.id,
					},
				},
			}),
		);
		const staleA = await inTenant(ORGANIZATION_A, (tx) =>
			tx.slackWorkspaceGrant.findUnique({
				where: {
					organizationId_teamId: {
						organizationId: ORGANIZATION_A,
						teamId: `${grant.team.id}-stale-a`,
					},
				},
			}),
		);
		const staleB = await inTenant(ORGANIZATION_B, (tx) =>
			tx.slackWorkspaceGrant.findUnique({
				where: {
					organizationId_teamId: {
						organizationId: ORGANIZATION_B,
						teamId: `${grant.team.id}-stale-b`,
					},
				},
			}),
		);

		expect(replaced?.organizationId).toBe(ORGANIZATION_A);
		expect(replaced?.botToken).toBe("xoxb-test-token");
		expect(replaced?.botScopes).toBe("chat:write,channels:read");
		expect(replaced?.userToken).toBe("xoxp-test-token");
		expect(staleA).toBeNull();
		expect(staleB?.organizationId).toBe(ORGANIZATION_B);
		expect(
			await inTenant(ORGANIZATION_A, (tx) =>
				tx.slackInstallation.findUnique({
					where: {
						organizationId_installerId: {
							organizationId: ORGANIZATION_A,
							installerId: INSTALLER_ID,
						},
					},
				}),
			),
		).toBeNull();

		await runInTenant(ORGANIZATION_B, () => rememberSlackInstall(grant));
		await runInTenant(ORGANIZATION_B, () =>
			replaceSlackConnection({ accountId: INSTALLER_ID }),
		);

		const [grantA, grantB] = await Promise.all([
			inTenant(ORGANIZATION_A, (tx) =>
				tx.slackWorkspaceGrant.findUnique({
					where: {
						organizationId_teamId: {
							organizationId: ORGANIZATION_A,
							teamId: grant.team.id,
						},
					},
				}),
			),
			inTenant(ORGANIZATION_B, (tx) =>
				tx.slackWorkspaceGrant.findUnique({
					where: {
						organizationId_teamId: {
							organizationId: ORGANIZATION_B,
							teamId: grant.team.id,
						},
					},
				}),
			),
		]);

		expect(grantA?.organizationId).toBe(ORGANIZATION_A);
		expect(grantB?.organizationId).toBe(ORGANIZATION_B);
		expect(
			await db.account.findUnique({ where: { id: ACCOUNT_ID } }),
		).not.toBeNull();
	});
});
