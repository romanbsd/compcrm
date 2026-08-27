import {
  AGENT_API_NS,
  AGENT_DIRECTORY_NS,
  AGENT_ENDPOINT_NS,
  AGENT_TASK_NS,
  AGENT_TOOL_NS,
  DEFAULT_PROTOCOL_NAMESPACES,
  JSON_MEDIA_TYPE,
  JSON_SCHEMA_MEDIA_TYPE,
  isApiVersion,
  isToolName,
  type AgentApiManifest,
  type AgentXmppNamespaces,
  type RegisteredAgent,
  type RegisteredTool,
  parseStrictJson,
} from '@agent-xmpp/protocol';
import { canonicalJson, validateManifest } from '@agent-xmpp/core';
import { xml, type Element } from '@xmpp/xml';

import { buildHash, parseHash } from './hash-codec.js';
import { ProtocolError } from './protocol-error.js';
import { buildRsm, pageRsm, parseRsm } from './rsm-codec.js';
import { VCARD_TEMP_NS } from './xep-plugins/vcard.js';

export const DISCO_INFO_NS = 'http://jabber.org/protocol/disco#info';
export const DISCO_ITEMS_NS = 'http://jabber.org/protocol/disco#items';
export const DATA_FORMS_NS = 'jabber:x:data';
export const SEARCH_NS = 'jabber:iq:search';
export { AGENT_DIRECTORY_NS, AGENT_API_NS, AGENT_TOOL_NS, AGENT_ENDPOINT_NS, AGENT_TASK_NS };

export interface ManifestRequest {
  version?: string;
}

export interface SchemaRequest {
  tool: string;
  version: string;
  direction: 'input' | 'output';
  manifestHash: string;
}

interface PayloadShape {
  requiredAttributes?: readonly string[];
  optionalAttributes?: readonly string[];
  children?: readonly { name: string; xmlns?: string }[];
}

function assertPayloadShape(payload: Element, shape: PayloadShape): void {
  const required = shape.requiredAttributes ?? [];
  const allowed = new Set(['xmlns', ...required, ...(shape.optionalAttributes ?? [])]);
  if (
    required.some((name) => payload.attrs[name] === undefined || payload.attrs[name] === '') ||
    Object.keys(payload.attrs).some((name) => !allowed.has(name))
  ) {
    throw new Error(`${payload.name} has invalid attributes`);
  }

  const expectedChildren = shape.children ?? [];
  const actualChildren = payload.getChildElements();
  if (
    payload.children.some((child) => typeof child === 'string' && child.trim() !== '') ||
    actualChildren.length !== expectedChildren.length ||
    actualChildren.some(
      (child, index) =>
        child.name !== expectedChildren[index]!.name ||
        (expectedChildren[index]!.xmlns !== undefined && child.attrs.xmlns !== expectedChildren[index]!.xmlns),
    )
  ) {
    throw new Error(`${payload.name} has invalid children`);
  }
}

function requestPayload(
  request: Element,
  name: string,
  namespace: string,
  expectedIqType: 'get' | 'set',
): Element | null {
  if (request.name !== 'iq') return null;
  const payload = request.getChild(name, namespace);
  if (!payload) return null;
  if (request.attrs.type !== expectedIqType) throw new Error(`${name} requires an IQ of type ${expectedIqType}`);
  return payload;
}

export function parseManifestRequest(
  request: Element,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): ManifestRequest | null {
  const payload = requestPayload(request, 'manifest-request', namespaces.api, 'get');
  if (!payload) return null;
  assertPayloadShape(payload, { optionalAttributes: ['version'] });
  const version = payload.attrs.version === undefined ? undefined : String(payload.attrs.version);
  if (version !== undefined && !isApiVersion(version)) throw new Error('manifest-request has an invalid version');
  return version === undefined ? {} : { version };
}

