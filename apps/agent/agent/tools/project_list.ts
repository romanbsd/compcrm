import { defineTool } from "eve/tools";
import { z } from "zod";
import { listProjects } from "../lib/kaneo";

export default defineTool({
	description:
		"List the project-management projects, each with its task count and id. Use this before creating or finding tasks, so you never ask a rep for a project id. Free.",
	inputSchema: z.object({}),
	async execute() {
		return { projects: await listProjects() };
	},
});
