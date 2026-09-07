import { scopedDb } from "@crm/db/tenant-scope";

export async function slackAccessToken(): Promise<string | null> {
	const grant = await scopedDb.slackWorkspaceGrant.findFirst({
		where: { botToken: { not: null } },
		orderBy: { updatedAt: "desc" },
		select: { botToken: true },
	});

	return grant?.botToken ?? null;
}

export async function slackConnected(): Promise<boolean> {
	return (await slackAccessToken()) !== null;
}

export async function slackUserToken(): Promise<string | null> {
	const grant = await scopedDb.slackWorkspaceGrant.findFirst({
		orderBy: { updatedAt: "desc" },
		select: { userToken: true },
	});

	return grant?.userToken ?? null;
}

export async function slackCanInviteItself(): Promise<boolean> {
	return (await slackUserToken()) !== null;
}