export function parseSchemaRequest(
  request: Element,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): SchemaRequest | null {
  const payload = requestPayload(request, 'schema-request', namespaces.api, 'get');
  if (!payload) return null;
  assertPayloadShape(payload, {
    requiredAttributes: ['tool', 'version', 'direction'],
    children: [{ name: 'hash', xmlns: namespaces.hashes }],
  });
  const tool = String(payload.attrs.tool);
  const version = String(payload.attrs.version);
  const direction = String(payload.attrs.direction);
  if (!isToolName(tool) || !isApiVersion(version) || (direction !== 'input' && direction !== 'output')) {
    throw new Error('schema-request has invalid attributes');
  }
  return {
    tool,
    version,
    direction,
    manifestHash: parseHash(payload).value,
  };
}

function resultIq(request: Element, from: string, child: Element): Element {
  return xml('iq', { type: 'result', id: request.attrs.id, from, to: request.attrs.from }, child);
}

function field(name: string, value: string, type?: string): Element {
  return xml('field', { var: name, ...(type ? { type } : {}) }, xml('value', {}, value));
}

function resultForm(formType: string, fields: Element[]): Element {
  return xml('x', { xmlns: DATA_FORMS_NS, type: 'result' }, field('FORM_TYPE', formType, 'hidden'), ...fields);
}

function features(...values: string[]): Element[] {
  return values.map((value) => xml('feature', { var: value }));
}

const HUMAN_FEATURES = [
  'urn:xmpp:ping',
  'urn:xmpp:receipts',
  'http://jabber.org/protocol/chatstates',
  'urn:xmpp:reply:0',
  'urn:xmpp:sid:0',
  'urn:xmpp:hints',
];

export function buildGatewayInfo(
  request: Element,
  componentJid: string,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  return resultIq(
    request,
    componentJid,
    xml(
      'query',
      { xmlns: DISCO_INFO_NS },
      xml('identity', { category: 'automation', type: 'agent-gateway', name: 'NanoClaw XMPP Agent Gateway' }),
      ...features(
        DISCO_INFO_NS,
        DISCO_ITEMS_NS,
        SEARCH_NS,
        DATA_FORMS_NS,
        namespaces.directory,
        namespaces.admin,
        ...HUMAN_FEATURES,
      ),
    ),
  );
}

export function buildDirectoryInfo(request: Element, componentJid: string): Element {
  return resultIq(
    request,
    componentJid,
    xml(
      'query',
      { xmlns: DISCO_INFO_NS, node: AGENT_DIRECTORY_NS },
      xml('identity', { category: 'automation', type: 'agent-directory', name: 'NanoClaw Agent Directory' }),
      ...features(DISCO_INFO_NS, DISCO_ITEMS_NS),
    ),
  );
}

export function buildAgentDirectory(
  request: Element,
  componentJid: string,
  agents: RegisteredAgent[],
  _namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  const query = request.getChild('query', DISCO_ITEMS_NS)!;
  const page = pageRsm(agents, (agent) => agent.manifest.agent.jid, parseRsm(query));
  return resultIq(
    request,
    componentJid,
    xml(
      'query',
      { xmlns: DISCO_ITEMS_NS, ...(query.attrs.node ? { node: query.attrs.node } : {}) },
      ...page.items.map((agent) =>
        xml('item', {
          jid: agent.manifest.agent.jid,
          name: agent.manifest.agent.title ?? agent.manifest.agent.name,
        }),
      ),
      buildRsm(page),
    ),
  );
}

