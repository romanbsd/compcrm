import { db } from "@crm/db";
import { auth } from "./auth";
import { OAUTH, oauthClientFields } from "./oauth-config";

const OFFICIAL_CLIENT_RESOURCE_ID = "compcrm-flutter-resource";

export async function ensureOfficialOAuthClient(): Promise<void> {
	await auth.$context;
	const now = new Date();
	const clientId = OAUTH.officialClient.id;
	const clientFields = oauthClientFields({
		clientId,
		name: OAUTH.officialClient.name,
		redirectUris: OAUTH.officialClient.redirectUris,
		postLogoutRedirectUris: OAUTH.officialClient.postLogoutRedirectUris,
		skipConsent: true,
	});

	await db.$transaction(async (transaction) => {
		await transaction.oauthClient.upsert({
			where: { clientId },
			create: {
				id: clientId,
				...clientFields,
				createdAt: now,
				updatedAt: now,
			},
			update: {
				...clientFields,
				updatedAt: now,
			},
		});

		await transaction.oauthClientResource.upsert({
			where: { id: OFFICIAL_CLIENT_RESOURCE_ID },
			create: {
				id: OFFICIAL_CLIENT_RESOURCE_ID,
				clientId,
				resourceId: OAUTH.resource,
				createdAt: now,
			},
			update: {
				clientId,
				resourceId: OAUTH.resource,
			},
		});
	});
}
