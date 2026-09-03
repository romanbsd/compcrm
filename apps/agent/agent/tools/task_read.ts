import { defineTool } from "eve/tools";
import { z } from "zod";
import { readTask } from "../lib/kaneo";

export default defineTool({
	description:
		"Read one project task in full: description, status, priority, due date, assignee, labels and its comments. Free.",
	inputSchema: z.object({
		taskId: z.string().describe("The id of the task to read."),
	}),
	async execute({ taskId }) {
		const task = await readTask(taskId);
		return task
			? { task }
			: {
					task: null,
					note: "No task with that id exists. Say so rather than guessing.",
				};
	},
});
