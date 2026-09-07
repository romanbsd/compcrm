import { describe, expect } from "bun:test";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb as db } from "@crm/db/tenant-scope";
import {
	persistSlackChannels,
	refreshSlackChannels,
} from "../agent/lib/slack-people";
import { tenantAfterEach, tenantBeforeEach, tenantTest } from "@crm/db/test-support";

const USER_ID = "slack-people-spec-user";
const ACCOUNT_ID = "slack-people-spec-account";
const PREFIX = "CSPEC";
const ORGANIZATION_ID = "workspace";
const it = tenantTest(ORGANIZATION_ID);
const beforeEach = tenantBeforeEach(ORGANIZATION_ID);
const afterEach = tenantAfterEach(ORGANIZATION_ID);
const OTHER_ORGANIZATION_ID = "slack-people-other-workspace";
const OTHER_USER_ID = "slack-people-other-user";
const OTHER_ACCOUNT_ID = "slack-people-other-account";

const realFetch = globalThis.fetch;

let restore: Array<{ id: string; available: boolean }> = [];

async function connect() {
	await db.user.upsert({
		where: { id: USER_ID },
		create: {
			id: USER_ID,
			name: "Slack Spec",
			email: `${USER_ID}@example.com`,
		},
		update: {},
	});
	await db.account.upsert({
		where: { id: ACCOUNT_ID },
		create: {
			id: ACCOUNT_ID,
			issuer: "local:oauth:slack",
			accountId: "T-SPEC",
			providerId: "slack",
			userId: USER_ID,
			accessToken: "xoxb-spec",
		},
		update: { accessToken: "xoxb-spec" },
	});
	await db.slackWorkspaceGrant.upsert({
		where: {
			organizationId_teamId: {
				organizationId: ORGANIZATION_ID,
				teamId: "T-SPEC",
			},
		},
		create: {
			organizationId: ORGANIZATION_ID,
			teamId: "T-SPEC",
			botToken: "xoxb-spec",
			botScopes: "channels:read",
			userToken: "xoxp-spec",
			userScopes: "channels:read",
		},
		update: {
			organizationId: ORGANIZATION_ID,
			botToken: "xoxb-spec",
			botScopes: "channels:read",
		},
	});
}

