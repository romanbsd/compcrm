import { spawn } from "node:child_process";
import { constants } from "node:os";
import { startXmppGatewayHost } from "../src/xmpp/gateway-host";

const rawPort = process.env.AGENT_PORT ?? process.env.PORT ?? "2000";
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error(
		`AGENT_PORT or PORT must be a valid port, received ${rawPort}.`,
	);
}

const gateway =
	process.env.XMPP_COMPONENT_ENABLED === "1"
		? await startXmppGatewayHost()
		: null;
const cli = process.platform === "win32" ? "eve.cmd" : "eve";
const child = spawn(cli, ["start", "--port", String(port)], {
	stdio: "inherit",
	env: process.env,
});

let settled = false;

const finish = async (code: number) => {
	if (settled) return;
	settled = true;
	await gateway?.close();
	process.exitCode = code;
};

const forward = (signal: NodeJS.Signals) => {
	if (!child.killed) child.kill(signal);
};

process.once("SIGINT", forward);
process.once("SIGTERM", forward);

child.once("exit", (code, signal) => {
	const signalNumber = signal ? constants.signals[signal] : null;
	void finish(code ?? (signalNumber ? 128 + signalNumber : 1));
});

child.once("error", (error) => {
	console.error(`[agent] could not start eve: ${error.message}`);
	void finish(1);
});
