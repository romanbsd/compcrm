import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { auth } from "@crm/auth";
import { db } from "@crm/db";
import type { Request } from "express";
import { RequestPrincipalService } from "../src/auth/request-principal.service";

const suffix = process.env.TEST_RUN_ID ?? "request-principal-spec";
const userId = `${suffix}-user`;
const organizationId = `${suffix}-organization`;
let apiKey = "";

beforeAll(async () => {
	await db.user.create({
		data: {
			id: userId,
			name: "API key creator",
			email: `${suffix}@example.test`,
		},
	});
	await db.organization.create({
		data: {
			id: organizationId,
			name: "API key organization",
			slug: organizationId,
			createdAt: new Date(),
		},
	});
	await db.member.create({
		data: {
			id: `${suffix}-member`,
			userId,
			organizationId,
			role: "owner",
			createdAt: new Date(),
		},
	});

	const created = await auth.api.createApiKey({
		body: {
			userId,
			organizationId,
			name: "Integration key",
			metadata: { createdByUserId: userId },
		},
	});
	apiKey = created.key;
});

afterAll(async () => {
	await db.apikey.deleteMany({ where: { referenceId: organizationId } });
	await db.organization.delete({ where: { id: organizationId } });
	await db.user.delete({ where: { id: userId } });
});

describe("RequestPrincipalService", () => {
	it("resolves an organization-owned API key", async () => {
		const service = new RequestPrincipalService(db);
		const request = {
			headers: { "x-api-key": apiKey },
			method: "GET",
			url: "/api/trpc/companies.list",
			originalUrl: "/api/trpc/companies.list",
		} as unknown as Request;

		await expect(service.resolve(request)).resolves.toMatchObject({
			credentialKind: "apiKey",
			organizationId,
			user: { id: userId },
			session: null,
		});
	});
});
