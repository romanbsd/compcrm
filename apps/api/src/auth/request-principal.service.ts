import {
	API_KEY_HEADER,
	activeOrganizationIdOf,
	apiUrl,
	auth,
	bearerChallenge,
	OAUTH,
	OAUTH_ORGANIZATION_CLAIM,
	parseScopes,
	SESSION_COOKIE_NAME,
	type Session,
	type SessionUser,
	verifyAccessTokenRequest,
} from "@crm/auth";
import type { Db } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import { parseApiKeyPrincipalMetadata } from "./api-key-principal";
import {
	type CredentialKind,
	type RequestPrincipal,
	RequestPrincipalError,
} from "./request-principal";

const oauthClaims = z.object({
	sub: z.string().trim().min(1),
	client_id: z.string().trim().min(1).optional(),
	azp: z.string().trim().min(1).optional(),
	scope: z.string().default(""),
	exp: z.number().int().positive(),
});
const organizationClaim = z.string().trim().min(1);

@Injectable()
export class RequestPrincipalService {
	private readonly logger = new Logger(RequestPrincipalService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async resolve(request: Request): Promise<RequestPrincipal | null> {
		const kinds = credentialKinds(request);
		if (kinds.length > 1) {
			throw new RequestPrincipalError(
				400,
				"multiple_credentials",
				"Send exactly one credential type.",
			);
		}

		const kind = kinds[0];
		if (!kind) return null;

		try {
			const principal =
				kind === "oauth"
					? await this.resolveOAuth(request)
					: kind === "apiKey"
						? await this.resolveApiKey(request)
						: await this.resolveSession(request);
			this.logger.debug({
				message: "Authentication accepted",
				method: kind,
				clientId: principal.clientId,
				userId: principal.user.id,
			});
			return principal;
		} catch (error) {
			const reason =
				error instanceof RequestPrincipalError
					? error.code
					: error instanceof Error
						? error.name
						: "invalid_credential";
			this.logger.warn({
				message: "Authentication rejected",
				method: kind,
				reason,
			});
			if (error instanceof RequestPrincipalError) throw error;
			throw unauthorized("invalid_token", "The credential is invalid.");
		}
	}

	private async resolveSession(request: Request): Promise<RequestPrincipal> {
		const session = await auth.api.getSession({
			headers: fromNodeHeaders(request.headers),
		});
		if (!session) {
			throw unauthorized("invalid_credential", "The credential is invalid.");
		}

		const enrichedSession = session as Session;

		return {
			credentialKind: "session",
			user: enrichedSession.user,
			clientId: null,
			scopes: new Set(),
			session: enrichedSession,
			organizationId: activeOrganizationIdOf(enrichedSession),
			expiresAt: enrichedSession.session.expiresAt,
		};
	}

	private async resolveApiKey(request: Request): Promise<RequestPrincipal> {
		const keyValue = headerValue(request.headers[API_KEY_HEADER]);
		if (!keyValue) {
			throw unauthorized("invalid_credential", "The credential is invalid.");
		}

		const verified = await auth.api.verifyApiKey({ body: { key: keyValue } });
		if (!verified.valid || !verified.key) {
			throw unauthorized("invalid_credential", "The credential is invalid.");
		}

		const metadata = parseApiKeyPrincipalMetadata(verified.key.metadata);
		const user = await this.findUser(metadata.createdByUserId);
		if (!user) {
			throw unauthorized("invalid_credential", "The credential is invalid.");
		}

		return {
			credentialKind: "apiKey",
			user: user satisfies SessionUser,
			clientId: null,
			scopes: new Set(),
			session: null,
			organizationId: verified.key.referenceId,
			expiresAt: verified.key.expiresAt,
		};
	}

	private async resolveOAuth(request: Request): Promise<RequestPrincipal> {
		const rawClaims = await verifyAccessTokenRequest(
			{
				authorizationHeader: headerValue(request.headers.authorization),
				method: request.method,
				url: new URL(request.originalUrl || request.url, apiUrl).toString(),
			},
			{
				verifyOptions: {
					issuer: OAUTH.issuer,
					audience: OAUTH.resource,
				},
			},
		);
		const claims = oauthClaims.parse(rawClaims);
		const organizationId = organizationClaim.parse(
			rawClaims[OAUTH_ORGANIZATION_CLAIM],
		);
		const clientId = claims.client_id ?? claims.azp;
		if (!clientId) {
			throw unauthorized(
				"invalid_token",
				"The token has no client identifier.",
			);
		}

		const [user, client] = await Promise.all([
			this.findUser(claims.sub),
			this.db.oauthClient.findUnique({
				where: { clientId },
				select: { disabled: true },
			}),
		]);
		if (!user || !client || client.disabled) {
			throw unauthorized("invalid_token", "The token principal is inactive.");
		}

		return {
			credentialKind: "oauth",
			user: user satisfies SessionUser,
			clientId,
			scopes: parseScopes(claims.scope),
			session: null,
			organizationId,
			expiresAt: new Date(claims.exp * 1000),
		};
	}

	private findUser(userId: string) {
		return this.db.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				name: true,
				email: true,
				emailVerified: true,
				image: true,
				createdAt: true,
				updatedAt: true,
			},
		});
	}
}

export function credentialKinds(request: Request): CredentialKind[] {
	const kinds: CredentialKind[] = [];
	if (hasSessionCookie(request.headers.cookie)) kinds.push("session");
	if (headerValue(request.headers[API_KEY_HEADER])) kinds.push("apiKey");
	if (isBearerAuthorization(request.headers.authorization)) kinds.push("oauth");
	return kinds;
}

function hasSessionCookie(cookieHeader: string | undefined): boolean {
	if (!cookieHeader) return false;
	const names = new Set([
		SESSION_COOKIE_NAME,
		`__Secure-${SESSION_COOKIE_NAME}`,
	]);
	return cookieHeader.split(";").some((entry) => {
		const separator = entry.indexOf("=");
		return separator > 0 && names.has(entry.slice(0, separator).trim());
	});
}

function headerValue(value: string | string[] | undefined): string | null {
	if (Array.isArray(value)) return value.find(Boolean) ?? null;
	return value?.trim() || null;
}

function isBearerAuthorization(value: string | string[] | undefined): boolean {
	const authorization = headerValue(value);
	return authorization ? /^Bearer\s+\S+/i.test(authorization) : false;
}

function unauthorized(code: string, message: string): RequestPrincipalError {
	return new RequestPrincipalError(401, code, message, bearerChallenge(code));
}
