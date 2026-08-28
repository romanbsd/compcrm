import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ActivityType, db } from "@crm/db";
import { ActivitiesService } from "../src/activities/activities.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";

const suffix = process.env.TEST_RUN_ID ?? "activities-spec";
const userId = `activities-user-${suffix}`;
const email = `activities-contact.${suffix}@example.test`;

const activities = new ActivitiesService(db, new ActivityStampService(db));
let contactId: string;

beforeAll(async () => {
	await db.activity.deleteMany({ where: { createdById: userId } });
	await db.contact.deleteMany({ where: { email } });
	await db.user.deleteMany({ where: { id: userId } });
	await db.user.create({
		data: { id: userId, name: "Activity Tester", email },
	});
	const contact = await db.contact.create({
		data: {
			firstName: "Stored",
			lastName: "Contact",
			email,
		},
		select: { id: true },
	});
	contactId = contact.id;
});

afterAll(async () => {
	await db.activity.deleteMany({ where: { createdById: userId } });
	await db.contact.deleteMany({ where: { email } });
	await db.user.deleteMany({ where: { id: userId } });
});

describe("ActivitiesService timeline", () => {
	it("returns the contact name", async () => {
		await db.activity.create({
			data: {
				type: ActivityType.NOTE,
				subject: "A note",
				contactId,
				createdById: userId,
				occurredAt: new Date(),
			},
		});

		const result = await activities.timeline({
			contactId,
			filter: "all",
			limit: 30,
		});

		expect(result.entries[0]?.contact).toEqual({
			id: contactId,
			firstName: "Stored",
			lastName: "Contact",
		});
	});
});
