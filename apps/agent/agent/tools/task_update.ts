import { defineTool } from "eve/tools";
import { z } from "zod";
import { updateTask } from "../lib/kaneo-writes";

export default defineTool({
	description:
		"Update a task: its title, description, status, priority, assignee or due date. Pass only the fields that change. Free.",
	inputSchema: z.object({
		taskId: z.string().describe("The id of the task to update."),
		title: z.string().min(1).max(500).optional(),
		description: z.string().optional(),
		status: z.string().optional(),
		priority: z.string().optional(),
		assigneeId: z
			.string()
			.nullable()
			.optional()
			.describe("Set to null to clear the assignee."),
		dueDate: z
			.string()
			.nullable()
			.optional()
			.describe("An ISO date, or null to clear it."),
	}),
	async execute({ taskId, ...input }) {
		const task = await updateTask(taskId, input);
		return { task };
	},
});
