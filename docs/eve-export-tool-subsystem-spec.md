# `exportTool` Subsystem Specification for Eve Agents

## Status

**Proposed**

This document specifies an `exportTool` subsystem for an Eve agent that exposes selected agent-level operations to external callers such as an XMPP agent gateway.

The key design goal is to expose **agent operations**, not raw Eve tools.

An exported operation may contain:

1. deterministic application logic,
2. durable evidence/artifact creation,
3. optional agentic reasoning through Eve,
4. local Eve tool calls made by that agent,
5. subagent or remote-agent delegation,
6. a typed, machine-readable final result.

The external caller sees one stable operation such as:

```text
handle_recording(url)
```

while the local implementation may internally perform a deterministic preprocessing pipeline and only invoke the LLM when judgment is actually required.

---

# 1. Motivation

An Eve tool is primarily a capability **called by the local model**.

For example:

```text
model -> crm_create_task(...)
```

An exported operation has the opposite direction:

```text
remote agent -> local Eve agent operation
```

Treating the exported operation itself as an Eve tool is awkward because the remote caller has already selected the operation, and the operation may need to invoke the local agent for reasoning.

The subsystem therefore introduces a separate abstraction:

```text
exportTool
```

Despite the name, an `exportTool` is not necessarily an Eve model tool. It is an externally callable operation implemented by the application hosting the Eve agent.

Its internal execution may be fully deterministic, fully agentic, or a mixture of both.

---

# 2. Design Goals

The subsystem MUST:

- expose a deliberate, allowlisted set of remotely callable operations;
- describe each operation with a typed input schema;
- optionally describe a typed output schema;
- allow arbitrary deterministic TypeScript before and after LLM execution;
- allow the operation to inject work into the already-running Eve runtime without HTTP loopback;
- avoid creating `new Client({ host })` when the invocation already runs inside the Eve process;
- allow the agent to use its normal instructions, tools, skills, sandbox, state, and subagents;
- preserve cancellation;
- support progress reporting;
- support deterministic validation before any LLM tokens are spent;
- allow manifest/tool metadata generation for the external gateway;
- keep externally visible operation schemas separate from the model-facing Eve tool set;
- make it impossible to accidentally export every Eve tool;
- make deterministic-only operations possible without invoking an LLM.

The subsystem SHOULD:

- use Standard Schema-compatible schemas;
- support Zod directly;
- support JSON Schema export;
- map one remote invocation to one Eve task/session by default;
- make the Eve invocation mechanism replaceable;
- permit future structured-output support without changing exported operation implementations.

---

# 3. Non-goals

The subsystem does not implement:

- XMPP stanza parsing;
- XMPP discovery;
- XMPP task persistence;
- Deepgram itself;
- CRM APIs;
- Eve's runtime;
- generic MCP transport.

Those are consumers or dependencies of this subsystem.

The subsystem is specifically the Eve-side execution and exported-operation layer.

---

# 4. Conceptual Model

The primary abstraction is:

```text
External caller
      |
      v
exportTool operation
      |
      +---- deterministic TypeScript
      |
      +---- services / database / evidence
      |
      +---- optional ctx.send(...)
                     |
                     v
                Eve agent turn
                     |
                     +---- LLM reasoning
                     +---- local Eve tools
                     +---- skills
                     +---- subagents
                     +---- sandbox
                     |
                     v
                result
```

Example:

```text
handle_recording(url)
      |
      +-- fetch URL
      +-- transcode to 16 kHz mono
      +-- call Deepgram
      +-- persist transcript as evidence
      |
      +-- ctx.send("Process evidence ev_123...")
               |
               +-- agent reads evidence
               +-- reasons about transcript
               +-- updates CRM
               +-- delegates work
               +-- returns summary/actions
```

The deterministic steps do not consume model tokens.

---

# 5. Filesystem Layout

Recommended layout:

