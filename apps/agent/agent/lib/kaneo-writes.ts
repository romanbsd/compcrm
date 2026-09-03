import { db } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import createKaneoComment from "../../../../vendor/kaneo/apps/api/src/activity/controllers/create-comment";
import createKaneoTask from "../../../../vendor/kaneo/apps/api/src/task/controllers/create-task";
import updateKaneoTask from "../../../../vendor/kaneo/apps/api/src/task/controllers/update-task";

export type CreateTaskInput = {
	projectId: string;
	title: string;
	description?: string;
	status?: string;
	priority?: string;
	assigneeId?: string;
	dueDate?: string;
};

export type UpdateTaskInput = {
	title?: string;
	description?: string;
	status?: string;
	priority?: string;
	assigneeId?: string | null;
	dueDate?: string | null;
};

async function agentPrincipal(): Promise<string> {
	const owner = await db.member.findFirst({
		where: { organizationId: WORKSPACE_ID, role: "owner" },
		orderBy: { createdAt: "asc" },
		select: { userId: true },
	});
	if (!owner) {
		throw new Error("no workspace owner to act as the agent");
	}
	return owner.userId;
}

export async function createTask(input: CreateTaskInput) {
	const currentUserId = await agentPrincipal();
	const task = await createKaneoTask({
		projectId: input.projectId,
		currentUserId,
		userId: input.assigneeId,
		title: input.title,
		status: input.status ?? "to-do",
		priority: input.priority,
		description: input.description,
		dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
	});
	return { id: task.id, number: task.number, title: task.title };
}

export async function updateTask(taskId: string, input: UpdateTaskInput) {
	const currentUserId = await agentPrincipal();
	const current = await db.projectTask.findUnique({
		where: { id: taskId },
		select: {
			title: true,
			status: true,
			startDate: true,
			dueDate: true,
			projectId: true,
			description: true,
			priority: true,
			position: true,
			userId: true,
		},
	});
	if (!current) {
		throw new Error(`task ${taskId} does not exist`);
	}
	const task = await updateKaneoTask(
		taskId,
		input.title ?? current.title,
		input.status ?? current.status,
		current.startDate ?? undefined,
		input.dueDate !== undefined
			? input.dueDate
				? new Date(input.dueDate)
				: undefined
			: (current.dueDate ?? undefined),
		current.projectId,
		input.description !== undefined
			? input.description
			: (current.description ?? ""),
		input.priority ?? current.priority,
		current.position ?? 0,
		input.assigneeId !== undefined
			? (input.assigneeId ?? undefined)
			: (current.userId ?? undefined),
		currentUserId,
	);
	return {
		id: task.id,
		title: task.title,
		status: task.status,
		priority: task.priority,
		dueDate: task.dueDate,
	};
}

export async function addTaskComment(taskId: string, content: string) {
	const userId = await agentPrincipal();
	const activity = await createKaneoComment(taskId, userId, content);
	return { id: activity.id, createdAt: activity.createdAt };
}
