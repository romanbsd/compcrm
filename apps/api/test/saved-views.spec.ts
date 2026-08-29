import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@crm/db";
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
	it("restores physical stage filters and metadata after the temporary mapping", async () => {
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
						stage: ["DEMO_BOOKED", "CLOSED_WON", "DECISION_MAKER_BOUGHT_IN"],
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

		const temporaryMigrationPath = join(
			import.meta.dir,
			"../../../packages/db/prisma/migrations/20260827210000_gc_os_poc/migration.sql",
		);
		const temporaryMigration = readFileSync(temporaryMigrationPath, "utf8");
		const activityStart = temporaryMigration.indexOf('UPDATE "activity"');
		const savedViewStart = temporaryMigration.indexOf('UPDATE "savedView"');
		const savedViewEnd = temporaryMigration.indexOf(
			'\n\nALTER TABLE "contact"',
			savedViewStart,
		);
		expect(activityStart).toBeGreaterThanOrEqual(0);
		expect(savedViewStart).toBeGreaterThan(activityStart);
		expect(savedViewEnd).toBeGreaterThan(savedViewStart);
		await db.$executeRawUnsafe(
			temporaryMigration.slice(activityStart, savedViewStart),
		);
		await db.$executeRawUnsafe(
			temporaryMigration.slice(savedViewStart, savedViewEnd),
		);

		const restoreMigrationPath = join(
			import.meta.dir,
			"../../../packages/db/prisma/migrations/20260829011000_restore_deal_stage/migration.sql",
		);
		const restoreMigration = readFileSync(restoreMigrationPath, "utf8");
		const restoreActivityStart = restoreMigration.indexOf('UPDATE "activity"');
		const restoreSavedViewStart =
			restoreMigration.indexOf('UPDATE "savedView"');
		const restoreSavedViewEnd = restoreMigration.indexOf(
			"\n\nCOMMIT;",
			restoreSavedViewStart,
		);
		expect(restoreActivityStart).toBeGreaterThanOrEqual(0);
		expect(restoreSavedViewStart).toBeGreaterThan(restoreActivityStart);
		expect(restoreSavedViewEnd).toBeGreaterThan(restoreSavedViewStart);
		await db.$executeRawUnsafe(
			restoreMigration.slice(restoreActivityStart, restoreSavedViewStart),
		);
		await db.$executeRawUnsafe(
			restoreMigration.slice(restoreSavedViewStart, restoreSavedViewEnd),
		);

		expect(
			await db.activity.findUnique({
				where: { id: migrated.id },
				select: { subject: true, meta: true },
			}),
		).toEqual({
			subject: "Stage changed",
			meta: { from: "DEMO_BOOKED", to: "CLOSED_WON" },
		});
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
			stage: ["DEMO_BOOKED", "CLOSED_WON", "QUALIFIED_TO_BUY"],
			owner: ["owner-1"],
		});
	});
});