```text
agent/
├── agent.ts
├── instructions.md
│
├── tools/
│   ├── read_evidence.ts
│   ├── crm_find_contact.ts
│   ├── crm_add_note.ts
│   └── crm_create_task.ts
│
├── channels/
│   └── xmpp.ts
│
└── exports/
    ├── handle_recording.ts
    └── ping.ts

src/
├── export-tools/
│   ├── define-export-tool.ts
│   ├── registry.ts
│   ├── executor.ts
│   ├── schema.ts
│   ├── context.ts
│   └── errors.ts
│
├── services/
│   ├── recordings.ts
│   ├── audio.ts
│   ├── deepgram.ts
│   └── evidence.ts
│
└── xmpp/
    ├── gateway-client.ts
    └── manifest.ts
```

`agent/tools/` remains the set of capabilities callable by the local Eve model.

`agent/exports/` contains the operations callable by remote agents.

These two sets MUST NOT be conflated.

---

# 6. Public API

## 6.1 `defineExportTool`

The basic API:

```ts
export const handleRecording = defineExportTool({
  description: "Handle a recording and perform appropriate follow-up work",

  inputSchema: z.object({
    url: z.string().url(),
  }),

  outputSchema: z.object({
    evidenceId: z.string(),
    summary: z.string(),
    actionsTaken: z.array(
      z.object({
        type: z.string(),
        description: z.string(),
      }),
    ),
  }),

  async execute(input, ctx) {
    // arbitrary deterministic and/or agentic work
  },
});
```

The definition MUST be a plain serializable-capability description plus an executable function.

Proposed types:

```ts
export interface ExportToolDefinition<I, O> {
  readonly description: string;

  readonly inputSchema: StandardSchemaV1<I>;

  readonly outputSchema?: StandardSchemaV1<O>;

  readonly annotations?: ExportToolAnnotations;

  execute(
    input: I,
    ctx: ExportToolContext,
  ): Promise<O> | O;
}

export interface ExportToolAnnotations {
  readonly title?: string;
  readonly idempotent?: boolean;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly longRunning?: boolean;
}
```

Helper:

```ts
export function defineExportTool<I, O>(
  definition: ExportToolDefinition<I, O>,
): ExportToolDefinition<I, O> {
  return definition;
}
```

This wrapper may later attach a symbol or metadata marker so the registry can reject arbitrary objects.

---

# 7. Naming

The operation name SHOULD come from the filename, matching Eve's filesystem-first style.

Example:

```text
agent/exports/handle_recording.ts
```

becomes:

```text
handle_recording
```

Do not duplicate the name inside the definition unless a later requirement justifies aliases.

This avoids:

```ts
defineExportTool({
  name: "handle_recording",
  ...
})
```

and keeps naming consistent with Eve tools.

---

# 8. ExportTool Context

The core context type:

```ts
export interface ExportToolContext {
  /**
   * Abort when the external task is cancelled or the surrounding
   * Eve runtime is shutting down.
   */
  readonly abortSignal: AbortSignal;

  /**
   * Identity and metadata for the remote invocation.
   */
  readonly invocation: ExportInvocation;

  /**
   * Deterministic application services.
   */
  readonly services: ApplicationServices;

  /**
   * Report progress to the external task system.
   */
  progress(update: ExportProgress): Promise<void>;

  /**
   * Start a turn in the already-running Eve runtime.
   *
   * This is intentionally an abstraction over Eve's current
   * channel send primitive rather than an HTTP Client.
   */
  send<T = unknown>(
    request: ExportAgentRequest<T>,
  ): Promise<ExportAgentResult<T>>;
}
```

Supporting types:

```ts
export interface ExportInvocation {
  readonly requestId: string;
  readonly operation: string;
  readonly caller?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ExportProgress {
  readonly stage?: string;
  readonly percent?: number;
  readonly message?: string;
}

export interface ExportAgentRequest<T> {
  readonly message: string | UserContent;

  /**
   * Optional structured result contract.
   *
   * The adapter is responsible for mapping this to the best
   * Eve runtime mechanism available in the installed Eve version.
   */
  readonly outputSchema?: StandardSchemaV1<T>;

  readonly title?: string;

  /**
   * For remote RPC-style invocation this should normally be true.
   */
  readonly taskMode?: boolean;

  /**
   * Non-durable metadata that may be injected as ephemeral
   * context if the Eve entry path supports it.
   */
  readonly clientContext?: unknown;
}

export interface ExportAgentResult<T> {
  readonly sessionId: string;
  readonly value: T;
}
```

