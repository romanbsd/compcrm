import {
	canonicalJson,
	digestJson,
	registeredTools,
	validateManifest,
} from "@agent-xmpp/core";
import {
	AGENT_API_NS,
	type AgentApiManifest,
	type RegisteredAgent,
} from "@agent-xmpp/protocol";

import { exportToolManifest } from "../export-tools/manifest";

export interface XmppManifestOptions {
	readonly jid: string;
	readonly organizationId: string;
	readonly version?: string;
}

export function createXmppManifest(
	options: XmppManifestOptions,
): RegisteredAgent {
	const tools = exportToolManifest().map((tool) => {
		const annotations: NonNullable<
			AgentApiManifest["tools"][number]["annotations"]
		> = {};
		const manifestTool: AgentApiManifest["tools"][number] = {
			name: tool.name,
			description: tool.description,
			inputSchema: { ...tool.inputSchema },
			annotations,
			[AGENT_API_NS]: {
				supportsProgress: true,
				supportsCancellation: true,
				supportsInput: false,
				approvalRequired: tool.annotations?.destructive === true,
			},
		};
		if (tool.annotations?.title) manifestTool.title = tool.annotations.title;
		if (tool.outputSchema) {
			manifestTool.outputSchema = { ...tool.outputSchema };
		}
		if (tool.annotations?.readOnly !== undefined) {
			annotations.readOnlyHint = tool.annotations.readOnly;
		}
		if (tool.annotations?.destructive !== undefined) {
			annotations.destructiveHint = tool.annotations.destructive;
		}
		if (tool.annotations?.idempotent !== undefined) {
			annotations.idempotentHint = tool.annotations.idempotent;
		}
		return manifestTool;
	});
	const manifest = validateManifest({
		manifestSpecVersion: "0",
		agent: {
			jid: options.jid,
			name: "compcrm",
			title: "CRM Agent",
			description: "Researches CRM records and performs bounded CRM work.",
			version: options.version ?? "1.0.0",
		},
		implementation: { name: "compcrm-eve", version: "1.0.0" },
		tools,
	} satisfies AgentApiManifest);
	return {
		manifest,
		manifestHash: digestJson(manifest),
		canonicalManifest: canonicalJson(manifest),
		tools: registeredTools(manifest),
		tenantId: options.organizationId,
		active: true,
		registeredAt: new Date().toISOString(),
	};
}
