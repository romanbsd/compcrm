import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "./client";
import { runInTenant, TenantContextError } from "./tenant-context";
import { type ScopedDb, scopedDb, scopedTransaction } from "./tenant-scope";

const testPrefix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ORG_A = `tenant-scope-org-a-${testPrefix}`;
const ORG_B = `tenant-scope-org-b-${testPrefix}`;
let userId: string;

const makeName = (label: string) =>
	`${testPrefix}-${label}-${Math.random().toString(16).slice(2)}`;

beforeAll(async () => {
	await db.organization.createMany({
		data: [
			{
				id: ORG_A,
				name: `Org A ${testPrefix}`,
				slug: `org-a-${testPrefix}`,
				createdAt: new Date(),
			},
			{
				id: ORG_B,
				name: `Org B ${testPrefix}`,
				slug: `org-b-${testPrefix}`,
				createdAt: new Date(),
			},
		],
		skipDuplicates: true,
	});
	const user = await db.user.create({
		data: {
			id: `tenant-scope-user-${testPrefix}`,
			name: "Tenant Scope User",
			email: `tenant-scope-${testPrefix}@example.com`,
		},
	});
	userId = user.id;
});

afterAll(async () => {
	for (const organizationId of [ORG_A, ORG_B]) {
		await runInTenant(organizationId, () =>
			scopedTransaction(async (tx) => {
				await tx.agentConversation.deleteMany();
				await tx.agentDefinition.deleteMany();
				await tx.agentTask.deleteMany();
				await tx.mailboxSync.deleteMany();
				await tx.suppressedContact.deleteMany();
				await tx.appSetting.deleteMany();
				await tx.contact.deleteMany();
				await tx.company.deleteMany();
			}),
		);
	}
	await db.user.delete({ where: { id: userId } });
	await db.organization.deleteMany({
		where: { id: { in: [ORG_A, ORG_B] } },
	});
});