The operation MUST NOT instantiate an Eve HTTP client.

It receives `ctx.send()` from the integration boundary.

---

# 9. Why `ctx.send()` Is an Adapter

Eve's public APIs distinguish several contexts.

Eve custom channels can call `send()` from an inbound channel handler to start or resume a session. This runs the normal Eve runtime in-process.

However, the exact set of supported options on channel-based `send()` differs across Eve entry surfaces, and structured `outputSchema` propagation is not uniformly available in every channel API at the time of writing.

Therefore the exported operation SHOULD NOT depend directly on a specific Eve internal signature.

Bad:

```ts
async execute(input, ctx) {
  return internalEveRuntimePrivateFunction(...);
}
```

Also undesirable:

```ts
const client = new Client({
  host: process.env.EVE_URL!,
});
```

Recommended:

```ts
async execute(input, ctx) {
  return ctx.send({
    message: "...",
    outputSchema: ResultSchema,
    taskMode: true,
  });
}
```

The channel/integration adapter owns the Eve-version-specific implementation.

This creates a small compatibility seam.

---

# 10. Runtime Integration

The preferred integration point is an Eve custom channel or another authored Eve runtime entrypoint that already has access to the in-process `send()` capability.

Conceptually:

```ts
export default defineChannel({
  routes: [
    // optional HTTP routes if needed by the integration
  ],

  async receive(input, runtime) {
    // runtime.send is Eve's in-process session dispatch primitive
  },
});
```

For an XMPP bridge that already runs in the same Node process, the bridge should hand an invocation to the export-tool executor while providing an adapter around the live Eve `send` function.

Pseudo-code:

```ts
async function onXmppInvocation(invocation, eveRuntimeCtx) {
  return executeExportTool(
    invocation.tool,
    invocation.arguments,
    {
      invocation,
      abortSignal: invocation.abortSignal,
      services,
      progress: invocation.progress,

      send: async (request) => {
        return sendThroughEveRuntime(
          eveRuntimeCtx,
          request,
        );
      },
    },
  );
}
```

The `exportTool` implementation itself remains unaware of XMPP and Eve transport details.

---

# 11. Registry

The registry explicitly defines the public surface.

Example:

```ts
import handleRecording from "../../agent/exports/handle_recording";
import ping from "../../agent/exports/ping";

export const exportTools = {
  handle_recording: handleRecording,
  ping,
} as const;
```

The registry MUST be explicit.

Do not recursively export everything in `agent/tools`.

Automatic filesystem discovery of `agent/exports/*.ts` is acceptable if the directory itself is the allowlist.

---

# 12. Invocation Executor

The executor performs:

1. tool lookup,
2. input validation,
3. context creation,
4. execution,
5. optional output validation,
6. normalized error conversion.

Example:

```ts
export async function executeExportTool(
  name: string,
  rawInput: unknown,
  ctx: ExportToolContext,
): Promise<unknown> {
  const definition = exportTools[name];

  if (!definition) {
    throw new ExportToolNotFoundError(name);
  }

  const inputResult =
    await definition.inputSchema["~standard"].validate(rawInput);

  if (inputResult.issues) {
    throw new ExportToolValidationError(
      "Invalid export tool input",
      inputResult.issues,
    );
  }

  const output = await definition.execute(
    inputResult.value,
    ctx,
  );

  if (!definition.outputSchema) {
    return output;
  }

  const outputResult =
    await definition.outputSchema["~standard"].validate(output);

  if (outputResult.issues) {
    throw new ExportToolValidationError(
      "Invalid export tool output",
      outputResult.issues,
    );
  }

  return outputResult.value;
}
```

Input validation MUST occur before deterministic processing and before any LLM call.

