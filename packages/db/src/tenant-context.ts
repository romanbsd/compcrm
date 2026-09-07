import { AsyncLocalStorage } from "node:async_hooks";

export class TenantContextError extends Error {
	constructor() {
		super(
			"No active tenant context. Every call into scopedDb must run inside runInTenant(organizationId, fn).",
		);
		this.name = "TenantContextError";
	}
}

interface TenantStore {
	organizationId: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

export function runInTenant<T>(
	organizationId: string,
	fn: () => PromiseLike<T>,
): Promise<T>;
export function runInTenant<T>(organizationId: string, fn: () => T): T;
export function runInTenant<T>(
	organizationId: string,
	fn: () => T | PromiseLike<T>,
): T | Promise<T> {
	return storage.run({ organizationId }, () => {
		const result = fn();
		return isPromiseLike(result) ? Promise.resolve(result) : result;
	});
}

export function tryCurrentOrganizationId(): string | undefined {
	return storage.getStore()?.organizationId;
}

export function currentOrganizationId(): string {
	const organizationId = tryCurrentOrganizationId();

	if (!organizationId) {
		throw new TenantContextError();
	}

	return organizationId;
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
	return typeof value === "object" && value !== null && "then" in value;
}
