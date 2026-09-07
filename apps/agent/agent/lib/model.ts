import { readAgentModel } from "@crm/db/settings";
import { scopedTransaction } from "@crm/db/tenant-scope";

export interface ModelSelection {
	model: string;
	modelContextWindowTokens: number;
}

export async function selectedModel(): Promise<ModelSelection | null> {
	try {
		const setting = await scopedTransaction((tx) => readAgentModel(tx));

		if (setting.isDefault) return null;

		return {
			model: setting.id,
			modelContextWindowTokens: setting.contextWindowTokens,
		};
	} catch (error) {
		console.error(
			`[agent] could not read the configured model, falling back: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return null;
	}
}
