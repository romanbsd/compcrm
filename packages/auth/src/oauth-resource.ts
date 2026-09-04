import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { APIError } from "better-auth/api";
import type { ResourceRequestInput } from "better-auth/oauth2";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { auth } from "./auth";
import { OAUTH } from "./oauth-config";

const oauthResource = oauthProviderResourceClient(auth).getActions();
const jwksCacheKey = {};

type VerifyAccessTokenRequestOptions = {
	verifyOptions?: {
		issuer?: string | string[];
		audience?: string | string[];
	};
};

export const getProtectedResourceMetadata =
	oauthResource.getProtectedResourceMetadata;

export async function verifyAccessTokenRequest(
	request: Request | ResourceRequestInput,
	opts?: VerifyAccessTokenRequestOptions,
) {
	const authorization =
		request instanceof Request
			? request.headers.get("authorization")
			: request.authorizationHeader;
	const match = authorization?.match(/^Bearer\s+(.+)$/i);
	if (!match?.[1]) {
		throw new APIError("UNAUTHORIZED", {
			message: "A bearer access token is required.",
		});
	}

	return verifyJwsAccessToken(match[1], {
		jwksFetch: () => auth.api.getJwks(),
		jwksCacheKey,
		verifyOptions: {
			issuer: OAUTH.issuer,
			audience: OAUTH.resource,
			...opts?.verifyOptions,
		},
	});
}