export function buildAgentInfo(
  request: Element,
  agent: RegisteredAgent,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  const identity = agent.manifest.agent;
  const taskFeatures = new Set<string>([namespaces.task]);
  for (const tool of agent.tools) {
    if (tool.xmpp?.supportsProgress) taskFeatures.add(namespaces.progress);
    if (tool.xmpp?.supportsCancellation) taskFeatures.add(namespaces.cancel);
    if (tool.xmpp?.supportsInput) taskFeatures.add(namespaces.input);
  }
  return resultIq(
    request,
    identity.jid,
    xml(
      'query',
      { xmlns: DISCO_INFO_NS },
      xml('identity', { category: 'automation', type: 'agent-endpoint', name: identity.title ?? identity.name }),
      ...features(
        DISCO_INFO_NS,
        DISCO_ITEMS_NS,
        namespaces.endpoint,
        namespaces.manifest,
        namespaces.schema,
        ...taskFeatures,
        VCARD_TEMP_NS,
        ...HUMAN_FEATURES,
      ),
      resultForm(namespaces.endpointInfo, [
        field('server_name', identity.name),
        field('server_title', identity.title ?? identity.name),
        ...(identity.description ? [field('description', identity.description)] : []),
        field('version', identity.version),
        field('manifest_hash_algo', 'sha-256'),
        field('manifest_hash_value', agent.manifestHash),
        field('cold_start_supported', '1'),
        field('request_replay_seconds', '86400'),
      ]),
    ),
  );
}

export function buildToolItems(
  request: Element,
  agent: RegisteredAgent,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  const query = request.getChild('query', DISCO_ITEMS_NS)!;
  const page = pageRsm(
    agent.tools,
    (tool) => toolNode(agent.manifest.agent.version, tool.name, namespaces),
    parseRsm(query),
    (tool) => tool.name,
  );
  return resultIq(
    request,
    agent.manifest.agent.jid,
    xml(
      'query',
      { xmlns: DISCO_ITEMS_NS, node: toolsNode(agent.manifest.agent.version, namespaces) },
      ...page.items.map((tool) =>
        xml('item', {
          jid: agent.manifest.agent.jid,
          node: toolNode(agent.manifest.agent.version, tool.name, namespaces),
          name: tool.title ?? tool.name,
        }),
      ),
      buildRsm(page),
    ),
  );
}

export function buildToolCollectionInfo(
  request: Element,
  agent: RegisteredAgent,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  return resultIq(
    request,
    agent.manifest.agent.jid,
    xml(
      'query',
      { xmlns: DISCO_INFO_NS, node: toolsNode(agent.manifest.agent.version, namespaces) },
      xml('identity', { category: 'automation', type: 'agent-tool-collection' }),
      ...features(DISCO_INFO_NS, DISCO_ITEMS_NS),
    ),
  );
}

export function buildToolInfo(
  request: Element,
  agent: RegisteredAgent,
  tool: RegisteredTool,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  const taskFeatures: string[] = [namespaces.task];
  if (tool.xmpp?.supportsProgress) taskFeatures.push(namespaces.progress);
  if (tool.xmpp?.supportsCancellation) taskFeatures.push(namespaces.cancel);
  if (tool.xmpp?.supportsInput) taskFeatures.push(namespaces.input);
  const optionalBoolean = (name: string, value: boolean | undefined): Element[] =>
    value === undefined ? [] : [field(name, value ? '1' : '0')];
  return resultIq(
    request,
    agent.manifest.agent.jid,
    xml(
      'query',
      {
        xmlns: DISCO_INFO_NS,
        node: toolNode(agent.manifest.agent.version, tool.name, namespaces),
      },
      xml('identity', { category: 'automation', type: 'agent-tool', name: tool.title ?? tool.name }),
      ...features(DISCO_INFO_NS, namespaces.tool, ...taskFeatures),
      resultForm(namespaces.toolInfo, [
        field('name', tool.name),
        ...(tool.title ? [field('title', tool.title)] : []),
        ...(tool.description ? [field('description', tool.description)] : []),
        field('api_version', agent.manifest.agent.version),
        field('input_schema_hash_algo', 'sha-256'),
        field('input_schema_hash_value', tool.inputSchemaHash),
        ...(tool.outputSchemaHash
          ? [field('output_schema_hash_algo', 'sha-256'), field('output_schema_hash_value', tool.outputSchemaHash)]
          : []),
        ...optionalBoolean('read_only', tool.annotations?.readOnlyHint),
        ...optionalBoolean('destructive', tool.annotations?.destructiveHint),
        ...optionalBoolean('idempotent', tool.annotations?.idempotentHint),
        ...optionalBoolean('open_world', tool.annotations?.openWorldHint),
      ]),
    ),
  );
}

