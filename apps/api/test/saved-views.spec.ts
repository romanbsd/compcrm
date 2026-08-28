import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SavedViewsService } from "../src/saved-views/saved-views.service";

const userId = `saved-view-migration-${crypto.randomUUID()}`;
const viewName = `Legacy project stages ${userId}`;
const service = new SavedViewsService(db);

beforeAll(async () => {
	await db.user.create({
		data: {
			id: userId,
			name: "Saved view migration test",
			email: `${userId}@example.test`,
		},
	});
});

afterAll(async () => {
	await db.savedView.deleteMany({ where: { ownerId: userId } });
	await db.activity.deleteMany({ where: { createdById: userId } });
	await db.user.delete({ where: { id: userId } });
});

describe("GC saved-view migration", () => {
	it("upgrades legacy project stage filters for current saved-view queries", async () => {
		await db.savedView.create({
			data: {
				entity: "DEAL",
				name: viewName,
				shared: false,
				ownerId: userId,
				filters: {
					q: "",
					sort: "",
					dir: "asc",
					archived: false,
					filters: {
						stage: ["DEMO_BOOKED", "CLOSED_WON", "IN_PROGRESS"],
						owner: ["owner-1"],
					},
				},
			},
		});
		const migrated = await db.activity.create({
			data: {
				type: "STAGE_CHANGE",
				subject: "Stage changed",
				createdById: userId,
				meta: { from: "DEMO_BOOKED", to: "CLOSED_WON" },
			},
		});
		const custom = await db.activity.create({
			data: {
				type: "STAGE_CHANGE",
				subject: "Custom status note",
				createdById: userId,
				meta: { from: "DEMO_BOOKED", to: "CLOSED_WON" },
			},
		});
		const otherType = await db.activity.create({
			data: {
				type: "NOTE",
				subject: "Stage changed",
				createdById: userId,
			},
		});

		const migrationPath = join(
			import.meta.dir,
			"../../../packages/db/prisma/migrations/20260827210000_gc_os_poc/migration.sql",
		);
		const migration = readFileSync(migrationPath, "utf8");
		const activityStart = migration.indexOf('UPDATE "activity"');
		const start = migration.indexOf('UPDATE "savedView"');
		const end = migration.indexOf('\n\nALTER TABLE "contact"', start);
		expect(activityStart).toBeGreaterThanOrEqual(0);
		expect(start).toBeGreaterThan(activityStart);
		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);
		await db.$executeRawUnsafe(migration.slice(activityStart, start));
		await db.$executeRawUnsafe(migration.slice(start, end));

		expect(
			await db.activity.findUnique({
				where: { id: migrated.id },
				select: { subject: true },
			}),
		).toEqual({ subject: "Status changed" });
		expect(
			await db.activity.findUnique({
				where: { id: custom.id },
				select: { subject: true },
			}),
		).toEqual({ subject: "Custom status note" });
		expect(
			await db.activity.findUnique({
				where: { id: otherType.id },
				select: { subject: true },
			}),
		).toEqual({ subject: "Stage changed" });

		const [view] = await service.list("DEAL", userId);
		expect(view?.filters.filters).toEqual({
			stage: ["LEAD", "COMPLETE", "IN_PROGRESS"],
			owner: ["owner-1"],
		});
	});
});
