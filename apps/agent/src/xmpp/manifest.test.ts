import { describe, expect, it } from "bun:test";
import { AGENT_API_NS } from "@agent-xmpp/protocol";

import { createXmppManifest } from "./manifest";

describe("XMPP export manifest", () => {
	it("derives the public tool surface from export schemas", () => {
		const agent = createXmppManifest({
			jid: "assistant@agents.example.com",
			organizationId: "org_1",
		});
		expect(agent.tools.map((tool) => tool.name)).toEqual([
			"handle_crm_request",
			"ping",
		]);
		expect(agent.tools[0]?.xmpp?.approvalRequired).toBe(true);
		expect(agent.manifest.tools[0]?.[AGENT_API_NS]).toEqual(
			expect.objectContaining({
				supportsProgress: true,
				supportsCancellation: true,
			}),
		);
	});
});
