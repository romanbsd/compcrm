/** ProtoXEP XMPP Agent Gateway 0.0.3 protocol constants. */
export interface AgentXmppNamespaces {
  directory: typeof AGENT_DIRECTORY_NS;
  api: typeof AGENT_API_NS;
  manifest: typeof AGENT_MANIFEST_FEATURE;
  schema: typeof AGENT_SCHEMA_FEATURE;
  selfRegister: typeof AGENT_SELF_REGISTER_FEATURE;
  admin: typeof AGENT_ADMIN_FEATURE;
  tools: typeof AGENT_TOOLS_NS;
  tool: typeof AGENT_TOOL_NS;
  endpoint: typeof AGENT_ENDPOINT_NS;
  endpointInfo: typeof AGENT_ENDPOINT_INFO_FORM;
  toolInfo: typeof AGENT_TOOL_INFO_FORM;
  task: typeof AGENT_TASK_NS;
  progress: typeof AGENT_TASK_PROGRESS_FEATURE;
  cancel: typeof AGENT_TASK_CANCEL_FEATURE;
  input: typeof AGENT_TASK_INPUT_FEATURE;
  hashes: typeof HASHES_NS;
  rsm: typeof RSM_NS;
}

export const AGENT_DIRECTORY_NS = 'urn:xmpp:agent-directory:0';
export const AGENT_API_NS = 'urn:xmpp:agent-api:0';
export const AGENT_MANIFEST_FEATURE = `${AGENT_API_NS}#manifest` as const;
export const AGENT_SCHEMA_FEATURE = `${AGENT_API_NS}#schema` as const;
export const AGENT_SELF_REGISTER_FEATURE = `${AGENT_API_NS}#self-register` as const;
export const AGENT_ADMIN_FEATURE = `${AGENT_API_NS}#admin` as const;
export const AGENT_TOOLS_NS = 'urn:xmpp:agent-tools:0';
export const AGENT_TOOL_NS = 'urn:xmpp:agent-tool:0';
export const AGENT_ENDPOINT_NS = 'urn:xmpp:agent-endpoint:0';
export const AGENT_ENDPOINT_INFO_FORM = 'urn:xmpp:agent-endpoint-info:0';
export const AGENT_TOOL_INFO_FORM = 'urn:xmpp:agent-tool-info:0';
export const AGENT_TASK_NS = 'urn:xmpp:agent-task:0';
export const AGENT_TASK_PROGRESS_FEATURE = `${AGENT_TASK_NS}#progress` as const;
export const AGENT_TASK_CANCEL_FEATURE = `${AGENT_TASK_NS}#cancel` as const;
export const AGENT_TASK_INPUT_FEATURE = `${AGENT_TASK_NS}#input` as const;
export const HASHES_NS = 'urn:xmpp:hashes:2';
export const RSM_NS = 'http://jabber.org/protocol/rsm';

export const DEFAULT_PROTOCOL_NAMESPACES: Readonly<AgentXmppNamespaces> = Object.freeze({
  directory: AGENT_DIRECTORY_NS,
  api: AGENT_API_NS,
  manifest: AGENT_MANIFEST_FEATURE,
  schema: AGENT_SCHEMA_FEATURE,
  selfRegister: AGENT_SELF_REGISTER_FEATURE,
  admin: AGENT_ADMIN_FEATURE,
  tools: AGENT_TOOLS_NS,
  tool: AGENT_TOOL_NS,
  endpoint: AGENT_ENDPOINT_NS,
  endpointInfo: AGENT_ENDPOINT_INFO_FORM,
  toolInfo: AGENT_TOOL_INFO_FORM,
  task: AGENT_TASK_NS,
  progress: AGENT_TASK_PROGRESS_FEATURE,
  cancel: AGENT_TASK_CANCEL_FEATURE,
  input: AGENT_TASK_INPUT_FEATURE,
  hashes: HASHES_NS,
  rsm: RSM_NS,
});

export const AGENT_MANIFEST_SPEC_VERSION = '0';
export const AGENT_API_SPEC_VERSION = AGENT_MANIFEST_SPEC_VERSION;
export const JSON_MEDIA_TYPE = 'application/json';
export const JSON_SCHEMA_MEDIA_TYPE = 'application/schema+json';