describe("tenant scoping", () => {
	it("throws TenantContextError for read and create when no tenant context is active", async () => {
		await expect(Promise.resolve(scopedDb.company.findMany())).rejects.toThrow(
			TenantContextError,
		);
		await expect(
			Promise.resolve(
				scopedDb.company.create({
					data: {
						name: makeName("outside-create"),
						organizationId: ORG_A,
					},
				}),
			),
		).rejects.toThrow(TenantContextError);
	});

	it("defaults organizationId on create", async () => {
		const name = makeName("stamp");
		const created = await runInTenant(ORG_A, () =>
			scopedDb.company.create({ data: { name } }),
		);

		expect(created.organizationId).toBe(ORG_A);
	});

	it("rejects a supplied organizationId from another tenant", async () => {
		const name = makeName("overwrite");

		await expect(
			runInTenant(ORG_A, () =>
				scopedDb.company.create({
					data: { name, organizationId: ORG_B },
				}),
			),
		).rejects.toThrow();
	});

	it("keeps organizationId during update and upsert", async () => {
		const company = await runInTenant(ORG_A, () =>
			scopedDb.company.create({ data: { name: makeName("update-source") } }),
		);
		const updatedName = makeName("update-result");
		const upsertedName = makeName("upsert-result");

		const updated = await runInTenant(ORG_A, () =>
			scopedDb.company.update({
				where: { id: company.id },
				data: { name: updatedName },
			}),
		);
		const upserted = await runInTenant(ORG_A, () =>
			scopedDb.company.upsert({
				where: { id: company.id },
				create: {
					name: makeName("upsert-create"),
				},
				update: { name: upsertedName },
			}),
		);

		expect(updated.organizationId).toBe(ORG_A);
		expect(updated.name).toBe(updatedName);
		expect(upserted.organizationId).toBe(ORG_A);
		expect(upserted.name).toBe(upsertedName);
	});

	it("findMany returns only active tenant rows", async () => {
		const aName = makeName("findmany-a");
		const bName = makeName("findmany-b");

		await runInTenant(ORG_A, () =>
			scopedDb.company.create({ data: { name: aName } }),
		);
		await runInTenant(ORG_B, () =>
			scopedDb.company.create({ data: { name: bName } }),
		);

		const scopedRows = await runInTenant(ORG_A, () =>
			scopedDb.company.findMany({
				where: {
					name: {
						in: [aName, bName],
					},
				},
			}),
		);

		expect(scopedRows).toHaveLength(1);
		expect(scopedRows[0]?.name).toBe(aName);
		expect(scopedRows[0]?.organizationId).toBe(ORG_A);
	});

	it("findUnique cannot access another tenant row", async () => {
		const bName = makeName("findunique-b");
		const bCompany = await runInTenant(ORG_B, () =>
			scopedDb.company.create({ data: { name: bName } }),
		);

		const tenantRow = await runInTenant(ORG_A, () =>
			scopedDb.company.findUnique({
				where: { id: bCompany.id },
			}),
		);

		expect(tenantRow).toBeNull();
	});

	it("isolates count by tenant", async () => {
		const sharedName = makeName("count");

		const createdA = await runInTenant(ORG_A, () =>
			scopedDb.company.create({ data: { name: `${sharedName}-a` } }),
		);
		const createdB = await runInTenant(ORG_B, () =>
			scopedDb.company.create({ data: { name: `${sharedName}-b` } }),
		);

		const aCount = await runInTenant(ORG_A, () =>
			scopedDb.company.count({
				where: { name: { in: [createdA.name, createdB.name] } },
			}),
		);
		const bCount = await runInTenant(ORG_B, () =>
			scopedDb.company.count({
				where: { name: { in: [createdA.name, createdB.name] } },
			}),
		);

		expect(aCount).toBe(1);
		expect(bCount).toBe(1);
	});

	it("rejects update and delete for rows outside the active tenant and keeps source rows unchanged", async () => {
		const targetName = makeName("cross");
		const victim = await runInTenant(ORG_B, () =>
			scopedDb.company.create({ data: { name: targetName } }),
		);

		await expect(
			Promise.resolve(
				runInTenant(ORG_A, () =>
					scopedDb.company.update({
						where: { id: victim.id },
						data: { name: makeName("updated") },
					}),
				),
			),
		).rejects.toThrow();

		await expect(
			Promise.resolve(
				runInTenant(ORG_A, () =>
					scopedDb.company.delete({ where: { id: victim.id } }),
				),
			),
		).rejects.toThrow();

		const unchanged = await runInTenant(ORG_B, () =>
			scopedDb.company.findUnique({ where: { id: victim.id } }),
		);

		expect(unchanged?.organizationId).toBe(ORG_B);
		expect(unchanged?.name).toBe(targetName);
	});

	it("defaults every row in createMany", async () => {
		const base = makeName("createMany");
		const names = [`${base}-a`, `${base}-b`];

		await runInTenant(ORG_A, () =>
			scopedDb.company.createMany({
				data: names.map((name) => ({ name })),
			}),
		);

		const rows = await runInTenant(ORG_A, () =>
			scopedDb.company.findMany({ where: { name: { in: names } } }),
		);

		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.organizationId === ORG_A)).toBe(true);
	});

	it("reads organization without tenant context", async () => {
		const orgA = await scopedDb.organization.findUnique({
			where: { id: ORG_A },
		});
		const orgB = await scopedDb.organization.findUnique({
			where: { id: ORG_B },
		});

		expect(orgA?.id).toBe(ORG_A);
		expect(orgB?.id).toBe(ORG_B);
	});

	it("lets organizations reuse contact emails and company domains", async () => {
		const email = `shared-${testPrefix}@example.com`;
		const domain = `${testPrefix}.example.com`;
		const [contactA, contactB, companyA, companyB] = await Promise.all([
			runInTenant(ORG_A, () =>
				scopedDb.contact.create({ data: { firstName: "A", email } }),
			),
			runInTenant(ORG_B, () =>
				scopedDb.contact.create({ data: { firstName: "B", email } }),
			),
			runInTenant(ORG_A, () =>
				scopedDb.company.create({ data: { name: "Acme A", domain } }),
			),
			runInTenant(ORG_B, () =>
				scopedDb.company.create({ data: { name: "Acme B", domain } }),
			),
		]);

		expect(contactA.email).toBe(email);
		expect(contactB.email).toBe(email);
		expect(companyA.domain).toBe(domain);
		expect(companyB.domain).toBe(domain);
	});

	it("refuses a duplicate contact email inside one organization", async () => {
		const email = `duplicate-${testPrefix}@example.com`;

		await runInTenant(ORG_A, () =>
			scopedDb.contact.create({ data: { firstName: "First", email } }),
		);

		await expect(
			runInTenant(ORG_A, () =>
				scopedDb.contact.create({ data: { firstName: "Second", email } }),
			),
		).rejects.toThrow();
	});

	it("isolates representative tenant models", async () => {
		const created = await runInTenant(ORG_A, async () => ({
			conversation: await scopedDb.agentConversation.create({
				data: { userId },
			}),
			definition: await scopedDb.agentDefinition.create({
				data: { name: "Agent A", createdById: userId },
			}),
			task: await scopedDb.agentTask.create({
				data: { kind: "brand", reason: "test", dueAt: new Date() },
			}),
			mailbox: await scopedDb.mailboxSync.create({
				data: { userId, source: "gmail" },
			}),
		}));

		await runInTenant(ORG_B, async () => {
			await scopedDb.agentConversation.create({ data: { userId } });
			await scopedDb.agentDefinition.create({
				data: { name: "Agent B", createdById: userId },
			});
			await scopedDb.agentTask.create({
				data: { kind: "brand", reason: "test", dueAt: new Date() },
			});
			await scopedDb.mailboxSync.create({ data: { userId, source: "gmail" } });
		});

		const seen = await runInTenant(ORG_A, async () => ({
			conversations: await scopedDb.agentConversation.findMany(),
			definitions: await scopedDb.agentDefinition.findMany(),
			tasks: await scopedDb.agentTask.findMany(),
			mailboxes: await scopedDb.mailboxSync.findMany(),
		}));

		expect(seen.conversations.map(({ id }) => id)).toContain(
			created.conversation.id,
		);
		expect(seen.definitions.map(({ id }) => id)).toContain(
			created.definition.id,
		);
		expect(seen.tasks.map(({ id }) => id)).toContain(created.task.id);
		expect(seen.mailboxes.map(({ id }) => id)).toContain(created.mailbox.id);
		expect(seen.conversations).toHaveLength(1);
		expect(seen.definitions).toHaveLength(1);
		expect(seen.tasks).toHaveLength(1);
		expect(seen.mailboxes).toHaveLength(1);
	});

	it("isolates suppression and settings values", async () => {
		const email = `suppressed-${testPrefix}@example.com`;
		await Promise.all([
			runInTenant(ORG_A, () =>
				scopedDb.suppressedContact.create({ data: { email } }),
			),
			runInTenant(ORG_A, () =>
				scopedDb.appSetting.create({ data: { contextDevApiKey: "key-a" } }),
			),
			runInTenant(ORG_B, () =>
				scopedDb.appSetting.create({ data: { contextDevApiKey: "key-b" } }),
			),
		]);

		const [suppressedInA, suppressedInB, settingA, settingB] =
			await Promise.all([
				runInTenant(ORG_A, () =>
					scopedDb.suppressedContact.findUnique({
						where: { organizationId_email: { organizationId: ORG_A, email } },
					}),
				),
				runInTenant(ORG_B, () =>
					scopedDb.suppressedContact.findUnique({
						where: { organizationId_email: { organizationId: ORG_B, email } },
					}),
				),
				runInTenant(ORG_A, () =>
					scopedDb.appSetting.findUnique({ where: { organizationId: ORG_A } }),
				),
				runInTenant(ORG_B, () =>
					scopedDb.appSetting.findUnique({ where: { organizationId: ORG_B } }),
				),
			]);

		expect(suppressedInA).not.toBeNull();
		expect(suppressedInB).toBeNull();
		expect(settingA?.contextDevApiKey).toBe("key-a");
		expect(settingB?.contextDevApiKey).toBe("key-b");
	});
});

