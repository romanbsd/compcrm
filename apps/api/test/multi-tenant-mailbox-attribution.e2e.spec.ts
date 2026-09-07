import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, type MailboxSyncModel } from "@crm/db";
import { runInTenant } from "@crm/db/tenant-context";
import { scopedDb } from "@crm/db/tenant-scope";
import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import {
	type IncomingMessage,
	ThreadWriterService,
} from "../src/mailbox/thread-writer.service";

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
const organizationA = `mt-mailbox-a-${suffix}`;
const organizationB = `mt-mailbox-b-${suffix}`;
const userA = `mt-mailbox-user-a-${suffix}`;
const userB = `mt-mailbox-user-b-${suffix}`;
const mailboxA = `${userA}@internal.test`;
const mailboxB = `${userB}@internal.test`;
const externalEmail = `buyer@mt-mailbox-${suffix}.test`;
const externalDomain = `mt-mailbox-${suffix}.test`;

let moduleFixture: TestingModule | undefined;
let threads: ThreadWriterService;
let mailboxSyncA: MailboxSyncModel;
let mailboxSyncB: MailboxSyncModel;
let companyA: { id: string };
let companyB: { id: string };
let contactA: { id: string };
let contactB: { id: string };

function message(organization: "a" | "b", mailbox: string): IncomingMessage {
	return {
		rfcMessageId: `<mt-mailbox-${organization}-${suffix}@mail.test>`,
		rootId: `<mt-mailbox-root-${organization}-${suffix}@mail.test>`,
		subject: "Pricing",
		from: { email: mailbox, name: "Test Rep" },
		recipients: [{ email: externalEmail, name: "A Buyer", kind: "to" }],
		body: "The numbers you asked for.",
		sentAt: new Date("2026-09-05T10:00:00Z"),
		gmailMessageId: null,
		outlookMessageId: null,
		outlookWebLink: null,
	};
}

beforeAll(async () => {
	const { AppModule } = await import("../src/app.module");

	moduleFixture = await Test.createTestingModule({
		imports: [AppModule],
	}).compile();
	threads = moduleFixture.get(ThreadWriterService);

	await db.organization.createMany({
		data: [
			{
				id: organizationA,
				name: "Mailbox Organization A",
				slug: organizationA,
				createdAt: new Date(),
			},
			{
				id: organizationB,
				name: "Mailbox Organization B",
				slug: organizationB,
				createdAt: new Date(),
			},
		],
	});
	await db.user.createMany({
		data: [
			{ id: userA, name: "Mailbox User A", email: mailboxA },
			{ id: userB, name: "Mailbox User B", email: mailboxB },
		],
	});

	[mailboxSyncA, mailboxSyncB] = await Promise.all([
		runInTenant(organizationA, () =>
			scopedDb.mailboxSync.create({
				data: {
					organizationId: organizationA,
					userId: userA,
					source: "gmail",
				},
			}),
		),
		runInTenant(organizationB, () =>
			scopedDb.mailboxSync.create({
				data: {
					organizationId: organizationB,
					userId: userB,
					source: "gmail",
				},
			}),
		),
	]);

	[companyA, companyB] = await Promise.all([
		runInTenant(organizationA, () =>
			scopedDb.company.create({
				data: {
					organizationId: organizationA,
					name: "Buyer Company A",
					domain: externalDomain,
				},
				select: { id: true },
			}),
		),
		runInTenant(organizationB, () =>
			scopedDb.company.create({
				data: {
					organizationId: organizationB,
					name: "Buyer Company B",
					domain: externalDomain,
				},
				select: { id: true },
			}),
		),
	]);

	[contactA, contactB] = await Promise.all([
		runInTenant(organizationA, () =>
			scopedDb.contact.create({
				data: {
					organizationId: organizationA,
					firstName: "Buyer A",
					email: externalEmail,
					companyId: companyA.id,
				},
				select: { id: true },
			}),
		),
		runInTenant(organizationB, () =>
			scopedDb.contact.create({
				data: {
					organizationId: organizationB,
					firstName: "Buyer B",
					email: externalEmail,
					companyId: companyB.id,
				},
				select: { id: true },
			}),
		),
	]);
});

afterAll(async () => {
	await moduleFixture?.close();
	await db.organization.deleteMany({
		where: { id: { in: [organizationA, organizationB] } },
	});
	await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
});

describe("cross-tenant mailbox attribution through Nest services", () => {
	it("attributes identical external participants inside each organization", async () => {
		const messageA = message("a", mailboxA);
		const messageB = message("b", mailboxB);

		const storedA = await runInTenant(organizationA, async () =>
			threads.store(
				mailboxSyncA,
				{ mailbox: mailboxA, origin: "gmail" },
				messageA,
				await threads.context(),
			),
		);
		const storedB = await runInTenant(organizationB, async () =>
			threads.store(
				mailboxSyncB,
				{ mailbox: mailboxB, origin: "gmail" },
				messageB,
				await threads.context(),
			),
		);

		expect([storedA, storedB]).toEqual([true, true]);

		const [threadA, threadB] = await Promise.all([
			runInTenant(organizationA, () =>
				scopedDb.emailThread.findUnique({
					where: { rootMessageId: messageA.rootId },
					include: { activity: true, messages: true },
				}),
			),
			runInTenant(organizationB, () =>
				scopedDb.emailThread.findUnique({
					where: { rootMessageId: messageB.rootId },
					include: { activity: true, messages: true },
				}),
			),
		]);

		expect(threadA).toMatchObject({
			organizationId: organizationA,
			companyId: companyA.id,
			contactId: contactA.id,
			activity: { organizationId: organizationA, createdById: userA },
			messages: [{ organizationId: organizationA, syncedByUserId: userA }],
		});
		expect(threadB).toMatchObject({
			organizationId: organizationB,
			companyId: companyB.id,
			contactId: contactB.id,
			activity: { organizationId: organizationB, createdById: userB },
			messages: [{ organizationId: organizationB, syncedByUserId: userB }],
		});
	});
});
