import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DEFAULT_WORKSPACE_NAME, WORKSPACE_ID } from "@crm/auth";
import { DealStage, db } from "@crm/db";
import { workspaceSlug } from "@crm/db/workspace";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { homeSnapshot } from "../src/home/home.contracts";

Object.assign(process.env, { NODE_ENV: "test" });
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required.");
process.env.DATABASE_URL = testDatabaseUrl;

const fallback = (key: string, value: string) => {
	if (!process.env[key]) process.env[key] = value;
};

fallback("BETTER_AUTH_SECRET", "test-secret-at-least-32-characters-long");
fallback("API_URL", "http://localhost:3001");
fallback("ALLOWED_SIGN_IN", "example.com");
fallback("GOOGLE_CLIENT_ID", "test-google-client-id");
fallback("GOOGLE_CLIENT_SECRET", "test-google-client-secret");

const suffix = crypto.randomUUID();
const userId = `home-user-${suffix}`;
const outsiderId = `home-outsider-${suffix}`;
const memberId = `home-member-${suffix}`;
const sessionToken = `home-session-${suffix}`;
const outsiderSession = `home-outsider-session-${suffix}`;

let app: INestApplication;
let companyId = "";
let dealId = "";
let agentId = "";
let versionId = "";
let cookie = "";
let outsiderCookie = "";