Output validation SHOULD occur before sending the result back to the gateway.

---

# 13. Full Example: `handle_recording`

## 13.1 Schema

```ts
// agent/exports/handle_recording.ts

import { z } from "zod";
import { defineExportTool } from "../../src/export-tools/define-export-tool";

export const HandleRecordingInput = z.object({
  url: z.string().url(),
});

export const HandleRecordingOutput = z.object({
  evidenceId: z.string(),

  transcript: z.object({
    durationSeconds: z.number().nonnegative(),
    language: z.string().optional(),
  }),

  summary: z.string(),

  actionsTaken: z.array(
    z.object({
      type: z.string(),
      description: z.string(),
    }),
  ),
});
```

---

## 13.2 Implementation

```ts
export default defineExportTool({
  description:
    "Fetch and transcribe a recording, preserve the transcript as evidence, " +
    "then have the secretary agent interpret it and perform appropriate follow-up work.",

  inputSchema: HandleRecordingInput,
  outputSchema: HandleRecordingOutput,

  annotations: {
    title: "Handle recording",
    idempotent: false,
    readOnly: false,
    longRunning: true,
  },

  async execute({ url }, ctx) {
    //
    // Deterministic phase
    //

    await ctx.progress({
      stage: "fetch",
      percent: 5,
      message: "Fetching recording",
    });

    const recording = await ctx.services.recordings.fetch(url, {
      signal: ctx.abortSignal,
    });

    await ctx.progress({
      stage: "transcode",
      percent: 20,
      message: "Transcoding recording",
    });

    const audio = await ctx.services.audio.transcode(recording, {
      sampleRate: 16_000,
      channels: 1,
      signal: ctx.abortSignal,
    });

    await ctx.progress({
      stage: "transcribe",
      percent: 40,
      message: "Transcribing recording",
    });

    const transcription =
      await ctx.services.deepgram.transcribe(audio, {
        signal: ctx.abortSignal,
      });

    await ctx.progress({
      stage: "evidence",
      percent: 60,
      message: "Storing transcript as evidence",
    });

    const evidence = await ctx.services.evidence.create({
      type: "recording-transcript",

      source: {
        kind: "url",
        url,
      },

      content: transcription.text,

      metadata: {
        durationSeconds: transcription.durationSeconds,
        language: transcription.language,
        provider: "deepgram",
      },
    });

    //
    // Agentic phase
    //

    await ctx.progress({
      stage: "reasoning",
      percent: 70,
      message: "Processing transcript",
    });

    const agentResult = await ctx.send({
      taskMode: true,

      title: "Process recording",

      message: `
A new recording has been transcribed and stored as evidence.

Evidence ID: ${evidence.id}

Process this recording according to your secretary responsibilities.

Inspect the evidence using the available evidence tools. Determine the
important facts, commitments, requests, deadlines, follow-ups, and CRM
implications. Perform appropriate actions using your available tools and
agents.

Do not claim an action was performed unless the corresponding tool call
succeeded.

Return:
- a concise summary;
- the actions actually taken.
`.trim(),

      outputSchema: z.object({
        summary: z.string(),

        actionsTaken: z.array(
          z.object({
            type: z.string(),
            description: z.string(),
          }),
        ),
      }),

      clientContext: {
        invocation: "handle_recording",
        externalRequestId: ctx.invocation.requestId,
        caller: ctx.invocation.caller,
      },
    });

    await ctx.progress({
      stage: "complete",
      percent: 100,
      message: "Recording processed",
    });

    return {
      evidenceId: evidence.id,

      transcript: {
        durationSeconds: transcription.durationSeconds,
        language: transcription.language,
      },

      summary: agentResult.value.summary,
      actionsTaken: agentResult.value.actionsTaken,
    };
  },
});
```

The important property is that the model sees none of the fetch/transcode/Deepgram machinery.

The LLM is invoked only after the transcript has been produced.

---

# 14. Evidence Tool

The agent needs a way to inspect the transcript.

Recommended model-facing Eve tool:

