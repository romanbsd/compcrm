import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
	buildTaskInvocation,
	type Element,
	parseTaskEvent,
	xml,
} from "@agent-xmpp/gateway";
import { AGENT_TASK_NS, type AgentTaskRecord } from "@agent-xmpp/protocol";
import { client } from "@xmpp/client";
import { z } from "zod";
import { createXmppManifest } from "../../src/xmpp/manifest";

const domain = process.env.XMPP_E2E_DOMAIN ?? "example.org";
const service = process.env.XMPP_E2E_SERVICE ?? "xmpp://127.0.0.1:15222";
const username = process.env.XMPP_E2E_USERNAME ?? "john";
const password = process.env.XMPP_E2E_PASSWORD ?? "secret";
const callerJid = `${username}@${domain}`;
const targetJid =
	process.env.XMPP_DEFAULT_AGENT_JID ?? `assistant@gateway.${domain}`;
const organizationId = process.env.XMPP_ORGANIZATION_ID;
const bridgeSecret = process.env.AGENT_BRIDGE_SECRET;

if (process.env.XMPP_E2E_ALLOW_SELF_SIGNED === "1") {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

assert.ok(organizationId, "XMPP_ORGANIZATION_ID is required");
assert.ok(bridgeSecret, "AGENT_BRIDGE_SECRET is required");

const manifestResponse = await fetch(
	`${process.env.AGENT_URL ?? "http://127.0.0.1:2000"}/internal/xmpp/export-tools/manifest`,
	{ headers: { authorization: `Bearer ${bridgeSecret}` } },
);
assert.equal(manifestResponse.status, 200);
const exported = z
	.object({ tools: z.array(z.object({ name: z.string() })) })
	.parse(await manifestResponse.json());
assert.deepEqual(
	exported.tools.map((tool) => tool.name),
	["handle_crm_request", "ping"],
);

const agent = createXmppManifest({
	jid: targetJid,
	organizationId,
	version: process.env.XMPP_AGENT_VERSION,
});
const xmpp = client({
	service,
	domain,
	username,
	password,
	resource: `compcrm-e2e-${randomUUID()}`,
});
const stanzas: Element[] = [];
const waiters = new Set<() => void>();
xmpp.on("stanza", (stanza) => {
	stanzas.push(stanza);
	for (const notify of waiters) notify();
});

try {
	await xmpp.start();
	await xmpp.send(xml("presence"));
	const requestId = `request-${randomUUID()}`;
	const task: AgentTaskRecord = {
		taskId: `caller-${randomUUID()}`,
		requestId,
		callerJid,
		notificationJid: callerJid,
		targetJid,
		tenantId: organizationId,
		tool: "ping",
		apiVersion: agent.manifest.agent.version,
		manifestHash: agent.manifestHash,
		arguments: {},
		state: "accepted",
		revision: 0,
		fingerprint: "caller-fingerprint",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		retainUntil: new Date(Date.now() + 60_000).toISOString(),
	};
	const invocation = buildTaskInvocation(task);
	await xmpp.send(invocation);
	const acceptedIq = await waitFor(
		(stanza) =>
			stanza.is("iq") &&
			stanza.attrs.id === invocation.attrs.id &&
			stanza.attrs.type === "result",
	);
	const accepted = acceptedIq.getChild("accepted", AGENT_TASK_NS);
	assert.ok(accepted);
	const taskId = String(accepted.attrs["task-id"]);
	const completedStanza = await waitFor((stanza) => {
		const event = parseTaskEvent(stanza);
		return event?.taskId === taskId && event.type === "completed";
	});
	const completed = parseTaskEvent(completedStanza);
	assert.ok(completed);
	const result = z
		.object({
			structuredContent: z.object({
				status: z.literal("ok"),
				requestId: z.string(),
			}),
		})
		.parse(completed.payload.result);
	assert.deepEqual(result.structuredContent, {
		status: "ok",
		requestId: taskId,
	});
	console.log("XMPP export E2E passed");
} finally {
	await xmpp.stop();
}

async function waitFor(
	predicate: (stanza: Element) => boolean,
	timeoutMs = 30_000,
): Promise<Element> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const match = stanzas.find(predicate);
		if (match) return match;
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("Timed out waiting for XMPP stanza");
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				waiters.delete(notify);
				reject(new Error("Timed out waiting for XMPP stanza"));
			}, remaining);
			const notify = () => {
				clearTimeout(timer);
				waiters.delete(notify);
				resolve();
			};
			waiters.add(notify);
		});
	}
}
