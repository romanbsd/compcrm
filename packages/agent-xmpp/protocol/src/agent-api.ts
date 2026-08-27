import type { AGENT_API_NS } from './namespaces.js';

export type JsonSchema = Record<string, unknown>;

/** MCP Tool annotations are preserved exactly; absence is distinct from false. */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: McpToolAnnotations;
  execution?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  [extension: `${string}:${string}`]: unknown;
}

export interface XmppToolExtension {
  supportsProgress?: boolean;
  supportsCancellation?: boolean;
  supportsInput?: boolean;
  defaultTimeoutSeconds?: number;
  maximumTimeoutSeconds?: number;
  requiredPermissions?: string[];
  approvalRequired?: boolean;
  tags?: string[];
}

export interface AgentApiManifest {
  manifestSpecVersion: '0';
  agent: {
    jid: string;
    name: string;
    title?: string;
    description?: string;
    version: string;
    vendor?: string;
    homepage?: string;
    /** Public avatar URI served via XEP-0054 PHOTO/EXTVAL. */
    avatarUrl?: string;
  };
  implementation?: { name: string; version: string };
  mcpProtocolVersion?: string;
  tools: McpTool[];
}

export interface RegisteredTool extends McpTool {
  inputSchemaHash: string;
  outputSchemaHash?: string;
  xmpp?: XmppToolExtension;
}

export interface RegisteredAgent {
  manifest: AgentApiManifest;
  manifestHash: string;
  canonicalManifest: string;
  tools: RegisteredTool[];
  tenantId: string;
  active: boolean;
  registeredAt: string;
}

export interface VirtualMcpEndpoint {
  endpointId: string;
  manifestSpecVersion: AgentApiManifest['manifestSpecVersion'];
  implementation?: AgentApiManifest['implementation'];
  mcpProtocolVersion?: AgentApiManifest['mcpProtocolVersion'];
  server: {
    name: string;
    title?: string;
    description?: string;
    version: string;
  };
  xmpp: {
    jid: string;
    toolsNode: string;
    features: string[];
  };
  authorization: { visible: boolean; invocable: boolean };
  tools: RegisteredTool[];
}

export const XMPP_TOOL_EXTENSION_KEY: typeof AGENT_API_NS = 'urn:xmpp:agent-api:0';
