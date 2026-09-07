import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { SlackConnectionService } from "../src/slack/slack-connection.service";
import { createTenantRows } from "@crm/db/test-support";

const fallback = (key: string, value: string) => {
	if (!process.env[key]) process.env[key] = value;
};

fallback(
	"DATABASE_URL",
	"postgresql://postgres:postgres@localhost:5432/crm?schema=public",
);
fallback("BETTER_AUTH_SECRET", "test-secret-at-least-32-characters-long");
fallback("API_URL", "http://localhost:3001");
fallback("ALLOWED_SIGN_IN", "example.com");
fallback("GOOGLE_CLIENT_ID", "test-google-client-id");
fallback("GOOGLE_CLIENT_SECRET", "test-google-client-secret");

const suffix = process.env.TEST_RUN_ID ?? crypto.randomUUID();
const organizationA = `mt-slack-a-${suffix}`;
const organizationB = `mt-slack-b-${suffix}`;
const userA = `mt-slack-user-a-${suffix}`;
const userB = `mt-slack-user-b-${suffix}`;
const teamA = `mt-slack-team-a-${suffix}`;
const teamB = `mt-slack-team-b-${suffix}`;

let moduleFixture: TestingModule | undefined;
let slack: SlackConnectionService;

function grant(organizationId: string, teamId: string) {
	return runInTenant(organizationId, () =>
		scopedDb.slackWorkspaceGrant.findUnique({
			where: { organizationId_teamId: { organizationId, teamId } },
		}),
	);
}

beforeAll(async () => {
	const { AppModule } = await import("../src/app.module");

	moduleFixture = await Test.createTestingModule({
		imports: [AppModule],
	}).compile();
	slack = moduleFixture.get(SlackConnectionService);

	await db.organization.createMany({
		data: [
			{
				id: organizationA,
				name: "Slack Organization A",
				slug: organizationA,
				createdAt: new Date(),
			},
			{
				id: organizationB,
				name: "Slack Organization B",
				slug: organizationB,
				createdAt: new Date(),
			},
		],
	});
	await db.user.createMany({
		data: [
			{
				id: userA,
				name: "Slack Owner A",
				email: `${userA}@example.com`,
			},
			{
				id: userB,
				name: "Slack Owner B",
				email: `${userB}@example.com`,
			},
		],
	});
	await db.member.createMany({
		data: [
			{
				id: `mt-slack-member-a-${suffix}`,
				organizationId: organizationA,
				userId: userA,
				role: "owner",
				createdAt: new Date(),
			},
			{
				id: `mt-slack-member-b-${suffix}`,
				organizationId: organizationB,
				userId: userB,
				role: "owner",
				createdAt: new Date(),
			},
		],
	});
	await createTenantRows(
		[
			{
				organizationId: organizationA,
				teamId: teamA,
				teamName: "Slack Team A",
				botToken: "xoxb-tenant-a",
				botScopes: "chat:write,channels:read",
				userToken: "xoxp-tenant-a",
				userScopes: "channels:read",
			},
			{
				organizationId: organizationB,
				teamId: teamB,
				teamName: "Slack Team B",
				botToken: "xoxb-tenant-b",
				botScopes: "chat:write",
				userToken: "xoxp-tenant-b",
				userScopes: "channels:read",
			},
		],
		(data) => scopedDb.slackWorkspaceGrant.create({ data: data as never }),
	);
	await createTenantRows(
		[
			{
				organizationId: organizationA,
				crmUserId: userA,
				slackUserId: "UA",
			},
			{
				organizationId: organizationB,
				crmUserId: userB,
				slackUserId: "UB",
			},
		],
		(data) => scopedDb.slackMemberMatch.create({ data: data as never }),
	);
});

afterAll(async () => {
	await moduleFixture?.close();
	await db.organization.deleteMany({
		where: { id: { in: [organizationA, organizationB] } },
	});
	await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
});

describe("cross-tenant Slack connections through Nest services", () => {
	it("returns each organization's own connection and scopes", async () => {
		const [statusA, statusB] = await Promise.all([
			runInTenant(organizationA, () => slack.status(userA)),
			runInTenant(organizationB, () => slack.status(userB)),
		]);

		expect(statusA).toMatchObject({
			connected: true,
			workspace: "Slack Team A",
			scopes: ["chat:write", "channels:read"],
		});
		expect(statusB).toMatchObject({
			connected: true,
			workspace: "Slack Team B",
			scopes: ["chat:write"],
		});
	});

	it("disconnects only the active organization's connection", async () => {
		await expect(
			runInTenant(organizationA, () => slack.disconnect(userA)),
		).resolves.toEqual({ disconnected: true });

		expect(await grant(organizationA, teamA)).toBeNull();
		expect(await grant(organizationB, teamB)).not.toBeNull();

		const statusB = await runInTenant(organizationB, () => slack.status(userB));
		expect(statusB).toMatchObject({
			connected: true,
			workspace: "Slack Team B",
		});
	});
});
