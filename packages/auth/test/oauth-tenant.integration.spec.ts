import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";

const suffix = `oauth-tenant-${crypto.randomUUID()}`;
const userId = `${suffix}-user`;
const organizationId = `${suffix}-organization`;
const sessionToken = `${suffix}-session`;
let cookie = "";
let verifier = "";

const {
	auth,
	ensureOfficialOAuthClient,
	OAUTH,
	OAUTH_ORGANIZATION_CLAIM,
	SESSION_COOKIE_NAME,
} = await import("../src/index");

beforeAll(async () => {
	await ensureOfficialOAuthClient();
	await db.user.create({
		data: {
			id: userId,
			email: `${userId}@example.com`,
			name: "OAuth tenant user",
			emailVerified: true,
			updatedAt: new Date(),
		},
	});
	await db.organization.create({
		data: {
			id: organizationId,
			name: "OAuth tenant organization",
			slug: organizationId,
			createdAt: new Date(),
		},
	});
	await db.member.create({
		data: {
			id: `${suffix}-member`,
			userId,
			organizationId,
			role: "owner",
			createdAt: new Date(),
		},
	});
	await db.session.create({
		data: {
			id: sessionToken,
			token: sessionToken,
			userId,
			activeOrganizationId: organizationId,
			expiresAt: new Date(Date.now() + 60_000),
			updatedAt: new Date(),
		},
	});
	cookie = `${SESSION_COOKIE_NAME}=${await signCookieValue(sessionToken)}`;
	verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
});

afterAll(async () => {
	await db.user.delete({ where: { id: userId } });
	await db.organization.delete({ where: { id: organizationId } });
});

describe("OAuth tenant binding", () => {
	it("preserves the selected organization through token refresh", async () => {
		const challenge = Buffer.from(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
		).toString("base64url");
		const authorizeUrl = new URL(`${OAUTH.issuer}/oauth2/authorize`);
		authorizeUrl.search = new URLSearchParams({
			client_id: OAUTH.officialClient.id,
			redirect_uri: OAUTH.officialClient.redirectUris[0],
			response_type: "code",
			scope: "openid profile email offline_access crm.read",
			code_challenge: challenge,
			code_challenge_method: "S256",
			state: suffix,
			resource: OAUTH.resource,
		}).toString();

		const authorization = await auth.handler(
			new Request(authorizeUrl, { headers: { cookie }, redirect: "manual" }),
		);
		expect(authorization.status).toBe(302);
		const location = authorization.headers.get("location");
		if (!location) throw new Error("OAuth authorization returned no redirect.");
		const code = new URL(location).searchParams.get("code");
		if (!code) throw new Error("OAuth authorization returned no code.");

		const tokens = await tokenRequest({
			grant_type: "authorization_code",
			client_id: OAUTH.officialClient.id,
			redirect_uri: OAUTH.officialClient.redirectUris[0],
			resource: OAUTH.resource,
			code,
			code_verifier: verifier,
		});
		expect(
			accessTokenClaims(tokens.access_token)[OAUTH_ORGANIZATION_CLAIM],
		).toBe(organizationId);

		const refreshed = await tokenRequest({
			grant_type: "refresh_token",
			client_id: OAUTH.officialClient.id,
			refresh_token: tokens.refresh_token,
			resource: OAUTH.resource,
		});
		expect(
			accessTokenClaims(refreshed.access_token)[OAUTH_ORGANIZATION_CLAIM],
		).toBe(organizationId);
	});
});

async function tokenRequest(
	body: Record<string, string>,
): Promise<{ access_token: string; refresh_token: string }> {
	const response = await auth.handler(
		new Request(`${OAUTH.issuer}/oauth2/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(body),
		}),
	);
	const payload = (await response.json()) as Record<string, unknown>;
	if (!response.ok) throw new Error(JSON.stringify(payload));
	if (
		typeof payload.access_token !== "string" ||
		typeof payload.refresh_token !== "string"
	) {
		throw new Error("OAuth token response is incomplete.");
	}
	return {
		access_token: payload.access_token,
		refresh_token: payload.refresh_token,
	};
}

function accessTokenClaims(accessToken: string): Record<string, unknown> {
	const encoded = accessToken.split(".")[1];
	if (!encoded) throw new Error("Access token has no payload.");
	return JSON.parse(
		Buffer.from(encoded, "base64url").toString("utf8"),
	) as Record<string, unknown>;
}

async function signCookieValue(value: string): Promise<string> {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error("BETTER_AUTH_SECRET is required.");
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(value),
	);
	return encodeURIComponent(
		`${value}.${Buffer.from(signature).toString("base64")}`,
	);
}
