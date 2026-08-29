import { z } from "zod";

const searchParamValue = z.union([
	z.string(),
	z.array(z.string()),
	z.undefined(),
]);

const searchParams = z.record(z.string(), searchParamValue);

export const signInSearchParams = searchParams.and(
	z.object({
		method: z.string().optional(),
		sig: z.string().optional(),
	}),
);

export const consentSearchParams = searchParams.and(
	z.object({
		client_id: z.string(),
		scope: z.string().optional(),
		sig: z.string(),
	}),
);

export function serializeOAuthQuery(
	params: z.infer<typeof searchParams>,
): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (Array.isArray(value)) {
			for (const item of value) query.append(key, item);
		} else if (value !== undefined) {
			query.set(key, value);
		}
	}
	return query.toString();
}

export type OAuthSignInOptions = {
	errorCallbackURL: string;
	oauth_query?: string;
};

export function oauthSignInOptions(
	oauthQuery: string | null,
	origin: string,
): OAuthSignInOptions {
	const errorUrl = new URL("/sign-in", origin);
	if (oauthQuery) errorUrl.search = oauthQuery;
	const options: OAuthSignInOptions = { errorCallbackURL: errorUrl.toString() };
	if (oauthQuery) options.oauth_query = oauthQuery;
	return options;
}
