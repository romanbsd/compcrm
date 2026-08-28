import { xml, type Element } from '@xmpp/xml';

export type StanzaErrorCondition =
  | 'bad-request'
  | 'forbidden'
  | 'item-not-found'
  | 'not-acceptable'
  | 'conflict'
  | 'resource-constraint'
  | 'service-unavailable'
  | 'unexpected-request'
  | 'internal-server-error';

const STANZA_ERRORS_NS = 'urn:ietf:params:xml:ns:xmpp-stanzas';

export class ProtocolError extends Error {
  constructor(
    readonly condition: StanzaErrorCondition,
    message: string,
    readonly type: 'cancel' | 'modify' | 'auth' | 'wait' = stanzaErrorType(condition),
  ) {
    super(message);
  }
}

export function protocolErrorIq(request: Element, error: unknown): Element {
  const protocolError =
    error instanceof ProtocolError ? error : new ProtocolError('internal-server-error', 'Request processing failed');
  const echoRequestPayload =
    protocolError.condition !== 'bad-request' &&
    protocolError.condition !== 'resource-constraint' &&
    protocolError.condition !== 'internal-server-error';
  return xml(
    'iq',
    {
      type: 'error',
      id: request.attrs.id,
      from: request.attrs.to,
      to: request.attrs.from,
    },
    ...(echoRequestPayload ? request.children : []),
    xml(
      'error',
      { type: protocolError.type },
      xml(protocolError.condition, { xmlns: STANZA_ERRORS_NS }),
      xml('text', { xmlns: STANZA_ERRORS_NS }, safeMessage(protocolError)),
    ),
  );
}

export function hiddenObjectError(): ProtocolError {
  return new ProtocolError('item-not-found', 'The requested object was not found');
}

function safeMessage(error: ProtocolError): string {
  if (error.condition === 'item-not-found') return 'The requested object was not found';
  if (error.condition === 'internal-server-error') return 'Request processing failed';
  return error.message.slice(0, 512);
}

function stanzaErrorType(condition: StanzaErrorCondition): 'cancel' | 'modify' | 'auth' | 'wait' {
  if (condition === 'bad-request' || condition === 'not-acceptable') return 'modify';
  if (condition === 'forbidden') return 'auth';
  if (condition === 'resource-constraint' || condition === 'service-unavailable') return 'wait';
  return 'cancel';
}
