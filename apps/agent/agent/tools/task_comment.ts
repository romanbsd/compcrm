import { defineTool } from "eve/tools";
import { z } from "zod";
import { addTaskComment } from "../lib/kaneo-writes";

export default defineTool({
	description:
		"Add a comment to a project task. A rep will see it in the task's comment thread. Free.",
	inputSchema: z.object({
		taskId: z.string().describe("The id of the task to comment on."),
		content: z.string().min(1).max(4000).describe("The comment text."),
	}),
	async execute({ taskId, content }) {
		const comment = await addTaskComment(taskId, content);
		return { comment };
	},
});
