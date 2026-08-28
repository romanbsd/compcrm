/**
 * Virtual-agent presence for an XEP-0114 component.
 *
 * Openfire cannot publish presence for virtual JIDs because they are not C2S
 * accounts. The component therefore completes roster subscriptions and
 * answers server probes itself.
 *
 * State mapping (RFC 6121):
 *   subscribe   -> subscribed + available   (§3.1.4 approving an inbound request)
 *   probe / ''  -> available                (§4.3 responding to a presence probe)
 *   unsubscribe -> unsubscribed             (§3.3.2 canceling a subscription)
 *
 * @see https://www.rfc-editor.org/rfc/rfc6121#section-3
 */
import { xml, type Element } from '@xmpp/xml';

import { bareJid } from './jid.js';

export interface VirtualAgentIdentity {
  jid: string;
  name: string;
}

export interface PresenceSubscriptionChange {
  subscriberJid: string;
  subscribed: boolean;
}

export interface VirtualAgentPresenceResult {
  responses: Element[];
  subscriptionChange?: PresenceSubscriptionChange;
}

export const VIRTUAL_AGENT_RESOURCE = 'gateway';

export function virtualAgentPresenceJid(agent: VirtualAgentIdentity): string {
  return `${bareJid(agent.jid)}/${VIRTUAL_AGENT_RESOURCE}`;
}

export function buildAvailablePresence(agent: VirtualAgentIdentity, to: string): Element {
  return xml(
    'presence',
    { from: virtualAgentPresenceJid(agent), to },
    xml('show', {}, 'chat'),
    xml('status', {}, `${agent.name} is available`),
  );
}

export function buildUnavailablePresence(agent: VirtualAgentIdentity, to: string): Element {
  return xml('presence', {
    type: 'unavailable',
    from: virtualAgentPresenceJid(agent),
    to,
  });
}

export function buildSubscriptionAccepted(agent: VirtualAgentIdentity, to: string): Element {
  return xml('presence', { type: 'subscribed', from: bareJid(agent.jid), to });
}

export function buildSubscriptionRemoved(agent: VirtualAgentIdentity, to: string): Element {
  return xml('presence', { type: 'unsubscribed', from: bareJid(agent.jid), to });
}

export function handleVirtualAgentPresence(stanza: Element, agent: VirtualAgentIdentity): VirtualAgentPresenceResult {
  if (stanza.name !== 'presence') return { responses: [] };
  const to = String(stanza.attrs.from ?? '');
  if (!to) return { responses: [] };
  const type = String(stanza.attrs.type ?? '');
  const subscriberJid = bareJid(to);
  if (type === 'subscribe') {
    return {
      responses: [buildSubscriptionAccepted(agent, to), buildAvailablePresence(agent, to)],
      subscriptionChange: { subscriberJid, subscribed: true },
    };
  }
  if (type === 'probe') {
    return {
      responses: [buildAvailablePresence(agent, to)],
      subscriptionChange: { subscriberJid, subscribed: true },
    };
  }
  if (type === '') return { responses: [buildAvailablePresence(agent, to)] };
  if (type === 'unsubscribe') {
    return {
      responses: [buildSubscriptionRemoved(agent, to)],
      subscriptionChange: { subscriberJid, subscribed: false },
    };
  }
  return { responses: [] };
}