export function buildSchemaResult(
  request: Element,
  agent: RegisteredAgent,
  tool: RegisteredTool,
  direction: 'input' | 'output',
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  const schema = direction === 'input' ? tool.inputSchema : tool.outputSchema;
  const schemaHash = direction === 'input' ? tool.inputSchemaHash : tool.outputSchemaHash;
  if (!schema || !schemaHash) throw new Error('schema not found');
  const canonicalSchema = canonicalJson(schema);
  return resultIq(
    request,
    agent.manifest.agent.jid,
    xml(
      'schema',
      {
        xmlns: namespaces.api,
        tool: tool.name,
        version: agent.manifest.agent.version,
        direction,
        'media-type': JSON_SCHEMA_MEDIA_TYPE,
      },
      xml('manifest-hash', {}, buildHash(agent.manifestHash)),
      xml('schema-hash', {}, buildHash(schemaHash)),
      xml('json', {}, canonicalSchema),
    ),
  );
}

export function buildManifestResult(
  request: Element,
  agent: RegisteredAgent,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  return resultIq(
    request,
    agent.manifest.agent.jid,
    xml(
      'manifest',
      { xmlns: namespaces.api, version: agent.manifest.agent.version, 'media-type': JSON_MEDIA_TYPE },
      buildHash(agent.manifestHash),
      xml('json', {}, agent.canonicalManifest),
    ),
  );
}

export function toolsNode(version: string, namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES): string {
  if (!isApiVersion(version)) throw new Error('invalid API version');
  return `${namespaces.tools}#${version}`;
}

export function toolsVersionFromNode(
  node: string,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): string | null {
  const prefix = `${namespaces.tools}#`;
  if (!node.startsWith(prefix)) return null;
  const version = node.slice(prefix.length);
  return isApiVersion(version) ? version : null;
}

export function toolNode(
  version: string,
  name: string,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): string {
  if (!isApiVersion(version)) throw new Error('invalid API version');
  if (!isToolName(name)) throw new Error('invalid tool name');
  return `${namespaces.tool}#${version}#${Buffer.from(name, 'utf8').toString('base64url')}`;
}

export function toolFromNode(
  node: string,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): { version: string; name: string } | null {
  const prefix = `${namespaces.tool}#`;
  if (!node.startsWith(prefix)) return null;
  const separator = node.indexOf('#', prefix.length);
  if (separator < 0) return null;
  const version = node.slice(prefix.length, separator);
  const encoded = node.slice(separator + 1);
  if (!isApiVersion(version) || !encoded || encoded.includes('=') || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) return null;
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!isToolName(name)) return null;
    return { version, name };
  } catch {
    return null;
  }
}

export function parseManifestRegistration(
  request: Element,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): AgentApiManifest | null {
  if (request.name !== 'iq' || request.attrs.type !== 'set') return null;
  const manifest = request.getChild('register', namespaces.api)?.getChild('manifest', namespaces.api);
  if (!manifest || manifest.attrs['media-type'] !== JSON_MEDIA_TYPE) return null;
  try {
    return validateManifest(parseStrictJson(manifest.getText(), { maxBytes: 1_048_576 }));
  } catch (error) {
    throw new ProtocolError('bad-request', error instanceof Error ? error.message : 'Invalid manifest');
  }
}

export function buildManifestRegistrationResult(
  request: Element,
  agent: RegisteredAgent,
  namespaces: AgentXmppNamespaces = DEFAULT_PROTOCOL_NAMESPACES,
): Element {
  return resultIq(
    request,
    request.attrs.to ? String(request.attrs.to) : agent.manifest.agent.jid,
    xml(
      'registered',
      { xmlns: namespaces.api, jid: agent.manifest.agent.jid, version: agent.manifest.agent.version },
      buildHash(agent.manifestHash),
    ),
  );
}