async function disconnect() {
	await db.account.deleteMany({ where: { providerId: "slack" } });
	await db.slackWorkspaceGrant.deleteMany({ where: { teamId: "T-SPEC" } });
	await db.slackChannel.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeEach(async () => {
	await db.organization.upsert({
		where: { id: ORGANIZATION_ID },
		create: {
			id: ORGANIZATION_ID,
			name: "Workspace",
			slug: "workspace",
			createdAt: new Date(),
		},
		update: {},
	});
	restore = await db.slackChannel.findMany({
		select: { id: true, available: true },
	});
	await db.slackChannel.deleteMany({ where: { id: { startsWith: PREFIX } } });
	await connect();
});

afterEach(async () => {
	globalThis.fetch = realFetch;
	await db.slackChannel.deleteMany({ where: { id: { startsWith: PREFIX } } });
	await db.account.deleteMany({ where: { id: ACCOUNT_ID } });
	await db.slackWorkspaceGrant.deleteMany({ where: { teamId: "T-SPEC" } });
	await db.slackWorkspaceGrant.deleteMany({ where: { teamId: "T-OTHER" } });
	await db.account.deleteMany({ where: { id: OTHER_ACCOUNT_ID } });
	await db.user.deleteMany({ where: { id: OTHER_USER_ID } });
	await db.organization.deleteMany({ where: { id: OTHER_ORGANIZATION_ID } });
	await db.user.deleteMany({ where: { id: USER_ID } });
	for (const row of restore) {
		await db.slackChannel.updateMany({
			where: { id: row.id },
			data: { available: row.available },
		});
	}
});

type SlackChannelReply = {
	id: string;
	name: string;
	is_member: boolean;
	unknown?: number;
};

type SlackListReply = {
	ok: boolean;
	error?: string;
	channels?: SlackChannelReply[];
	response_metadata?: { next_cursor: string };
};

function slackReply(body: SlackListReply): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("persistSlackChannels", () => {
	it("creates, updates and retires the inventory in one pass", async () => {
		await db.slackChannel.create({
			data: {
				id: `${PREFIX}-keep`,
				organizationId: ORGANIZATION_ID,
				name: "old-name",
				memberCount: 1,
				available: false,
			},
		});
		await db.slackChannel.create({
			data: {
				id: `${PREFIX}-gone`,
				organizationId: ORGANIZATION_ID,
				name: "gone",
				available: true,
			},
		});

		const written = await runInTenant(ORGANIZATION_ID, () =>
			persistSlackChannels(
				[
					{
						id: `${PREFIX}-keep`,
						name: "keep",
						num_members: 12,
						is_member: true,
					},
					{
						id: `${PREFIX}-new`,
						name: "new",
						num_members: 3,
						is_private: true,
						is_member: false,
					},
					{ id: `${PREFIX}-quiet`, name: "quiet", is_member: true },
					{ id: `${PREFIX}-archived`, name: "archived", is_archived: true },
				],
				true,
				ORGANIZATION_ID,
			),
		);

		expect(written).toBe(3);

		const rows = await db.slackChannel.findMany({
			where: { id: { startsWith: PREFIX } },
			orderBy: { id: "asc" },
			select: {
				id: true,
				name: true,
				memberCount: true,
				isPrivate: true,
				isMember: true,
				available: true,
			},
		});

		expect(rows).toEqual([
			{
				id: `${PREFIX}-gone`,
				name: "gone",
				memberCount: null,
				isPrivate: false,
				isMember: false,
				available: false,
			},
			{
				id: `${PREFIX}-keep`,
				name: "keep",
				memberCount: 12,
				isPrivate: false,
				isMember: true,
				available: true,
			},
			{
				id: `${PREFIX}-new`,
				name: "new",
				memberCount: 3,
				isPrivate: true,
				isMember: false,
				available: true,
			},
			{
				id: `${PREFIX}-quiet`,
				name: "quiet",
				memberCount: null,
				isPrivate: false,
				isMember: true,
				available: true,
			},
		]);
	});

	it("retires every channel when nothing is available", async () => {
		const emptyId = `${PREFIX}-empty-${crypto.randomUUID()}`;
		await db.slackChannel.create({
			data: {
				id: emptyId,
				organizationId: ORGANIZATION_ID,
				name: "only",
				available: true,
			},
		});

		expect(
			await runInTenant(ORGANIZATION_ID, () =>
				persistSlackChannels([], false, ORGANIZATION_ID),
			),
		).toBe(0);

		const row = await db.slackChannel.findUnique({
			where: { id: emptyId },
			select: { available: true },
		});
		expect(row?.available).toBe(false);
	});

	it("writes nothing when Slack is disconnected", async () => {
		await disconnect();

		const written = await runInTenant(ORGANIZATION_ID, () =>
			persistSlackChannels(
				[{ id: `${PREFIX}-ghost`, name: "ghost", is_member: true }],
				false,
				ORGANIZATION_ID,
			),
		);

		expect(written).toBe(0);
		expect(
			await db.slackChannel.count({ where: { id: `${PREFIX}-ghost` } }),
		).toBe(0);
	});

	it("ignores another organization's active Slack connection", async () => {
		await disconnect();
		await db.organization.create({
			data: {
				id: OTHER_ORGANIZATION_ID,
				name: "Other Workspace",
				slug: OTHER_ORGANIZATION_ID,
				createdAt: new Date(),
			},
		});
		await db.user.create({
			data: {
				id: OTHER_USER_ID,
				name: "Other Slack User",
				email: `${OTHER_USER_ID}@example.com`,
			},
		});
		await db.account.create({
			data: {
				id: OTHER_ACCOUNT_ID,
				issuer: "local:oauth:slack",
				accountId: "T-OTHER",
				providerId: "slack",
				userId: OTHER_USER_ID,
				accessToken: "xoxb-other",
			},
		});
		await runInTenant(OTHER_ORGANIZATION_ID, () =>
			db.slackWorkspaceGrant.create({
				data: {
					organizationId: OTHER_ORGANIZATION_ID,
					teamId: "T-OTHER",
					botToken: "xoxb-other",
					botScopes: "channels:read",
					userToken: "xoxp-other",
					userScopes: "channels:read",
				},
			}),
		);

		const written = await runInTenant(ORGANIZATION_ID, () =>
			persistSlackChannels(
				[{ id: `${PREFIX}-other`, name: "other", is_member: true }],
				false,
				ORGANIZATION_ID,
			),
		);

		expect(written).toBe(0);
		expect(
			await db.slackChannel.count({ where: { id: `${PREFIX}-other` } }),
		).toBe(0);
	});
});

describe("refreshSlackChannels", () => {
	it("aborts a stalled Slack list request", async () => {
		let signal: AbortSignal | null = null;
		globalThis.fetch = (async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			signal = init?.signal ?? null;
			return slackReply({ ok: true, channels: [] });
		}) as typeof fetch;

		await runInTenant(ORGANIZATION_ID, () =>
			refreshSlackChannels(ORGANIZATION_ID),
		);

		expect(signal).toBeInstanceOf(AbortSignal);
	});

	it("follows the cursor across pages", async () => {
		const seen: string[] = [];
		globalThis.fetch = (async (input: URL) => {
			const cursor = input.searchParams.get("cursor") ?? "";
			seen.push(cursor);
			if (cursor === "") {
				return slackReply({
					ok: true,
					channels: [
						{ id: `${PREFIX}-a`, name: "a", is_member: true, unknown: 1 },
					],
					response_metadata: { next_cursor: "page-2" },
				});
			}
			return slackReply({
				ok: true,
				channels: [{ id: `${PREFIX}-b`, name: "b", is_member: true }],
				response_metadata: { next_cursor: "" },
			});
		}) as unknown as typeof fetch;

		expect(
			await runInTenant(ORGANIZATION_ID, () =>
				refreshSlackChannels(ORGANIZATION_ID),
			),
		).toBe(2);
		expect([...new Set(seen)]).toEqual(["", "page-2"]);
	});

	it("does not resurrect the inventory a disconnect removed", async () => {
		globalThis.fetch = (async () => {
			await disconnect();
			return slackReply({
				ok: true,
				channels: [{ id: `${PREFIX}-late`, name: "late", is_member: true }],
			});
		}) as typeof fetch;

		expect(
			await runInTenant(ORGANIZATION_ID, () =>
				refreshSlackChannels(ORGANIZATION_ID),
			),
		).toBe(0);
		expect(
			await db.slackChannel.count({ where: { id: { startsWith: PREFIX } } }),
		).toBe(0);
	});

	it("explains a rejected list", async () => {
		globalThis.fetch = (async () =>
			slackReply({ ok: false, error: "missing_scope" })) as typeof fetch;

		expect(
			runInTenant(ORGANIZATION_ID, () => refreshSlackChannels(ORGANIZATION_ID)),
		).rejects.toThrow(
			"Slack channel lookup needs an additional permission. Reconnect Slack and retry.",
		);
	});
});
