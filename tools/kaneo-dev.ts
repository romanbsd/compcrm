import { existsSync, statSync } from "node:fs";
import path from "node:path";

const DIST = path.join(
	import.meta.dir,
	"..",
	"vendor",
	"kaneo",
	"apps",
	"web",
	"dist",
);
const API_DIR = path.join(
	import.meta.dir,
	"..",
	"vendor",
	"kaneo",
	"apps",
	"api",
);
const KANEO_PACKAGES = path.join(
	import.meta.dir,
	"..",
	"vendor",
	"kaneo",
	"packages",
);
const API_ORIGIN = "http://127.0.0.1:1337";
const PORT = 5173;

function indexResponse(): Response {
	return new Response(Bun.file(path.join(DIST, "index.html")));
}

function fileResponse(relativePath: string): Response {
	const filePath = path.join(DIST, relativePath);
	if (
		relativePath === "/" ||
		!existsSync(filePath) ||
		statSync(filePath).isDirectory()
	) {
		return indexResponse();
	}
	return new Response(Bun.file(filePath));
}

async function proxyRequest(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const headers = new Headers(req.headers);
	headers.delete("host");
	const body = ["GET", "HEAD"].includes(req.method)
		? undefined
		: await req.arrayBuffer();
	const upstream = await fetch(`${API_ORIGIN}${url.pathname}${url.search}`, {
		method: req.method,
		headers,
		body,
		redirect: "manual",
	});
	const responseHeaders = new Headers(upstream.headers);
	responseHeaders.delete("content-encoding");
	return new Response(upstream.body, {
		status: upstream.status,
		headers: responseHeaders,
	});
}

export function startKaneoDevServer() {
	return Bun.serve({
		port: PORT,
		websocket: {
			open(ws) {
				const { upstream } = ws.data as { upstream: WebSocket };
				upstream.addEventListener("message", (event) => {
					ws.send(event.data);
				});
				upstream.addEventListener("close", () => {
					ws.close();
				});
				upstream.addEventListener("error", () => {
					ws.close();
				});
			},
			message(ws, message) {
				(ws.data as { upstream: WebSocket }).upstream.send(message);
			},
			close(ws) {
				(ws.data as { upstream: WebSocket }).upstream.close();
			},
		},
		async fetch(req, server) {
			const url = new URL(req.url);

			if (url.pathname.startsWith("/ws")) {
				const upstream = new WebSocket(
					`ws://127.0.0.1:1337${url.pathname}${url.search}`,
				);
				if (server.upgrade(req, { data: { upstream } })) {
					return undefined;
				}
				upstream.close();
				return new Response("upgrade failed", { status: 500 });
			}

			if (url.pathname.startsWith("/api/")) {
				return proxyRequest(req);
			}

			return fileResponse(url.pathname);
		},
	});
}

if (import.meta.main) {
	const packagesWithDist = ["email", "permissions", "mcp", "planka-import"];
	for (const pkg of packagesWithDist) {
		if (!existsSync(path.join(KANEO_PACKAGES, pkg, "dist", "index.js"))) {
			console.log(`building @kaneo/${pkg}...`);
			const built = Bun.spawnSync(["bunx", "tsc"], {
				cwd: path.join(KANEO_PACKAGES, pkg),
				env: process.env,
			});
			if (built.exitCode !== 0) {
				console.error(`failed to build @kaneo/${pkg}`);
				process.exit(1);
			}
		}
	}

	if (!existsSync(path.join(DIST, "index.html"))) {
		console.log("building kaneo web...");
		const webBuild = Bun.spawnSync(["bun", "run", "build"], {
			cwd: path.join(import.meta.dir, "..", "vendor", "kaneo", "apps", "web"),
			env: {
				...process.env,
				VITE_API_URL: "http://localhost:5173",
				VITE_CLIENT_URL: "http://localhost:5173",
			},
		});
		if (webBuild.exitCode !== 0) {
			console.error("failed to build kaneo web");
			process.exit(1);
		}
	}

	const apiEnv: Record<string, string> = {};
	for (const key of Object.keys(process.env)) {
		apiEnv[key] = process.env[key] ?? "";
	}
	const authSecret = process.env.BETTER_AUTH_SECRET;
	if (authSecret && !apiEnv.AUTH_SECRET) {
		apiEnv.AUTH_SECRET = authSecret;
	}
	apiEnv.KANEO_SKIP_DRIZZLE_MIGRATIONS = "1";
	apiEnv.KANEO_CLIENT_URL = "http://localhost:5173";
	apiEnv.CORS_ORIGINS = "http://localhost:5173";

	const api = Bun.spawn(["bunx", "tsx", "src/index.ts"], {
		cwd: API_DIR,
		env: apiEnv,
		stdout: "inherit",
		stderr: "inherit",
	});

	const server = startKaneoDevServer();
	console.log(`kaneo dev web: http://localhost:${server.port} → ${API_ORIGIN}`);

	const shutdown = () => {
		api.kill();
		server.stop(true);
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
