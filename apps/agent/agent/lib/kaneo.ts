import { db } from "@crm/db";

export type TaskListFilter = {
	projectId?: string;
	assigneeId?: string;
	status?: string;
	limit?: number;
};

type UserName = { id: string; name: string; email: string | null };

async function userNames(
	userIds: Array<string | null>,
): Promise<Map<string, UserName>> {
	const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
	if (ids.length === 0) {
		return new Map();
	}
	const users = await db.user.findMany({
		where: { id: { in: ids } },
		select: { id: true, name: true, email: true },
	});
	return new Map(users.map((user) => [user.id, user]));
}

export async function listProjects() {
	const projects = await db.project.findMany({
		where: { archivedAt: null },
		orderBy: { position: "asc" },
		select: {
			id: true,
			name: true,
			slug: true,
			description: true,
			position: true,
			_count: { select: { projectTasks: true } },
		},
	});
	return projects.map((project) => ({
		id: project.id,
		name: project.name,
		slug: project.slug,
		description: project.description,
		taskCount: project._count.projectTasks,
	}));
}

export async function listTasks(filter: TaskListFilter) {
	const tasks = await db.projectTask.findMany({
		where: {
			projectId: filter.projectId,
			userId: filter.assigneeId,
			status: filter.status,
		},
		orderBy: [{ position: "asc" }, { createdAt: "asc" }],
		take: filter.limit ?? 50,
		select: {
			id: true,
			number: true,
			title: true,
			status: true,
			priority: true,
			dueDate: true,
			projectId: true,
			userId: true,
			project: { select: { name: true } },
		},
	});
	const names = await userNames(tasks.map((task) => task.userId));
	return tasks.map((task) => ({
		id: task.id,
		number: task.number,
		title: task.title,
		status: task.status,
		priority: task.priority,
		dueDate: task.dueDate,
		projectId: task.projectId,
		projectName: task.project.name,
		assignee: task.userId
			? {
					id: task.userId,
					name: names.get(task.userId)?.name ?? null,
					email: names.get(task.userId)?.email ?? null,
				}
			: null,
	}));
}

export async function readTask(taskId: string) {
	const task = await db.projectTask.findUnique({
		where: { id: taskId },
		select: {
			id: true,
			number: true,
			title: true,
			description: true,
			status: true,
			priority: true,
			startDate: true,
			dueDate: true,
			projectId: true,
			userId: true,
			project: { select: { name: true } },
			column: { select: { name: true } },
			labels: { select: { name: true, color: true } },
			taskActivities: {
				where: { type: "comment" },
				orderBy: { createdAt: "asc" },
				select: { content: true, createdAt: true },
			},
		},
	});
	if (!task) {
		return null;
	}
	const names = await userNames([task.userId]);
	const assignee = task.userId
		? {
				id: task.userId,
				name: names.get(task.userId)?.name ?? null,
				email: names.get(task.userId)?.email ?? null,
			}
		: null;
	return {
		id: task.id,
		number: task.number,
		title: task.title,
		description: task.description,
		status: task.status,
		priority: task.priority,
		startDate: task.startDate,
		dueDate: task.dueDate,
		projectId: task.projectId,
		projectName: task.project.name,
		columnName: task.column?.name ?? null,
		assignee,
		labels: task.labels.map((label) => label.name),
		comments: task.taskActivities
			.filter((activity): activity is { content: string; createdAt: Date } =>
				Boolean(activity.content),
			)
			.map((activity) => ({
				content: activity.content,
				createdAt: activity.createdAt,
			})),
	};
}
