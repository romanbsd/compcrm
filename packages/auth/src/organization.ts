import { type Db, db } from "@crm/db";
import { currentOrganizationId } from "@crm/db/tenant-context";

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

export function activeOrganizationIdOf(
	session: {
		session: Record<string, unknown>;
	} | null,
): string | null {
	const value = session?.session.activeOrganizationId;
	return typeof value === "string" && value !== "" ? value : null;
}

export async function resolveActiveOrganization(
	userId: string,
): Promise<string | null> {
	const membership = await db.member.findFirst({
		where: { userId },
		orderBy: { createdAt: "asc" },
		select: { organizationId: true },
	});

	if (!membership) return null;
	await syncKaneoMembership(userId, membership.organizationId);
	return membership.organizationId;
}

async function syncKaneoMembership(
	userId: string,
	organizationId: string,
): Promise<void> {
	try {
		await db.$transaction(async (tx) => {
			const workspace = await tx.organization.findUnique({
				where: { id: organizationId },
				select: { name: true, slug: true, createdAt: true },
			});
			if (!workspace) {
				return;
			}

			await tx.workspace.upsert({
				where: { id: organizationId },
				create: {
					id: organizationId,
					name: workspace.name,
					slug: workspace.slug,
					createdAt: workspace.createdAt,
				},
				update: { name: workspace.name, slug: workspace.slug },
			});

			const membership = await tx.member.findUnique({
				where: {
					organizationId_userId: { organizationId, userId },
				},
				select: { role: true },
			});
			const role = toKaneoRole(toWorkspaceRole(membership?.role ?? "member"));

			const existing = await tx.workspaceMember.findFirst({
				where: { workspaceId: organizationId, userId },
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
					workspaceId: organizationId,
					userId,
					role,
					joinedAt: new Date(),
				},
			});
		});
	} catch (error) {
		console.error(
			`[auth] could not sync user ${userId} into the kaneo workspace ${organizationId}; the next sign-in will retry`,
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
	organizationId: string,
	client: WorkspaceMemberReader = db,
): Promise<WorkspaceRole | null> {
	const member = await client.member.findUnique({
		where: { organizationId_userId: { organizationId, userId } },
		select: { role: true },
	});

	return member ? toWorkspaceRole(member.role) : null;
}

export async function activeWorkspaceRoleOf(
	userId: string,
	client: WorkspaceMemberReader = db,
): Promise<WorkspaceRole | null> {
	return workspaceRoleOf(userId, currentOrganizationId(), client);
}
