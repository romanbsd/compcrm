import { afterAll, describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";

interface WorkerRequest {
	id: number;
}

class FakeWorker extends EventEmitter {
	static instances: FakeWorker[] = [];
	request?: WorkerRequest;

	constructor() {
		super();
		FakeWorker.instances.push(this);
	}

	unref(): void {}

	postMessage(request: WorkerRequest): void {
		this.request = request;
	}

	terminate(): Promise<number> {
		return Promise.resolve(0);
	}
}

function workerAt(index: number): FakeWorker {
	const worker = FakeWorker.instances[index];
	if (!worker) throw new Error(`missing worker ${index}`);
	return worker;
}

mock.module("node:worker_threads", () => ({ Worker: FakeWorker }));

const schemaModule = "./schema.ts?worker-lineage";
const { closeSchemaWorkers, SCHEMA_WORKER_FAILURE_LIMIT, validateJsonBounded } =
	await import(schemaModule);

afterAll(async () => {
	await closeSchemaWorkers();
	mock.restore();
});

describe("schema worker replacement lineages", () => {
	it("stops one worker lineage after three interleaved failures", async () => {
		const schema = { type: "string" } as const;

		for (
			let generation = 0;
			generation < SCHEMA_WORKER_FAILURE_LIMIT;
			generation++
		) {
			const unaffectedValidation = validateJsonBounded(schema, "valid");
			const failedValidation = validateJsonBounded(schema, "failed");
			const unaffectedWorker = workerAt(0);
			const failingWorker = workerAt(generation + 1);
			const unaffectedRequest = unaffectedWorker.request;
			if (!unaffectedRequest) throw new Error("missing unaffected request");

			unaffectedWorker.emit("message", {
				id: unaffectedRequest.id,
				errors: [],
			});
			failingWorker.emit("error", new Error(`failure ${generation + 1}`));

			await expect(unaffectedValidation).resolves.toEqual([]);
			await expect(failedValidation).rejects.toThrow(
				`failure ${generation + 1}`,
			);
		}

		expect(FakeWorker.instances).toHaveLength(SCHEMA_WORKER_FAILURE_LIMIT + 1);
	});
});
