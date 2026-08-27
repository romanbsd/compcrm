import {
  DEFAULT_PROTOCOL_NAMESPACES,
  JSON_MEDIA_TYPE,
  bareJid,
  isApiVersion,
  isNormalizedEndpointJid,
  isOpaqueIdentifier,
  isToolName,
  isXep0082DateTime,
  parseStrictJson,
  taskEventTypes,
  taskStates,
  terminalTaskStates,
  type AgentTaskEventType,
  type AgentTaskRecord,
  type AgentTaskState,
  type AgentXmppNamespaces,
  type McpToolResult,
  type PendingTaskInput,
} from '@agent-xmpp/protocol';
import { xml, type Element } from '@xmpp/xml';

import { buildHash, parseHash } from './hash-codec.js';

export interface ParsedTaskInvocation {
  requestId: string;
  tool: string;
  apiVersion: string;
  manifestHash: string;
  callerJid: string;
  notificationJid: string;
  toJid: string;
  arguments: unknown;
  deadline?: string;
}

export interface ParsedTaskRecoveryRequest {
  kind: 'state' | 'result';
  taskId: string;
}

export interface ParsedTaskCancellation {
  taskId: string;
  expectedRevision: number;
  reason?: string;
}

export interface ParsedTaskInput {
  taskId: string;
  requestId: string;
  expectedRevision: number;
  input: unknown;
}

export interface TaskWireEvent {
  taskId: string;
  eventId: string;
  revision: number;
  type: AgentTaskEventType;
  from: string;
  to: string;
  payload: Record<string, unknown>;
}

export interface AcceptedTask {
  requestId: string;
  taskId: string;
  revision: number;
  created: string;
  retainUntil: string;
}

export interface TaskStateSnapshot {
  taskId: string;
  endpoint: string;
  state: AgentTaskState;
  revision: number;
  apiVersion: string;
  manifestHash: string;
  created: string;
  updated: string;
  retainUntil: string;
  deadline?: string;
  resultAvailable: boolean;
  pendingInput?: PendingTaskInput;
}

export interface TaskResultSnapshot {
  taskId: string;
  state: Extract<AgentTaskState, 'cancelled' | 'failed' | 'completed'>;
  revision: number;
  result?: McpToolResult;
  error?: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
  summary?: string;
}

export function parseTaskInvocation(
  stanza: Element,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): ParsedTaskInvocation | null {
  if (stanza.name !== 'iq' || stanza.attrs.type !== 'set') return null;
  const payloads = stanza.getChildElements();
  const invoke = stanza.getChild('invoke', namespaces.task);
  if (!invoke) return null;
  if (payloads.length !== 1 || payloads[0] !== invoke) {
    throw new Error('invoke must be the only IQ payload');
  }
  assertOnlyAttributes(invoke, ['xmlns', 'request-id', 'tool', 'api-version']);
  const children = invoke.getChildElements();
  const expectedNames =
    children.length === 3 ? ['manifest-hash', 'arguments', 'deadline'] : ['manifest-hash', 'arguments'];
  if (
    children.length < 2 ||
    children.length > 3 ||
    children.some((child, index) => child.name !== expectedNames[index] || child.getNS() !== namespaces.task)
  ) {
    throw new Error('invoke children must be manifest-hash, arguments, then optional deadline');
  }
  const [manifestHashElement, argumentsElement, deadlineElement] = children;
  assertOnlyAttributes(manifestHashElement!, ['xmlns']);
  assertOnlyAttributes(argumentsElement!, ['xmlns', 'media-type']);
  if (deadlineElement) assertOnlyAttributes(deadlineElement, ['xmlns']);
  const hashChildren = manifestHashElement!.getChildElements();
  if (hashChildren.length !== 1 || hashChildren[0]!.name !== 'hash' || hashChildren[0]!.getNS() !== namespaces.hashes) {
    throw new Error('manifest-hash must contain exactly one XEP-0300 hash');
  }
  assertOnlyAttributes(hashChildren[0]!, ['xmlns', 'algo']);
  if (argumentsElement!.getChildElements().length > 0 || (deadlineElement?.getChildElements().length ?? 0) > 0) {
    throw new Error('arguments and deadline must contain character data only');
  }
  const requestId = String(invoke.attrs['request-id'] ?? '');
  const tool = String(invoke.attrs.tool ?? '');
  const apiVersion = String(invoke.attrs['api-version'] ?? '');
  const targetJid = String(stanza.attrs.to ?? '');
  const deadline = deadlineElement?.getText();
  if (
    !isOpaqueIdentifier(requestId) ||
    !isToolName(tool) ||
    !isApiVersion(apiVersion) ||
    !isNormalizedEndpointJid(targetJid) ||
    (deadline !== undefined && !isXep0082DateTime(deadline)) ||
    argumentsElement!.attrs['media-type'] !== JSON_MEDIA_TYPE
  ) {
    throw new Error('invoke is missing required attributes or JSON arguments');
  }
  return {
    requestId,
    tool,
    apiVersion,
    manifestHash: parseHash(invoke, 'manifest-hash').value,
    callerJid: bareJid(String(stanza.attrs.from ?? '')),
    notificationJid: String(stanza.attrs.from ?? ''),
    toJid: targetJid,
    arguments: parseStrictJson(argumentsElement!.getText()),
    deadline,
  };
}

