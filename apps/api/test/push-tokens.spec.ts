import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { BadRequestException } from "@nestjs/common";
import { PushTokensService } from "../src/push-tokens/push-tokens.service";

const suffix = process.env.TEST_RUN_ID ?? "push-tokens-spec";
const userId = `user-push-${suffix}`;
const otherUserId = `user-push-other-${suffix}`;
const token = `fcm-${suffix}`;

let service: PushTokensService;

beforeAll(async () => {
	await db.pushToken.deleteMany({
		where: { OR: [{ userId }, { userId: otherUserId }, { token }] },
	});
	await db.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
	await db.user.create({
		data: { id: userId, name: "Push User", email: `${userId}@example.test` },
	});
	await db.user.create({
		data: {
			id: otherUserId,
			name: "Other Push User",
			email: `${otherUserId}@example.test`,
		},
	});
	service = new PushTokensService(db);
});

afterAll(async () => {
	await db.pushToken.deleteMany({
		where: { OR: [{ userId }, { userId: otherUserId }, { token }] },
	});
	await db.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
});

describe("PushTokensService", () => {
	it("upserts a token for the current user", async () => {
		await expect(
			service.register(userId, { token, platform: "ios" }),
		).resolves.toEqual({ ok: true });

		const row = await db.pushToken.findUnique({ where: { token } });
		expect(row?.userId).toBe(userId);
		expect(row?.platform).toBe("ios");
	});

	it("moves the token to the latest user", async () => {
		await service.register(otherUserId, { token, platform: "android" });

		const row = await db.pushToken.findUnique({ where: { token } });
		expect(row?.userId).toBe(otherUserId);
		expect(row?.platform).toBe("android");
	});

	it("deletes a token that belongs to the caller", async () => {
		await expect(service.unregister(otherUserId, token)).resolves.toEqual({
			ok: true,
		});
		expect(await db.pushToken.findUnique({ where: { token } })).toBeNull();
	});

	it("treats an unknown token as already gone", async () => {
		await expect(service.unregister(userId, "missing-token")).resolves.toEqual({
			ok: true,
		});
	});

	it("does not delete another user's token", async () => {
		await service.register(userId, { token, platform: "ios" });
		await expect(service.unregister(otherUserId, token)).resolves.toEqual({
			ok: true,
		});
		expect(await db.pushToken.findUnique({ where: { token } })).not.toBeNull();
	});

	it("rejects a missing token on register", async () => {
		await expect(
			service.register(userId, { platform: "ios" }),
		).rejects.toBeInstanceOf(BadRequestException);
	});
});
