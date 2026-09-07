import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import {
	slackAccessToken,
	slackUserToken,
} from "../agent/lib/slack-connection";
import { createTenantRows } from "@crm/db/test-support";

const suffix = process.env.TEST_RUN_ID ?? crypto.randomUUID();
const organizationA = `agent-slack-a-${suffix}`;
const organizationB = `agent-slack-b-${suffix}`;

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: organizationA,
				name: "Agent Slack A",
				slug: organizationA,
				createdAt: new Date(),
			},
			{
				id: organizationB,
				name: "Agent Slack B",
				slug: organizationB,
				createdAt: new Date(),
			},
		],
	});
	await createTenantRows(
		[
			{
				organizationId: organizationA,
				teamId: `agent-slack-team-a-${suffix}`,
				botToken: "xoxb-agent-a",
				botScopes: "chat:write",
				userToken: "xoxp-agent-a",
				userScopes: "channels:read",
			},
			{
				organizationId: organizationB,
				teamId: `agent-slack-team-b-${suffix}`,
				botToken: "xoxb-agent-b",
				botScopes: "chat:write",
				userToken: "xoxp-agent-b",
				userScopes: "channels:read",
			},
		],
		(row) => scopedDb.slackWorkspaceGrant.create({ data: row }),
	);
});

afterAll(async () => {
	await db.organization.deleteMany({
		where: { id: { in: [organizationA, organizationB] } },
	});
});

describe("tenant-scoped Slack runtime credentials", () => {
	it("returns each organization's bot and user tokens", async () => {
		const [tokensA, tokensB] = await Promise.all([
			runInTenant(organizationA, () =>
				Promise.all([slackAccessToken(), slackUserToken()]),
			),
			runInTenant(organizationB, () =>
				Promise.all([slackAccessToken(), slackUserToken()]),
			),
		]);

		expect(tokensA).toEqual(["xoxb-agent-a", "xoxp-agent-a"]);
		expect(tokensB).toEqual(["xoxb-agent-b", "xoxp-agent-b"]);
	});
});
