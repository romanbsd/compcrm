import { type Db, db } from "@crm/db";
import { WORKSPACE_ID, workspaceSlug } from "@crm/db/workspace";

export { WORKSPACE_ID };

export const DEFAULT_WORKSPACE_NAME = "CRM";

export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export function isWorkspaceRole(value: string): value is WorkspaceRole {
	return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isWorkspaceAdmin(role: WorkspaceRole | null): boolean {
	return role === "owner" || role === "admin";
}

export function canRenameWorkspace(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canChangeRole(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canManageCurrency(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canManageConnections(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canManageTracking(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export async function ensureWorkspaceMembership(
	userId: string,
): Promise<string | undefined> {
	try {
		return await db.$transaction(async (tx) => {
			const workspace = await tx.organization.upsert({
				where: { id: WORKSPACE_ID },
				create: {
					id: WORKSPACE_ID,
					name: DEFAULT_WORKSPACE_NAME,
					slug: workspaceSlug(DEFAULT_WORKSPACE_NAME),
					createdAt: new Date(),
				},
				update: {},
				select: { id: true, name: true, slug: true },
			});

			const slug = workspaceSlug(workspace.name);

			if (workspace.slug !== slug) {
				await tx.organization.update({
					where: { id: workspace.id },
					data: { slug },
				});
			}

			const enrolled = await tx.member.count({
				where: { organizationId: workspace.id },
			});

			if (enrolled === 0) {
				const existing = await tx.user.findMany({
					select: { id: true },
					orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				});

				await tx.member.createMany({
					data: existing.map((user, index) => ({
						id: crypto.randomUUID(),
						organizationId: workspace.id,
						userId: user.id,
						role: index === 0 ? "owner" : "member",
						createdAt: new Date(),
					})),
					skipDuplicates: true,
				});
			}

			await tx.member.upsert({
				where: {
					organizationId_userId: { organizationId: workspace.id, userId },
				},
				create: {
					id: crypto.randomUUID(),
					organizationId: workspace.id,
					userId,
					role: "member",
					createdAt: new Date(),
				},
				update: {},
			});

			return workspace.id;
		});
	} catch (error) {
		console.error(
			`[auth] could not enrol user ${userId} in workspace ${WORKSPACE_ID}; the next sign-in will retry`,
			error,
		);
		return undefined;
	} finally {
		await syncKaneoMembership(userId);
	}
}

async function syncKaneoMembership(userId: string): Promise<void> {
	try {
		await db.$transaction(async (tx) => {
			const workspace = await tx.organization.findUnique({
				where: { id: WORKSPACE_ID },
				select: { name: true, slug: true, createdAt: true },
			});
			if (!workspace) {
				return;
			}

			await tx.workspace.upsert({
				where: { id: WORKSPACE_ID },
				create: {
					id: WORKSPACE_ID,
					name: workspace.name,
					slug: workspace.slug,
					createdAt: workspace.createdAt,
				},
				update: { name: workspace.name, slug: workspace.slug },
			});

			const membership = await tx.member.findUnique({
				where: {
					organizationId_userId: { organizationId: WORKSPACE_ID, userId },
				},
				select: { role: true },
			});
			const role = toKaneoRole(toWorkspaceRole(membership?.role ?? "member"));

			const existing = await tx.workspaceMember.findFirst({
				where: { workspaceId: WORKSPACE_ID, userId },
				select: { id: true, role: true },
			});
			if (existing) {
				if (existing.role !== role) {
					await tx.workspaceMember.update({
						where: { id: existing.id },
						data: { role },
					});
				}
				return;
			}
			await tx.workspaceMember.create({
				data: {
					id: crypto.randomUUID(),
					workspaceId: WORKSPACE_ID,
					userId,
					role,
					joinedAt: new Date(),
				},
			});
		});
	} catch (error) {
		console.error(
			`[auth] could not sync user ${userId} into the kaneo workspace; the next sign-in will retry`,
			error,
		);
	}
}

function toKaneoRole(role: WorkspaceRole): string {
	if (role === "owner" || role === "admin") {
		return "admin";
	}
	return "member";
}

export function toWorkspaceRole(value: string): WorkspaceRole {
	return isWorkspaceRole(value) ? value : "member";
}

export type WorkspaceMemberReader = Pick<Db, "member">;

export async function workspaceRoleOf(
	userId: string,
	client: WorkspaceMemberReader = db,
): Promise<WorkspaceRole | null> {
	const member = await client.member.findUnique({
		where: { organizationId_userId: { organizationId: WORKSPACE_ID, userId } },
		select: { role: true },
	});

	return member ? toWorkspaceRole(member.role) : null;
}
