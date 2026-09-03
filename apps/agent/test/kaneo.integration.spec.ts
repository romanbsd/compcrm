import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import { listProjects, listTasks, readTask } from "../agent/lib/kaneo";
import {
	addTaskComment,
	createTask,
	updateTask,
} from "../agent/lib/kaneo-writes";

const OWNER_ID = "kaneo-agent-test-owner";

describe("kaneo agent operations", () => {
	let projectId: string;

	beforeAll(async () => {
		await db.organization.upsert({
			where: { id: WORKSPACE_ID },
			create: {
				id: WORKSPACE_ID,
				name: "Agent test",
				slug: "agent-test",
				createdAt: new Date(),
			},
			update: {},
		});
		await db.workspace.upsert({
			where: { id: WORKSPACE_ID },
			create: {
				id: WORKSPACE_ID,
				name: "Agent test",
				slug: "agent-test",
				createdAt: new Date(),
			},
			update: {},
		});
		await db.user.upsert({
			where: { id: OWNER_ID },
			create: {
				id: OWNER_ID,
				name: "Agent Test Owner",
				email: `agent-owner-${Date.now()}@test.local`,
			},
			update: {},
		});
		await db.member.upsert({
			where: {
				organizationId_userId: {
					organizationId: WORKSPACE_ID,
					userId: OWNER_ID,
				},
			},
			create: {
				id: crypto.randomUUID(),
				organizationId: WORKSPACE_ID,
				userId: OWNER_ID,
				role: "owner",
				createdAt: new Date(),
			},
			update: { role: "owner" },
		});
		const project = await db.project.create({
			data: {
				workspaceId: WORKSPACE_ID,
				name: "Agent integration",
				slug: `agent-integration-${Date.now()}`,
			},
		});
		projectId = project.id;
		await db.projectColumn.createMany({
			data: [
				{ projectId, name: "To do", slug: "to-do", position: 0 },
				{ projectId, name: "In progress", slug: "in-progress", position: 1 },
				{ projectId, name: "Done", slug: "done", position: 2 },
			],
		});
	});

	afterAll(async () => {
		await db.project
			.delete({ where: { id: projectId } })
			.catch(() => undefined);
		await db.member
			.delete({
				where: {
					organizationId_userId: {
						organizationId: WORKSPACE_ID,
						userId: OWNER_ID,
					},
				},
			})
			.catch(() => undefined);
		await db.user.delete({ where: { id: OWNER_ID } }).catch(() => undefined);
	});

	it("creates tasks with sequential numbers", async () => {
		const first = await createTask({ projectId, title: "First" });
		const second = await createTask({
			projectId,
			title: "Second",
			status: "in-progress",
		});
		expect(first.number).toBe(1);
		expect(second.number).toBe(2);
	});

	it("lists tasks and projects", async () => {
		const projects = await listProjects();
		const found = projects.find((project) => project.id === projectId);
		expect(found?.taskCount).toBe(2);

		const all = await listTasks({ projectId });
		expect(all).toHaveLength(2);

		const open = await listTasks({ projectId, status: "to-do" });
		expect(open).toHaveLength(1);
	});

	it("updates a task", async () => {
		const [task] = await listTasks({ projectId });
		const updated = await updateTask(task.id, {
			status: "done",
			priority: "high",
		});
		expect(updated.status).toBe("done");
		expect(updated.priority).toBe("high");
	});

	it("reads a task with its comments", async () => {
		const [task] = await listTasks({ projectId });
		await addTaskComment(task.id, "The agent left this note.");
		const read = await readTask(task.id);
		expect(read?.comments).toHaveLength(1);
		expect(read?.comments[0].content).toBe("The agent left this note.");
	});
});