describe("scoped transactions", () => {
	it("throws TenantContextError without tenant context", async () => {
		await expect(scopedTransaction(async () => undefined)).rejects.toThrow(
			TenantContextError,
		);
	});

	it("sets the tenant before the callback starts", async () => {
		const setting = await runInTenant(ORG_A, () =>
			scopedTransaction(async (tx) => {
				const rows = await tx.$queryRaw<Array<{ organizationId: string }>>`
					SELECT current_setting('app.current_organization_id', true) AS "organizationId"
				`;

				return rows[0]?.organizationId;
			}),
		);

		expect(setting).toBe(ORG_A);
	});

	it("uses an injected client and transaction options", async () => {
		const result = await runInTenant(ORG_A, () =>
			scopedTransaction(
				scopedDb as ScopedDb,
				async (tx) => {
					const rows = await tx.$queryRaw<
						Array<{ organizationId: string }>
					>`SELECT current_setting('app.current_organization_id', true) AS "organizationId"`;
					const count = await tx.company.count();
					return { organizationId: rows[0]?.organizationId, count };
				},
				{ timeout: 5_000 },
			),
		);

		expect(result.organizationId).toBe(ORG_A);
		expect(result.count).toBeGreaterThanOrEqual(0);
	});

	it("applies tenant defaults to every write", async () => {
		const names = [
			makeName("transaction-first"),
			makeName("transaction-second"),
		];

		const rows = await runInTenant(ORG_A, () =>
			scopedTransaction(async (tx) =>
				Promise.all(names.map((name) => tx.company.create({ data: { name } }))),
			),
		);

		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.organizationId === ORG_A)).toBe(true);
	});

	it("rolls back writes after a callback failure", async () => {
		const name = makeName("transaction-rollback");

		await expect(
			runInTenant(ORG_A, () =>
				scopedTransaction(async (tx) => {
					await tx.company.create({ data: { name } });
					throw new Error("rollback requested");
				}),
			),
		).rejects.toThrow("rollback requested");

		const count = await runInTenant(ORG_A, () =>
			scopedDb.company.count({ where: { name } }),
		);

		expect(count).toBe(0);
	});

	it("reuses the active transaction for scopedDb calls", async () => {
		const name = makeName("active-transaction");

		await expect(
			runInTenant(ORG_A, () =>
				scopedTransaction(async () => {
					await scopedDb.company.create({ data: { name } });
					throw new Error("active transaction rollback");
				}),
			),
		).rejects.toThrow("active transaction rollback");

		const count = await runInTenant(ORG_A, () =>
			scopedDb.company.count({ where: { name } }),
		);

		expect(count).toBe(0);
	});

	it("clears the tenant setting after commit", async () => {
		await runInTenant(ORG_A, () => scopedTransaction(async () => undefined));

		const setting = await db.$transaction(async (tx) => {
			const rows = await tx.$queryRaw<Array<{ organizationId: string | null }>>`
				SELECT current_setting('app.current_organization_id', true) AS "organizationId"
			`;

			return rows[0]?.organizationId;
		});

		expect(setting).not.toBe(ORG_A);
	});
});
