import { OAUTH } from "./oauth-config";

export function requiredCrmScope(write: boolean): string {
	return write ? OAUTH.scopes.crm.write : OAUTH.scopes.crm.read;
}

export function bearerChallenge(error?: string, scope?: string): string {
	const errorPart = error ? `, error="${error}"` : "";
	const scopePart = scope ? `, scope="${scope}"` : "";
	return `Bearer realm="compcrm"${errorPart}${scopePart}`;
}

export function oauthScopeFailure(
	scopes: ReadonlySet<string>,
	requiredScope: string,
): { challenge: string; message: string } | null {
	if (scopes.has(requiredScope)) return null;
	return {
		challenge: bearerChallenge("insufficient_scope", requiredScope),
		message: `The token requires ${requiredScope}.`,
	};
}
