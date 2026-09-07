import { db } from "../src/client";
import type { Prisma } from "../src/generated/prisma/client";
import { lockIdempotencyKey } from "../src/idempotency";
import { workspaceSlug } from "../src/workspace";

function readArg(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	if (index === -1) return undefined;
	const value = process.argv[index + 1];
	return value?.startsWith("--") ? undefined : value;
}

function usage(message?: string): never {
	console.error(
		[
			message ? `\n  ${message}` : "",
			"",
			'  Usage: bun run db:provision -- --name "Acme Inc" --owner-email owner@acme.com [--slug acme]',
			"",
			"  Creates an organization and makes the existing user its owner.",
			"  The user must sign in before you run this command.",
			"",
		].join("\n"),
	);
	process.exit(1);
}

function validateEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function uniqueSlug(
	transaction: Pick<Prisma.TransactionClient, "organization">,
	base: string,
): Promise<string> {
	let candidate = base;
	let attempt = 2;

	while (
		await transaction.organization.findUnique({
			where: { slug: candidate },
			select: { id: true },
		})
	) {
		candidate = `${base}-${attempt}`;
		attempt += 1;
	}

	return candidate;
}

type ProvisionResult = {
	organizationId: string;
	name: string;
	slug: string;
	ownerEmail: string;
};

async function provision(
	name: string,
	ownerEmail: string,
	baseSlug: string,
): Promise<ProvisionResult | null> {
	const owner = await db.user.findUnique({
		where: { email: ownerEmail },
		select: { id: true, email: true },
	});

	if (!owner) return null;

	return db.$transaction(async (transaction) => {
		await lockIdempotencyKey(transaction, `provision-organization:${baseSlug}`);

		const slug = await uniqueSlug(transaction, baseSlug);
		const organizationId = crypto.randomUUID();
		const organization = await transaction.organization.create({
			data: {
				id: organizationId,
				name,
				slug,
				createdAt: new Date(),
			},
			select: { id: true, name: true, slug: true },
		});

		await transaction.member.create({
			data: {
				id: crypto.randomUUID(),
				organizationId: organization.id,
				userId: owner.id,
				role: "owner",
				createdAt: new Date(),
			},
		});

		return {
			organizationId: organization.id,
			name: organization.name,
			slug: organization.slug,
			ownerEmail: owner.email,
		};
	});
}

async function main(): Promise<ProvisionResult | null> {
	const name = readArg("--name")?.trim();
	const ownerEmail = readArg("--owner-email")?.trim().toLowerCase();
	const slugOverride = readArg("--slug")?.trim();

	if (!name || !ownerEmail) usage("name and owner-email are required.");
	if (!validateEmail(ownerEmail)) usage(`Invalid owner email "${ownerEmail}".`);

	return provision(name, ownerEmail, workspaceSlug(slugOverride || name));
}

main()
	.then((result) => {
		if (!result) {
			console.error("No matching user exists. The owner must sign in first.");
			process.exitCode = 1;
			return;
		}

		console.log(
			`Created organization "${result.name}" (${result.organizationId}), slug "${result.slug}", owned by ${result.ownerEmail}.`,
		);
	})
	.catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
	});
