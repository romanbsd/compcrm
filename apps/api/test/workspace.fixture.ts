import { db } from "@crm/db";
import { workspaceSlug } from "@crm/db/workspace";

export async function ensureTestWorkspace(
	id: string,
	name: string,
): Promise<void> {
	await db.organization.upsert({
		where: { id },
		update: {},
		create: { id, name, slug: workspaceSlug(name), createdAt: new Date() },
	});
}

export async function createTestMembers(
	organizationId: string,
	members: Array<{ id: string; userId: string }>,
): Promise<void> {
	await db.member.createMany({
		data: members.map((member) => ({
			...member,
			organizationId,
			role: "member" as const,
			createdAt: new Date(),
		})),
	});
}