export function parseTaskRecoveryRequest(
  stanza: Element,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): ParsedTaskRecoveryRequest | null {
  const state = stanza.getChild('task-state-request', namespaces.task);
  const result = stanza.getChild('task-result-request', namespaces.task);
  const payload = state ?? result;
  if (!payload) return null;
  assertIqRequest(stanza, payload, 'get');
  assertOnlyAttributes(payload, ['xmlns', 'task-id']);
  assertEmptyElement(payload);
  const taskId = String(payload.attrs['task-id'] ?? '');
  if (!isOpaqueId(taskId)) throw new Error('invalid task recovery identifier');
  return { kind: state ? 'state' : 'result', taskId };
}

export function parseTaskCancellation(
  stanza: Element,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): ParsedTaskCancellation | null {
  const cancel = stanza.getChild('cancel', namespaces.task);
  if (!cancel) return null;
  assertIqRequest(stanza, cancel, 'set');
  assertOnlyAttributes(cancel, ['xmlns', 'task-id', 'expected-revision']);
  const children = cancel.getChildElements();
  if (children.length > 1 || children.some((child) => child.name !== 'reason' || child.getNS() !== namespaces.task)) {
    throw new Error('cancel may contain only one reason');
  }
  if (cancel.children.some((child) => typeof child === 'string' && child.trim() !== '')) {
    throw new Error('cancel may not contain direct character data');
  }
  const reason = children[0];
  if (reason) {
    assertOnlyAttributes(reason, ['xmlns']);
    if (reason.getChildElements().length > 0) throw new Error('reason must contain character data only');
  }
  const taskId = String(cancel.attrs['task-id'] ?? '');
  const expectedRevision = parseNonNegativeInteger(cancel.attrs['expected-revision']);
  if (!isOpaqueId(taskId)) throw new Error('invalid cancellation identifier');
  return { taskId, expectedRevision, ...(reason ? { reason: reason.getText() } : {}) };
}

export function parseTaskInput(
  stanza: Element,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): ParsedTaskInput | null {
  const provide = stanza.getChild('provide-input', namespaces.task);
  if (!provide) return null;
  assertIqRequest(stanza, provide, 'set');
  assertOnlyAttributes(provide, ['xmlns', 'task-id', 'request-id', 'expected-revision']);
  const children = provide.getChildElements();
  if (
    children.length !== 1 ||
    children[0]!.name !== 'input' ||
    children[0]!.getNS() !== namespaces.task ||
    provide.children.some((child) => typeof child === 'string' && child.trim() !== '')
  ) {
    throw new Error('provide-input must contain exactly one input');
  }
  const input = children[0]!;
  assertOnlyAttributes(input, ['xmlns', 'media-type']);
  if (input.attrs['media-type'] !== JSON_MEDIA_TYPE || input.getChildElements().length > 0) {
    throw new Error('input must contain JSON character data');
  }
  const taskId = String(provide.attrs['task-id'] ?? '');
  const requestId = String(provide.attrs['request-id'] ?? '');
  const expectedRevision = parseNonNegativeInteger(provide.attrs['expected-revision']);
  if (!isOpaqueId(taskId) || !isOpaqueId(requestId)) throw new Error('invalid task input identifier');
  return { taskId, requestId, expectedRevision, input: parseStrictJson(input.getText()) };
}

