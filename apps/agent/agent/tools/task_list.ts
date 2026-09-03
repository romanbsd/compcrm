import { defineTool } from "eve/tools";
import { z } from "zod";
import { listTasks } from "../lib/kaneo";

export default defineTool({
	description:
		"List project tasks by project, assignee or status. Returns each task with its id and number, so you never have to ask a rep for one. Free.",
	inputSchema: z.object({
		projectId: z.string().optional().describe("The project to list tasks for."),
		assigneeId: z
			.string()
			.optional()
			.describe("Only tasks assigned to this user id."),
		status: z
			.string()
			.optional()
			.describe(
				"Only tasks with this status, for example 'to-do' or 'in-progress'.",
			),
		limit: z.number().int().min(1).max(100).default(50),
	}),
	async execute(input) {
		return { tasks: await listTasks(input) };
	},
});