```ts
// agent/tools/read_evidence.ts

import { defineTool } from "eve/tools";
import { z } from "zod";
import { evidence } from "../../src/services/evidence";

export default defineTool({
  description:
    "Read stored evidence such as transcripts, messages, and documents.",

  inputSchema: z.object({
    id: z.string(),
    start: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(20000).optional(),
  }),

  async execute({ id, start = 0, limit = 8000 }, ctx) {
    const item = await evidence.get(id);

    if (!item) {
      throw new Error(`Evidence not found: ${id}`);
    }

    const chunk = item.content.slice(start, start + limit);

    return {
      id: item.id,
      type: item.type,
      content: chunk,
      start,
      end: start + chunk.length,
      totalLength: item.content.length,
      hasMore: start + chunk.length < item.content.length,
    };
  },
});
```

For long transcripts, also expose:

```text
search_evidence(id, query)
```

so the agent does not need to inject a complete hour-long transcript into model context.

---

# 15. In-Process `ctx.send()` Adapter

The exported-operation context SHOULD expose a stable application-level `send()` method.

The integration layer maps it to Eve's current runtime API.

Conceptual implementation:

```ts
function makeExportToolContext(
  invocation: XmppInvocation,
  eveChannelContext: EveChannelContext,
): ExportToolContext {
  return {
    abortSignal: invocation.abortSignal,

    invocation: {
      requestId: invocation.requestId,
      operation: invocation.tool,
      caller: invocation.from,
    },

    services,

    progress: async (update) => {
      await invocation.reportProgress(update);
    },

    send: async (request) => {
      const result = await eveChannelContext.send(
        request.message,
        {
          auth: invocationAuth(invocation),
          mode: request.taskMode ? "task" : undefined,
          title: request.title,

          // If/when the selected Eve send surface accepts these directly:
          // outputSchema: request.outputSchema,
          // clientContext: request.clientContext,
        },
      );

      return await collectAgentResult(
        result,
        request.outputSchema,
      );
    },
  };
}
```

This snippet is intentionally adapter-level pseudocode.

The installed Eve version determines the exact channel `send()` result type and which per-turn fields are directly supported.

The operation API remains stable.

---

# 16. Structured Result Compatibility

At the time of this design, Eve supports structured task results through `outputSchema` in task-mode/client-oriented surfaces, and emits `result.completed` for such turns.

However, not all custom-channel/cross-channel entry surfaces currently propagate `outputSchema` uniformly.

Therefore the subsystem MUST isolate this behavior behind:

```ts
ctx.send(...)
```

and:

```ts
collectAgentResult(...)
```

The preferred order of implementation is:

1. use native Eve structured-output support when available on the in-process send path;
2. otherwise use a small compatibility adapter;
3. do not make the exported operation instantiate an HTTP `Client`;
4. do not import private Eve runtime internals.

A future Eve upgrade should require changing only the adapter.

---

# 17. Result Collection

`ctx.send()` should resolve only when the task-mode turn reaches a terminal state.

Conceptually:

```ts
async function collectAgentResult<T>(
  session: EveSessionHandle,
  schema?: StandardSchemaV1<T>,
): Promise<ExportAgentResult<T>> {
  for await (const event of session.stream()) {
    switch (event.type) {
      case "result.completed":
        return {
          sessionId: session.id,
          value: event.data.result as T,
        };

      case "turn.failed":
      case "session.failed":
        throw new ExportAgentRunError(event);

      case "turn.cancelled":
        throw new ExportCancelledError();
    }
  }

  throw new ExportAgentRunError(
    "Eve session ended without a result",
  );
}
```

Exact event names/types MUST follow the installed Eve version.

---

# 18. Cancellation

Cancellation MUST propagate end-to-end:

```text
remote cancellation
      |
      v
export invocation AbortController
      |
      +-- fetch abort
      +-- transcode abort/kill
      +-- Deepgram abort
      +-- evidence write abort where possible
      |
      +-- Eve turn cancellation
```

All deterministic services SHOULD accept an `AbortSignal`.

Example:

```ts
await recordings.fetch(url, {
  signal: ctx.abortSignal,
});
```

