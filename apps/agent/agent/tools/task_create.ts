import { defineTool } from "eve/tools";
import { z } from "zod";
import { createTask } from "../lib/kaneo-writes";

export default defineTool({
	description:
		"Create a task in a project. The project id comes from project_list. Returns the new task id and number. The task starts in the 'to-do' state with kaneo's default priority unless you say otherwise. Free.",
	inputSchema: z.object({
		projectId: z.string().describe("The project to create the task in."),
		title: z.string().min(1).max(500).describe("The task title."),
		description: z
			.string()
			.optional()
			.describe("A longer description of what the task is."),
		status: z.string().optional(),
		priority: z.string().optional(),
		assigneeId: z
			.string()
			.optional()
			.describe("The user id to assign the task to."),
		dueDate: z
			.string()
			.optional()
			.describe("An ISO date, for example 2026-09-30."),
	}),
	async execute(input) {
		const task = await createTask(input);
		return {
			task,
			note: "The task is created in the project. A rep will see it on the board.",
		};
	},
});
