export const taskStates = [
  'accepted',
  'running',
  'input_required',
  'cancelling',
  'cancelled',
  'failed',
  'completed',
] as const;
export type AgentTaskState = (typeof taskStates)[number];

export const terminalTaskStates = new Set<AgentTaskState>(['cancelled', 'failed', 'completed']);

export interface AgentTaskError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface PendingTaskInput {
  requestId: string;
  question: string;
  inputSchema: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
}

export interface AgentTaskRecord {
  taskId: string;
  requestId: string;
  callerJid: string;
  notificationJid: string;
  targetJid: string;
  tenantId: string;
  tool: string;
  apiVersion: string;
  manifestHash: string;
  arguments: unknown;
  state: AgentTaskState;
  revision: number;
  fingerprint: string;
  callerSessionId?: string;
  createdAt: string;
  updatedAt: string;
  deadline?: string;
  retainUntil: string;
  result?: McpToolResult;
  error?: AgentTaskError;
  summary?: string;
  pendingInput?: PendingTaskInput;
}

export const taskEventTypes = ['status', 'progress', 'input_required', 'completed', 'failed', 'cancelled'] as const;
export type AgentTaskEventType = (typeof taskEventTypes)[number];

export interface AgentTaskEvent {
  taskId: string;
  eventId: string;
  revision: number;
  type: AgentTaskEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}