The Eve adapter SHOULD bind the same cancellation source to the Eve task/session cancellation API.

The mapping should be retained:

```text
external task id -> Eve session id / turn id
```

until completion.

---

# 19. Progress

Progress is application-level and independent of LLM text.

Recommended stages for `handle_recording`:

```text
5%   fetch
20%  transcode
40%  transcribe
60%  evidence
70%  reasoning
100% complete
```

The percentages are advisory.

The gateway should treat stage/message as more authoritative than exact percentage.

Agent stream events MAY also be translated into richer progress messages, but the exported operation should not depend on model narration.

---

# 20. Error Model

Define normalized error types:

```ts
export class ExportToolNotFoundError extends Error {}
export class ExportToolValidationError extends Error {}
export class ExportToolExecutionError extends Error {}
export class ExportAgentRunError extends Error {}
export class ExportCancelledError extends Error {}
```

Suggested externally visible error codes:

```text
EXPORT_TOOL_NOT_FOUND
INVALID_ARGUMENTS
DETERMINISTIC_PROCESSING_FAILED
AGENT_RUN_FAILED
CANCELLED
OUTPUT_VALIDATION_FAILED
INTERNAL_ERROR
```

Do not leak arbitrary stack traces to remote callers.

Log the full cause locally.

---

# 21. Idempotency

Some exported operations cause side effects.

`handle_recording` may:

- create evidence,
- update CRM state,
- create tasks,
- send messages.

The invocation subsystem SHOULD pass a stable `requestId`.

Deterministic side effects SHOULD use it as an idempotency key where practical.

Example:

```ts
const evidence = await evidence.create({
  idempotencyKey:
    `handle_recording:${ctx.invocation.requestId}:transcript`,
  ...
});
```

For an external retry of the same invocation, the subsystem SHOULD avoid creating duplicate evidence or CRM work.

If the XMPP gateway already guarantees exactly-once logical task identity, use that task/request identifier.

---

# 22. Manifest Generation

The externally visible tool manifest is generated from `agent/exports/`, not from `agent/tools/`.

For each export:

```ts
interface ExportToolManifestEntry {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: ExportToolAnnotations;
}
```

Conceptually:

```ts
function manifestEntry(
  name: string,
  definition: ExportToolDefinition<any, any>,
): ExportToolManifestEntry {
  return {
    name,
    description: definition.description,
    inputSchema: toJsonSchema(definition.inputSchema),
    outputSchema: definition.outputSchema
      ? toJsonSchema(definition.outputSchema)
      : undefined,
    annotations: definition.annotations,
  };
}
```

Do not maintain a second handwritten schema in the gateway.

The authored schema is the source of truth.

---

# 23. Security Boundary

Only definitions under the export registry are remotely callable.

For example:

```text
agent/tools/bash.ts
agent/tools/write_file.ts
agent/tools/send_email.ts
```

do NOT automatically become:

```text
remote.bash(...)
remote.write_file(...)
remote.send_email(...)
```

The public XMPP surface might expose only:

```text
handle_recording
prepare_followup
process_invoice
```

The local model may internally call `send_email`, but a remote caller cannot invoke it directly unless it is intentionally exported.

---

# 24. Deterministic-only Export

Not every exported operation needs Eve.

Example:

```ts
export default defineExportTool({
  description: "Return the current agent build information",

  inputSchema: z.object({}),

  outputSchema: z.object({
    version: z.string(),
    commit: z.string(),
  }),

  async execute(_input, ctx) {
    return {
      version: ctx.services.build.version,
      commit: ctx.services.build.commit,
    };
  },
});
```

No model call occurs.

This is a useful property of the abstraction.

---

# 25. Agent-only Export

At the other extreme:

```ts
export default defineExportTool({
  description: "Review a customer situation and decide what to do",

  inputSchema: z.object({
    customerId: z.string(),
  }),

  outputSchema: ReviewResult,

  async execute({ customerId }, ctx) {
    const result = await ctx.send({
      taskMode: true,
      message:
        `Review customer ${customerId} according to your normal responsibilities.`,
      outputSchema: ReviewResult,
    });

    return result.value;
  },
});
```

