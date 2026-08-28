import { defineTool } from "eve/tools";
import { z } from "zod";
import { readDealHistory } from "../lib/accounts";
import { focusOn } from "../lib/focus";

export default defineTool({
	description:
		"Read a project in full: status and how long it has been there, value, target date, the whole status history, who is on it with their contact ids, the correspondence and meetings with those people, and the notes. Free — call it first in a project session.",
	inputSchema: z.object({
		dealId: z.string(),
		threads: z
			.number()
			.int()
			.min(1)
			.max(20)
			.default(5)
			.describe("How many recent threads to read."),
	}),
	async execute({ dealId, threads }) {
		const history = await readDealHistory(dealId, { threads });
		if (!history) return { found: false as const, reason: "No such project." };

		if (history.company) focusOn({ companyId: history.company.id });
		else focusOn({ companyId: null });

		return { found: true as const, ...history };
	},
});
