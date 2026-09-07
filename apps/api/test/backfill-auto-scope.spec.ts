import { describe, expect, it } from "bun:test";
import { currentOrganizationId } from "@crm/db/tenant-context";
import type { ScopedDb } from "@crm/db/tenant-scope";
import type { Cache } from "cache-manager";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { BackfillService } from "../src/backfill/backfill.service";
import type { ImageMirrorService } from "../src/backfill/image-mirror.service";
import type { FaviconService } from "../src/companies/favicon.service";

const ORGANIZATIONS = ["organization-a", "organization-b"] as const;

describe("BackfillService automatic sweep", () => {
	it("debounces globally while one run sweeps every organization", async () => {
		const entries = new Map<string, unknown>();
		const cache = {
			get: async (key: string) => entries.get(key),
			set: async (key: string, value: unknown) => {
				entries.set(key, value);
			},
		} as unknown as Cache;
		const db = {
			organization: {
				findMany: async () => ORGANIZATIONS.map((id) => ({ id })),
			},
		} as unknown as ScopedDb;
		const visited: string[] = [];
		let finish: (() => void) | undefined;
		const finished = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const service = new BackfillService(
			db,
			{} as AgentTriggerService,
			{} as FaviconService,
			{
				sweep: async () => {
					visited.push(currentOrganizationId());
					if (visited.length === ORGANIZATIONS.length) finish?.();
					return { copied: 0 };
				},
			} as unknown as ImageMirrorService,
			cache,
		);
		const controlled = service as unknown as {
			sweepWorkspace: () => Promise<void>;
			runCompanies: () => Promise<{
				queued: number;
				remaining: number;
				iconsResolving: number;
			}>;
			runContacts: () => Promise<{ queued: number; remaining: number }>;
		};
		controlled.sweepWorkspace = async () => undefined;
		controlled.runCompanies = async () => ({
			queued: 0,
			remaining: 0,
			iconsResolving: 0,
		});
		controlled.runContacts = async () => ({ queued: 0, remaining: 0 });

		const first = await service.auto();
		const second = await service.auto();
		await finished;

		expect(first).toEqual({ started: true });
		expect(second).toEqual({ started: false });
		expect([...entries.keys()]).toEqual(["backfill:auto"]);
		expect(visited).toEqual([...ORGANIZATIONS]);
	});
});
