import {
	type GatewayConfig,
	loadConfig as loadGatewayConfig,
} from "@agent-xmpp/gateway";

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

export const XMPP_EXPORT = {
	task: {
		retentionMs: 24 * HOUR_MS,
	},
	gateway: {
		sweepMs: 5 * SECOND_MS,
	},
} as const;

export interface XmppHostConfig {
	readonly gateway: GatewayConfig;
	readonly organizationId: string;
	readonly bridgeSecret: string;
	readonly agentUrl: string;
	readonly agentVersion?: string;
	readonly allowedCallerDomains: ReadonlySet<string>;
	readonly destructiveCallers: ReadonlySet<string>;
}

export function loadXmppHostConfig(): XmppHostConfig {
	const gateway = loadGatewayConfig();
	return {
		gateway,
		organizationId: requiredEnv("XMPP_ORGANIZATION_ID"),
		bridgeSecret: requiredEnv("AGENT_BRIDGE_SECRET"),
		agentUrl: process.env.AGENT_URL ?? "http://127.0.0.1:2000",
		agentVersion: process.env.XMPP_AGENT_VERSION,
		allowedCallerDomains: commaSeparatedSet(
			process.env.XMPP_ALLOWED_CALLER_DOMAINS ??
				`${gateway.serverDomain},${gateway.agentDomain}`,
		),
		destructiveCallers: commaSeparatedSet(
			process.env.XMPP_ALLOW_DESTRUCTIVE_CALLERS,
		),
	};
}

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required env: ${name}`);
	return value;
}

function commaSeparatedSet(value: string | undefined): ReadonlySet<string> {
	return new Set(
		(value ?? "")
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean),
	);
}