The subsystem supports both extremes without changing the external contract.

---

# 26. Recommended Session Semantics

For RPC-style exported operations, the default SHOULD be:

```text
one remote invocation -> one fresh Eve task/session
```

Reasons:

- no accidental conversational contamination;
- deterministic ownership;
- straightforward cancellation;
- straightforward task/result mapping;
- simple retry semantics.

Future exported operations MAY explicitly opt into a durable conversation/session key, but this should not be the default.

---

# 27. Auth and Principal Mapping

The integration layer should decide which Eve principal represents the remote invocation.

Possible policies:

```text
service principal:
  xmpp-agent-gateway

forwarded caller:
  agent@example.com

compound principal:
  xmpp:agent@example.com
```

The exported operation should not construct Eve authentication manually.

Provide it through the `ctx.send()` adapter.

---

# 28. Testing

## 28.1 Unit-test deterministic processing

Mock `ctx.send()`.

Example:

```ts
it("transcribes before invoking the agent", async () => {
  const calls: string[] = [];

  const ctx = makeTestContext({
    recordings: {
      fetch: async () => {
        calls.push("fetch");
        return recording;
      },
    },

    audio: {
      transcode: async () => {
        calls.push("transcode");
        return wav;
      },
    },

    deepgram: {
      transcribe: async () => {
        calls.push("transcribe");
        return {
          text: "hello",
          durationSeconds: 2,
        };
      },
    },

    evidence: {
      create: async () => {
        calls.push("evidence");
        return { id: "ev_1" };
      },
    },

    send: async () => {
      calls.push("send");
      return {
        sessionId: "ses_1",
        value: {
          summary: "hello",
          actionsTaken: [],
        },
      };
    },
  });

  await handleRecording.execute(
    { url: "https://example.com/a.mp3" },
    ctx,
  );

  expect(calls).toEqual([
    "fetch",
    "transcode",
    "transcribe",
    "evidence",
    "send",
  ]);
});
```

This test spends zero model tokens.

---

## 28.2 Validation test

Verify invalid URLs fail before service calls:

```ts
await expect(
  executeExportTool(
    "handle_recording",
    { url: "not a URL" },
    ctx,
  ),
).rejects.toThrow(ExportToolValidationError);
```

---

## 28.3 Deterministic-only test

Verify an export can complete without calling `ctx.send()`.

---

## 28.4 Eve integration test

Use Eve's testing/eval facilities or a deterministic mock model to assert:

- the exported operation creates an Eve task;
- the evidence ID is in the task message;
- the local agent calls `read_evidence`;
- CRM tools can be called;
- a structured result is eventually returned.

---

## 28.5 Cancellation test

Cancel while:

1. fetching,
2. transcoding,
3. transcribing,
4. waiting on Eve.

Each should settle as `CANCELLED`.

---

# 29. Observability

Every export invocation SHOULD log:

```text
requestId
operation
caller
startTime
endTime
duration
deterministic stage timings
Eve sessionId
result status
error code
```

Recommended trace structure:

```text
export.handle_recording
├── fetch
├── transcode
├── deepgram
├── evidence.create
└── eve.send
    ├── session
    ├── model steps
    └── tool calls
```

Do not log full transcripts by default.

---

# 30. Suggested Initial Implementation Order

1. Implement `defineExportTool`.
2. Implement explicit registry.
3. Implement Standard Schema input/output validation.
4. Implement `ExportToolContext`.
5. Implement XMPP invocation -> executor wiring.
6. Implement progress and cancellation.
7. Implement in-process Eve `send()` adapter.
8. Implement `handle_recording`.
9. Implement `read_evidence`.
10. Generate gateway manifest from export schemas.
11. Add idempotency.
12. Add integration tests.
13. Add structured-result compatibility shim if the selected Eve channel entry path cannot pass `outputSchema` directly.

---

# 31. Minimal End-to-End Example