describe("GET /home", () => {
	beforeAll(async () => {
		await db.organization.upsert({
			where: { id: WORKSPACE_ID },
			update: {},
			create: {
				id: WORKSPACE_ID,
				name: DEFAULT_WORKSPACE_NAME,
				slug: workspaceSlug(DEFAULT_WORKSPACE_NAME),
				createdAt: new Date(),
			},
		});
		await db.user.createMany({
			data: [
				{
					id: userId,
					name: "Home Owner",
					email: `${userId}@example.com`,
					emailVerified: true,
					updatedAt: new Date(),
				},
				{
					id: outsiderId,
					name: "Home Outsider",
					email: `${outsiderId}@example.com`,
					emailVerified: true,
					updatedAt: new Date(),
				},
			],
		});
		await db.member.create({
			data: {
				id: memberId,
				organizationId: WORKSPACE_ID,
				userId,
				role: "owner",
				createdAt: new Date(),
			},
		});
		await db.session.createMany({
			data: [
				{
					id: sessionToken,
					token: sessionToken,
					userId,
					expiresAt: new Date(Date.now() + 60_000),
					updatedAt: new Date(),
				},
				{
					id: outsiderSession,
					token: outsiderSession,
					userId: outsiderId,
					expiresAt: new Date(Date.now() + 60_000),
					updatedAt: new Date(),
				},
			],
		});
		cookie = `${await signedCookie(sessionToken)}`;
		outsiderCookie = `${await signedCookie(outsiderSession)}`;

		const { createApp } = await import("../src/create-app");
		app = await createApp();
	});

	afterAll(async () => {
		await app.close();
		await cleanup();
	});

	it("rejects an unauthenticated request", async () => {
		await request(app.getHttpServer()).get("/home").expect(401);
	});

	it("forbids a signed-in user who is not a workspace member", async () => {
		await request(app.getHttpServer())
			.get("/home")
			.set("cookie", outsiderCookie)
			.expect(403);
	});

	it("returns a valid snapshot for a workspace member", async () => {
		const response = await request(app.getHttpServer())
			.get("/home")
			.set("cookie", cookie)
			.expect(200);

		const snapshot = homeSnapshot.parse(response.body);
		expect(snapshot.unreadNotificationCount).toBe(0);
		expect(snapshot.attention.length).toBeLessThanOrEqual(3);
		expect(snapshot.projects.length).toBeLessThanOrEqual(3);
		expect(snapshot.recentWork.length).toBeLessThanOrEqual(3);
	});

	it("maps a waiting proposal run into attention and a project preview", async () => {
		const company = await db.company.create({
			data: { name: `Carter Co ${suffix}` },
			select: { id: true },
		});
		companyId = company.id;
		const deal = await db.deal.create({
			data: {
				name: "Carter Primary Bath",
				companyId,
				ownerId: userId,
				stage: DealStage.QUALIFIED_TO_BUY,
				amount: 42800,
				currency: "USD",
				baseAmount: 42800,
				baseCurrency: "USD",
			},
			select: { id: true },
		});
		dealId = deal.id;
		const agent = await db.agentDefinition.create({
			data: { name: "Bob", status: "LIVE", createdById: userId },
			select: { id: true },
		});
		agentId = agent.id;
		const version = await db.agentVersion.create({
			data: {
				agentId,
				number: 1,
				status: "DEPLOYED",
				instructions: "Prepare proposals.",
				manifest: {},
				modelId: "test/model",
				sandboxPolicy: {},
				createdById: userId,
			},
			select: { id: true },
		});
		versionId = version.id;
		await db.agentDefinition.update({
			where: { id: agentId },
			data: { currentVersionId: versionId },
		});
		const runId = `home-run-${suffix}`;
		await db.agentRun.create({
			data: {
				id: runId,
				agentId,
				versionId,
				triggerType: "MANUAL",
				status: "WAITING_FOR_APPROVAL",
				idempotencyKey: `home-run-${suffix}`,
				correlationId: `home-run-${suffix}`,
				dealId,
			},
		});

		const response = await request(app.getHttpServer())
			.get("/home")
			.set("cookie", cookie)
			.expect(200);

		const snapshot = homeSnapshot.parse(response.body);
		expect(snapshot.unreadNotificationCount).toBe(0);
		expect(snapshot.attentionCount).toBeGreaterThanOrEqual(1);
		expect(snapshot.attention.find((row) => row.id === runId)).toMatchObject({
			id: runId,
			projectId: dealId,
			projectName: "Carter Primary Bath",
			actor: { id: agentId, name: "Bob", role: "projectManager" },
			title: "Proposal ready for approval",
			keyValue: "$42,800",
			action: "reviewProposal",
			priority: "customerApproval",
		});
		expect(snapshot.projects.find((row) => row.id === dealId)).toMatchObject({
			id: dealId,
			name: "Carter Primary Bath",
			customerName: `Carter Co ${suffix}`,
			lifecycle: "proposal",
			needsUserAttention: true,
			operationalState: "Waiting for your approval",
		});
	});

	it("publishes GET /home on the OpenAPI document", async () => {
		const response = await request(app.getHttpServer())
			.get("/openapi.json")
			.expect(200);

		expect(response.body.paths["/home"].get.operationId).toBe("home-snapshot");
		expect(response.body.components.schemas.HomeSnapshot).toBeTruthy();
		expect(response.body.components.schemas.AttentionItem).toBeTruthy();
		expect(response.body.components.schemas.ProjectSummary).toBeTruthy();
		expect(response.body.components.schemas.ActivitySummary).toBeTruthy();
		expect(response.body.components.schemas.HomeActor).toBeTruthy();
	});
});

async function signedCookie(token: string): Promise<string> {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error("BETTER_AUTH_SECRET is required.");
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(token),
	);
	return `crm.session_token=${encodeURIComponent(
		`${token}.${Buffer.from(signature).toString("base64")}`,
	)}`;
}

async function cleanup() {
	if (agentId) {
		await db.agentRun.deleteMany({ where: { agentId } });
		await db.agentDefinition.updateMany({
			where: { id: agentId },
			data: { currentVersionId: null },
		});
		await db.agentVersion.deleteMany({ where: { agentId } });
		await db.agentDefinition.deleteMany({ where: { id: agentId } });
	}
	if (dealId) await db.deal.deleteMany({ where: { id: dealId } });
	if (companyId) await db.company.deleteMany({ where: { id: companyId } });
	await db.session.deleteMany({
		where: { id: { in: [sessionToken, outsiderSession] } },
	});
	await db.member.deleteMany({ where: { id: memberId } });
	await db.user.deleteMany({ where: { id: { in: [userId, outsiderId] } } });
}