export function buildTaskInvocation(
  task: AgentTaskRecord,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  return xml(
    'iq',
    {
      from: task.callerJid,
      to: task.targetJid,
      type: 'set',
      id: `invoke-${task.requestId}`,
    },
    xml(
      'invoke',
      {
        xmlns: namespaces.task,
        'request-id': task.requestId,
        tool: task.tool,
        'api-version': task.apiVersion,
      },
      xml('manifest-hash', {}, buildHash(task.manifestHash)),
      xml('arguments', { 'media-type': JSON_MEDIA_TYPE }, JSON.stringify(task.arguments)),
      ...(task.deadline ? [xml('deadline', {}, task.deadline)] : []),
    ),
  );
}

export function buildAcceptedResult(
  request: Element,
  accepted: AcceptedTask,
  from: string,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  return xml(
    'iq',
    { type: 'result', id: request.attrs.id, from, to: request.attrs.from },
    xml('accepted', {
      xmlns: namespaces.task,
      'request-id': accepted.requestId,
      'task-id': accepted.taskId,
      revision: String(accepted.revision),
      created: accepted.created,
      'retain-until': accepted.retainUntil,
    }),
  );
}

export function parseAcceptedResult(
  stanza: Element,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): AcceptedTask | null {
  if (stanza.name !== 'iq' || stanza.attrs.type !== 'result') return null;
  const accepted = stanza.getChild('accepted', namespaces.task);
  if (!accepted) return null;
  const revision = Number(accepted.attrs.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('accepted task has invalid revision');
  const parsed: AcceptedTask = {
    requestId: String(accepted.attrs['request-id'] ?? ''),
    taskId: String(accepted.attrs['task-id'] ?? ''),
    revision,
    created: String(accepted.attrs.created ?? ''),
    retainUntil: String(accepted.attrs['retain-until'] ?? ''),
  };
  if (
    !parsed.requestId ||
    !parsed.taskId ||
    !isXep0082DateTime(parsed.created) ||
    !isXep0082DateTime(parsed.retainUntil)
  ) {
    throw new Error('accepted task is missing required attributes');
  }
  if (!isOpaqueId(parsed.requestId) || !isOpaqueId(parsed.taskId)) {
    throw new Error('accepted task contains an invalid opaque identifier');
  }
  return parsed;
}

export function buildTaskStateResponse(
  request: Element,
  task: AgentTaskRecord,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  return xml(
    'iq',
    { type: 'result', id: request.attrs.id, from: task.targetJid, to: request.attrs.from },
    xml(
      'task-state',
      {
        xmlns: namespaces.task,
        'task-id': task.taskId,
        endpoint: task.targetJid,
        state: task.state,
        revision: String(task.revision),
        'api-version': task.apiVersion,
        created: task.createdAt,
        updated: task.updatedAt,
        'retain-until': task.retainUntil,
        'result-available': terminalTaskStates.has(task.state) ? 'true' : 'false',
        ...(task.deadline ? { deadline: task.deadline } : {}),
      },
      xml('manifest-hash', {}, xml('hash', { xmlns: namespaces.hashes, algo: 'sha-256' }, task.manifestHash)),
      ...(task.pendingInput
        ? [xml('pending-input', { 'media-type': JSON_MEDIA_TYPE }, JSON.stringify(task.pendingInput))]
        : []),
    ),
  );
}

export function buildTaskResultResponse(
  request: Element,
  task: AgentTaskRecord,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  const payload =
    task.state === 'completed'
      ? { result: task.result, ...(task.summary ? { summary: task.summary } : {}) }
      : task.state === 'failed'
        ? { error: task.error }
        : {};
  return xml(
    'iq',
    { type: 'result', id: request.attrs.id, from: task.targetJid, to: request.attrs.from },
    xml(
      'task-result',
      {
        xmlns: namespaces.task,
        'task-id': task.taskId,
        state: task.state,
        revision: String(task.revision),
        'media-type': JSON_MEDIA_TYPE,
      },
      JSON.stringify(payload),
    ),
  );
}

export function buildTaskStateRequest(task: AgentTaskRecord, remoteTaskId: string): Element {
  return xml(
    'iq',
    {
      from: task.callerJid,
      to: task.targetJid,
      type: 'get',
      id: `state-${task.taskId}-${task.revision}`,
    },
    xml('task-state-request', { xmlns: DEFAULT_PROTOCOL_NAMESPACES.task, 'task-id': remoteTaskId }),
  );
}

export function buildTaskResultRequest(task: AgentTaskRecord, remoteTaskId: string): Element {
  return xml(
    'iq',
    {
      from: task.callerJid,
      to: task.targetJid,
      type: 'get',
      id: `result-${task.taskId}-${task.revision}`,
    },
    xml('task-result-request', { xmlns: DEFAULT_PROTOCOL_NAMESPACES.task, 'task-id': remoteTaskId }),
  );
}

export function buildTaskCancellation(
  task: AgentTaskRecord,
  remoteTaskId: string,
  expectedRevision: number,
  reason?: string,
): Element {
  return xml(
    'iq',
    {
      from: task.callerJid,
      to: task.targetJid,
      type: 'set',
      id: `cancel-${task.taskId}-${expectedRevision}`,
    },
    xml(
      'cancel',
      {
        xmlns: DEFAULT_PROTOCOL_NAMESPACES.task,
        'task-id': remoteTaskId,
        'expected-revision': String(expectedRevision),
      },
      ...(reason !== undefined ? [xml('reason', {}, reason)] : []),
    ),
  );
}

export function buildTaskInput(
  task: AgentTaskRecord,
  remoteTaskId: string,
  requestId: string,
  expectedRevision: number,
  input: unknown,
): Element {
  return xml(
    'iq',
    {
      from: task.callerJid,
      to: task.targetJid,
      type: 'set',
      id: `input-${task.taskId}-${expectedRevision}`,
    },
    xml(
      'provide-input',
      {
        xmlns: DEFAULT_PROTOCOL_NAMESPACES.task,
        'task-id': remoteTaskId,
        'request-id': requestId,
        'expected-revision': String(expectedRevision),
      },
      xml('input', { 'media-type': JSON_MEDIA_TYPE }, JSON.stringify(input)),
    ),
  );
}

export function parseTaskActionResult(
  stanza: Element,
  name: 'cancel-accepted' | 'input-accepted',
): { taskId: string; revision: number } | null {
  if (stanza.name !== 'iq' || stanza.attrs.type !== 'result') return null;
  const accepted = stanza.getChild(name, DEFAULT_PROTOCOL_NAMESPACES.task);
  if (!accepted) return null;
  const taskId = String(accepted.attrs['task-id'] ?? '');
  const revision = Number(accepted.attrs.revision);
  if (!isOpaqueId(taskId) || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(`invalid ${name} result`);
  }
  return { taskId, revision };
}

export function parseTaskStateResult(stanza: Element): TaskStateSnapshot | null {
  if (stanza.name !== 'iq' || stanza.attrs.type !== 'result') return null;
  const state = stanza.getChild('task-state', DEFAULT_PROTOCOL_NAMESPACES.task);
  if (!state) return null;
  const taskState = String(state.attrs.state ?? '') as AgentTaskState;
  const taskId = String(state.attrs['task-id'] ?? '');
  const revision = Number(state.attrs.revision);
  const endpoint = String(state.attrs.endpoint ?? '');
  const apiVersion = String(state.attrs['api-version'] ?? '');
  const created = String(state.attrs.created ?? '');
  const updated = String(state.attrs.updated ?? '');
  const retainUntil = String(state.attrs['retain-until'] ?? '');
  if (
    !isOpaqueId(taskId) ||
    !taskStates.includes(taskState) ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !isNormalizedEndpointJid(endpoint) ||
    !isApiVersion(apiVersion) ||
    !isXep0082DateTime(created) ||
    !isXep0082DateTime(updated) ||
    !isXep0082DateTime(retainUntil) ||
    (state.attrs.deadline !== undefined && !isXep0082DateTime(String(state.attrs.deadline)))
  ) {
    throw new Error('invalid task-state result');
  }
  const pending = state.getChild('pending-input');
  if (pending && pending.attrs['media-type'] !== JSON_MEDIA_TYPE) {
    throw new Error('pending task input must use application/json');
  }
  return {
    taskId,
    endpoint,
    state: taskState,
    revision,
    apiVersion,
    manifestHash: parseHash(state, 'manifest-hash').value,
    created,
    updated,
    retainUntil,
    deadline: state.attrs.deadline ? String(state.attrs.deadline) : undefined,
    resultAvailable: state.attrs['result-available'] === 'true',
    pendingInput: pending ? (parseStrictJson(pending.getText()) as PendingTaskInput) : undefined,
  };
}

export function parseTaskResult(stanza: Element): TaskResultSnapshot | null {
  if (stanza.name !== 'iq' || stanza.attrs.type !== 'result') return null;
  const result = stanza.getChild('task-result', DEFAULT_PROTOCOL_NAMESPACES.task);
  if (!result) return null;
  const taskId = String(result.attrs['task-id'] ?? '');
  const state = String(result.attrs.state ?? '') as TaskResultSnapshot['state'];
  const revision = Number(result.attrs.revision);
  if (
    !isOpaqueId(taskId) ||
    !terminalTaskStates.has(state) ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    result.attrs['media-type'] !== JSON_MEDIA_TYPE
  ) {
    throw new Error('invalid task-result');
  }
  const payload = parseTaskPayload(result.getText() || '{}', 'invalid task-result payload');
  return {
    taskId,
    state,
    revision,
    result: payload.result as McpToolResult | undefined,
    error: payload.error as TaskResultSnapshot['error'],
    summary: typeof payload.summary === 'string' ? payload.summary : undefined,
  };
}

export function parseTaskEvent(
  stanza: Element,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): TaskWireEvent | null {
  if (stanza.name !== 'message') return null;
  const events = stanza.getChildren('event', namespaces.task);
  if (events.length === 0) return null;
  if (events.length !== 1) throw new Error('task event message must contain exactly one event');
  const messageType = String(stanza.attrs.type ?? 'normal');
  if (messageType !== 'normal') throw new Error('invalid task event message type');
  const event = events[0]!;
  assertOnlyAttributes(event, ['xmlns', 'task-id', 'event-id', 'revision', 'type']);
  if (event.getChildElements().length > 0) throw new Error('task event payload must contain character data only');
  const type = String(event.attrs.type ?? '') as AgentTaskEventType;
  if (!taskEventTypes.includes(type)) {
    throw new Error('unknown task event type');
  }
  const revision = Number(event.attrs.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('invalid task event revision');
  const taskId = String(event.attrs['task-id'] ?? '');
  const eventId = String(event.attrs['event-id'] ?? '');
  if (!isOpaqueId(taskId) || !isOpaqueId(eventId)) throw new Error('invalid task event identifier');
  return {
    taskId,
    eventId,
    revision,
    type,
    from: String(stanza.attrs.from ?? ''),
    to: String(stanza.attrs.to ?? ''),
    payload: parseTaskPayload(event.getText() || '{}', 'invalid task event payload'),
  };
}

export function buildTaskEvent(
  event: TaskWireEvent,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  return xml(
    'message',
    { from: event.from, to: event.to, type: 'normal', id: event.eventId },
    xml(
      'event',
      {
        xmlns: namespaces.task,
        'task-id': event.taskId,
        'event-id': event.eventId,
        revision: String(event.revision),
        type: event.type,
      },
      JSON.stringify(event.payload),
    ),
  );
}

export function isOpaqueId(value: string): boolean {
  return isOpaqueIdentifier(value);
}

function assertIqRequest(stanza: Element, payload: Element, type: 'get' | 'set'): void {
  if (
    stanza.name !== 'iq' ||
    stanza.attrs.type !== type ||
    stanza.getChildElements().length !== 1 ||
    stanza.getChildElements()[0] !== payload
  ) {
    throw new Error(`${payload.name} must be the only payload of an IQ ${type}`);
  }
}

function assertEmptyElement(element: Element): void {
  if (
    element.getChildElements().length > 0 ||
    element.children.some((child) => typeof child === 'string' && child.trim() !== '')
  ) {
    throw new Error(`${element.name} must be empty`);
  }
}

function parseNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^\+?\d+$/.test(value)) throw new Error('missing non-negative integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('invalid non-negative integer');
  return parsed;
}

function assertOnlyAttributes(element: Element, allowed: readonly string[]): void {
  const allowedNames = new Set(allowed);
  if (Object.keys(element.attrs).some((name) => !allowedNames.has(name))) {
    throw new Error(`${element.name} has unsupported attributes`);
  }
}

function parseTaskPayload(text: string, errorMessage: string): Record<string, unknown> {
  const value = parseStrictJson(text);
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error(errorMessage);
  return value as Record<string, unknown>;
}