The smallest meaningful implementation is:

```ts
// agent/exports/handle_recording.ts

export default defineExportTool({
  description: "Transcribe and process a recording",

  inputSchema: z.object({
    url: z.string().url(),
  }),

  outputSchema: z.object({
    evidenceId: z.string(),
    summary: z.string(),
  }),

  async execute({ url }, ctx) {
    // deterministic
    const input = await ctx.services.recordings.fetch(url, {
      signal: ctx.abortSignal,
    });

    const wav = await ctx.services.audio.transcode(input, {
      sampleRate: 16_000,
      channels: 1,
      signal: ctx.abortSignal,
    });

    const transcript =
      await ctx.services.deepgram.transcribe(wav, {
        signal: ctx.abortSignal,
      });

    const evidence = await ctx.services.evidence.create({
      type: "transcript",
      content: transcript.text,
    });

    // agentic
    const run = await ctx.send({
      taskMode: true,

      message:
        `Process transcript evidence ${evidence.id}. ` +
        `Perform appropriate follow-up actions.`,

      outputSchema: z.object({
        summary: z.string(),
      }),
    });

    return {
      evidenceId: evidence.id,
      summary: run.value.summary,
    };
  },
});
```

The corresponding Eve-side evidence tool:

```ts
// agent/tools/read_evidence.ts

export default defineTool({
  description: "Read stored evidence",

  inputSchema: z.object({
    id: z.string(),
  }),

  async execute({ id }) {
    return evidence.get(id);
  },
});
```

And the conceptual in-process adapter:

```ts
const ctx = {
  ...,

  send: async (request) => {
    // Adapt the currently active Eve channel/runtime `send`
    // primitive here. Do not instantiate `eve/client`.

    const session = await eveSend(
      request.message,
      {
        mode: request.taskMode ? "task" : undefined,
        title: request.title,
      },
    );

    return collectAgentResult(
      session,
      request.outputSchema,
    );
  },
};
```

This is the central pattern the subsystem should preserve.

---

# 32. Architectural Rule of Thumb

Use deterministic code when the answer is procedural and known:

```text
fetch
decode
transcode
hash
parse
validate
call API
persist
```

Use Eve when the operation requires judgment:

```text
interpret
prioritize
classify ambiguous information
decide whether an action is warranted
choose among tools
compose context-sensitive communication
delegate to another agent
```

An `exportTool` is the orchestrator that can combine both.

---

# 33. Eve API Notes

This design intentionally stays within Eve's public concepts.

Relevant current Eve behavior:

- Eve tools are typed actions called by the model and receive runtime `ctx`.
- Custom channels normalize inbound work and use an in-process `send()` path to start or resume Eve sessions.
- Eve task-mode runs are intended for work that runs to completion rather than interactive HITL conversation.
- Eve emits `result.completed` for turns that use structured output.
- Eve's public TypeScript API documentation explicitly warns that APIs not exported through the public package surface are framework internals.
- Current Eve channel/cross-channel APIs do not expose every structured-output option uniformly; therefore this specification deliberately hides Eve send mechanics behind the local `ctx.send()` adapter.

Do not import private Eve workflow/session internals to implement `exportTool`.

---

# 34. References

Eve documentation and source:

- https://github.com/vercel/eve/blob/main/docs/tools/overview.mdx
- https://github.com/vercel/eve/blob/main/docs/channels/overview.mdx
- https://github.com/vercel/eve/blob/main/docs/channels/slack.mdx
- https://github.com/vercel/eve/blob/main/docs/channels/eve.mdx
- https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md
- https://github.com/vercel/eve/blob/main/docs/reference/typescript-api.md
- https://github.com/vercel/eve/blob/main/docs/agent-config.md
- https://github.com/vercel/eve/blob/main/docs/schedules.mdx
- https://github.com/vercel/eve/issues/214
- https://github.com/vercel/eve/issues/1270

XMPP gateway client reference:

- https://raw.githubusercontent.com/romanbsd/xmpp-agent-gateway/refs/heads/master/docs/xmpp-client-guide.md
