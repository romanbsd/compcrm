import {
	afterAll as bunAfterAll,
	afterEach as bunAfterEach,
	beforeAll as bunBeforeAll,
	beforeEach as bunBeforeEach,
	it as bunIt,
} from "bun:test";
import { runInTenant } from "./tenant-context";

type TestBody = () => void | Promise<void>;

export function tenantTest(organizationId: string) {
	return (name: string, test: TestBody): void => {
		bunIt(name, () => runInTenant(organizationId, test));
	};
}

function tenantHook(register: (hook: TestBody) => void) {
	return (organizationId: string) =>
		(hook: TestBody): void => {
			register(() => runInTenant(organizationId, hook));
		};
}

export const tenantBeforeAll = tenantHook(bunBeforeAll);
export const tenantBeforeEach = tenantHook(bunBeforeEach);
export const tenantAfterEach = tenantHook(bunAfterEach);
export const tenantAfterAll = tenantHook(bunAfterAll);

export function tenantContext(organizationId: string) {
	return async <T>(work: () => T | PromiseLike<T>): Promise<T> =>
		await runInTenant(organizationId, work);
}

export async function createTenantRows<T extends { organizationId: string }>(
	rows: T[],
	create: (row: T) => PromiseLike<unknown>,
): Promise<void> {
	await Promise.all(
		rows.map((row) => runInTenant(row.organizationId, () => create(row))),
	);
}

export function tenantBound<T extends object>(
	organizationId: string,
	service: T,
): T {
	return new Proxy(service, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver);
			if (typeof value !== "function") return value;
			return (...args: unknown[]) =>
				runInTenant(organizationId, () => value.apply(target, args));
		},
	});
}
