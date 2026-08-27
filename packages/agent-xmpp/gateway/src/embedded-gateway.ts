import {
  DEFAULT_PROTOCOL_NAMESPACES,
  bareJid,
  type AgentXmppNamespaces,
  type OutboundDeliverRequest,
} from '@agent-xmpp/protocol';
import { xml, type Element } from '@xmpp/xml';

import { buildGatewayInfo, DISCO_INFO_NS } from './agent-api-disco.js';
import type { GatewayConfig } from './config.js';
export { loadConfig } from './config.js';
export type { GatewayConfig } from './config.js';
import { sendComposingForAgent, sendInactiveForAgent, sendPausedForAgent } from './agent-send.js';
import { StanzaRouter, type ResolveVirtualAgentFn } from './stanza-router.js';
import type { GatewayRuntimeMailbox } from './runtime-mailbox.js';
import { applyStoreHints, buildOutboundStanza } from './xep-plugins/message.js';
import { isMucJid } from './xep-plugins/muc.js';
import { buildTaskEvent, type TaskWireEvent } from './task-stanza-codec.js';
import {
  createComponentSession,
  type IqGetHandler,
  type IqRequestOptions,
  type XmppComponentSession,
} from './xmpp-component.js';
import { RECEIPTS_NS } from './xep-plugins/receipts.js';
import { ReceiptTracker } from './receipt-tracker.js';
import { PING_NS } from './xep-plugins/ping.js';
import { XmppKeepalive } from './xmpp-keepalive.js';
import { buildAvailablePresence, buildUnavailablePresence, type VirtualAgentIdentity } from './xep-plugins/presence.js';

export interface EmbeddedIqHandlerOptions {
  componentJid: string;
  protocolNamespaces?: AgentXmppNamespaces;
}

export interface PresenceSubscription {
  agentJid: string;
  subscriberJid: string;
}

export interface PresenceSubscriptionStore {
  listPresenceSubscriptions(): PresenceSubscription[];
  setPresenceSubscription(agentJid: string, subscriberJid: string, subscribed: boolean): void;
}

export type XmppComponentSessionFactory = (config: GatewayConfig, onIqGet?: IqGetHandler) => XmppComponentSession;

export interface EmbeddedXmppGatewayDependencies {
  onIqGet?: IqGetHandler;
  resolveVirtualAgent?: ResolveVirtualAgentFn;
  presenceStore?: PresenceSubscriptionStore;
  componentSessionFactory?: XmppComponentSessionFactory;
}

function presenceRouteKey(route: PresenceSubscription): string {
  return `${bareJid(route.agentJid).toLowerCase()}\u0000${bareJid(route.subscriberJid).toLowerCase()}`;
}

class InMemoryPresenceSubscriptionStore implements PresenceSubscriptionStore {
  private readonly subscriptions = new Map<string, PresenceSubscription>();

  listPresenceSubscriptions(): PresenceSubscription[] {
    return [...this.subscriptions.values()];
  }

  setPresenceSubscription(agentJid: string, subscriberJid: string, subscribed: boolean): void {
    const route = { agentJid: bareJid(agentJid), subscriberJid: bareJid(subscriberJid) };
    const key = presenceRouteKey(route);
    if (subscribed) this.subscriptions.set(key, route);
    else this.subscriptions.delete(key);
  }
}

/**
 * Root service identity belongs to the reusable gateway itself. Host handlers
 * extend this surface with directory, endpoint, task, and administrative IQs.
 */
export function createEmbeddedIqHandler(options: EmbeddedIqHandlerOptions, downstream?: IqGetHandler): IqGetHandler {
  return async (stanza) => {
    const to = bareJid(String(stanza.attrs.to ?? ''));
    const info = stanza.getChild('query', DISCO_INFO_NS);
    if (stanza.attrs.type === 'get' && to === bareJid(options.componentJid) && info && !info.attrs.node) {
      return buildGatewayInfo(stanza, options.componentJid, options.protocolNamespaces ?? DEFAULT_PROTOCOL_NAMESPACES);
    }
    return (await downstream?.(stanza)) ?? null;
  };
}

/** In-process XMPP channel runtime. All agent IO crosses GatewayRuntimeMailbox. */
export class EmbeddedXmppGateway {
  private session: XmppComponentSession | null = null;
  private router: StanzaRouter | null = null;
  private readonly receipts: ReceiptTracker;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private keepalive: XmppKeepalive | null = null;
  private connectionState: ReturnType<XmppComponentSession['getState']> = 'offline';
  private readonly presenceStore: PresenceSubscriptionStore;
  private readonly publishedPresence = new Map<string, { agent: VirtualAgentIdentity; subscriberJid: string }>();
  private presenceSync: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: GatewayConfig,
    private readonly mailbox: GatewayRuntimeMailbox,
    private readonly dependencies: EmbeddedXmppGatewayDependencies = {},
  ) {
    this.presenceStore = dependencies.presenceStore ?? new InMemoryPresenceSubscriptionStore();
    this.receipts = new ReceiptTracker({
      timeoutMs: config.receiptTimeoutMs,
      maxResends: config.receiptMaxResends,
    });
  }

  async start(): Promise<void> {
    if (this.session) return;
    const createSession = this.dependencies.componentSessionFactory ?? createComponentSession;
    const session = createSession(this.config, createEmbeddedIqHandler(this.config, this.dependencies.onIqGet));
    const sendForAgent = async (_agentJid: string, stanza: Element) => session.send(stanza);
    const router = new StanzaRouter(
      this.config,
      this.mailbox,
      sendForAgent,
      this.dependencies.resolveVirtualAgent,
      (id) => this.receipts.ack(id),
      (agent, subscriberJid, subscribed) => this.updatePresenceSubscription(agent, subscriberJid, subscribed),
    );
    session.onStanza((stanza) => void router.handleIncoming(stanza));
    session.onStateChange((state) => {
      const wasOnline = this.connectionState === 'online';
      this.connectionState = state;
      if (state === 'online' && !wasOnline) {
        this.publishedPresence.clear();
        void this.syncPresence(session);
      }
    });
    this.session = session;
    this.router = router;
    await session.start();
    this.connectionState = session.getState();
    this.keepalive = new XmppKeepalive(
      { intervalMs: this.config.pingIntervalMs, failureThreshold: this.config.pingFailureThreshold },
      {
        getState: () => session.getState(),
        getLastActivityAt: () => session.getLastActivityAt(),
        ping: async () => {
          await session.requestIq(
            xml(
              'iq',
              { type: 'get', from: this.config.componentJid, to: this.config.serverDomain },
              xml('ping', { xmlns: PING_NS }),
            ),
            { timeoutMs: this.config.pingTimeoutMs },
          );
        },
        forceReconnect: (reason) => session.forceReconnect(reason),
      },
    );
    this.keepalive.start();
    this.sweepTimer = setInterval(() => this.resendUnacked(), this.config.receiptSweepMs);
    this.sweepTimer.unref?.();
  }

  async stop(): Promise<void> {
    const session = this.session;
    this.connectionState = 'stopping';
    if (session) await this.publishUnavailablePresence(session);
    this.session = null;
    this.router = null;
    this.keepalive?.stop();
    this.keepalive = null;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    // Drop pending receipts so a restart's sweep can't resend this session's stanzas.
    this.receipts.clear();
    if (session) await session.stop();
    this.publishedPresence.clear();
    this.connectionState = 'offline';
  }

  private updatePresenceSubscription(agent: VirtualAgentIdentity, subscriberJid: string, subscribed: boolean): void {
    const route = {
      agentJid: bareJid(agent.jid),
      subscriberJid: bareJid(subscriberJid),
    };
    this.presenceStore.setPresenceSubscription(route.agentJid, route.subscriberJid, subscribed);
    void this.syncPresence();
  }

  syncPresence(session = this.session): Promise<void> {
    if (!session || session.getState() !== 'online') return Promise.resolve();
    const run = this.presenceSync
      .catch(() => undefined)
      .then(() => this.reconcilePresence(session))
      .catch((err) => {
        console.error('[xmpp-gateway] presence synchronization failed:', err);
      });
    this.presenceSync = run;
    return run;
  }

  private async reconcilePresence(session: XmppComponentSession): Promise<void> {
    const desired = new Map<string, { agent: VirtualAgentIdentity; subscriberJid: string }>();
    for (const subscription of this.presenceStore.listPresenceSubscriptions()) {
      const agent = this.dependencies.resolveVirtualAgent?.(bareJid(subscription.agentJid));
      if (!agent) continue;
      const route = { agent, subscriberJid: bareJid(subscription.subscriberJid) };
      desired.set(presenceRouteKey(subscription), route);
    }

    for (const [key, route] of this.publishedPresence) {
      if (desired.has(key)) continue;
      await session.send(buildUnavailablePresence(route.agent, route.subscriberJid));
      this.publishedPresence.delete(key);
    }
    for (const [key, route] of desired) {
      if (this.publishedPresence.has(key)) continue;
      await session.send(buildAvailablePresence(route.agent, route.subscriberJid));
      this.publishedPresence.set(key, route);
    }
  }

  private async publishUnavailablePresence(session: XmppComponentSession): Promise<void> {
    for (const route of this.publishedPresence.values()) {
      await session.send(buildUnavailablePresence(route.agent, route.subscriberJid)).catch((err) => {
        console.error('[xmpp-gateway] unavailable presence send failed:', err);
      });
    }
  }

  /**
   * XEP-0184 sweep. Default is observe-only (receiptMaxResends=0): un-acked messages
   * simply expire from tracking, since a missing receipt does not mean the message failed
   * and blind resends would duplicate ordinary messages. When an operator opts into
   * resends, we retry up to the cap and log the ones that still go unconfirmed.
   */
  private resendUnacked(): void {
    const session = this.session;
    if (!session || !this.isConnected()) return;
    const { resend, gaveUp } = this.receipts.due(Date.now());
    for (const stanza of resend) {
      void session.send(stanza).catch((err) => {
        console.error('[xmpp-gateway] receipt resend failed:', err);
      });
    }
    // Only noteworthy when resends were actually attempted; observe-only expiry is normal.
    if (this.config.receiptMaxResends > 0) {
      for (const id of gaveUp) {
        console.error(
          `[xmpp-gateway] no delivery receipt for ${id} after ${this.config.receiptMaxResends} resends; giving up`,
        );
      }
    }
  }

  isConnected(): boolean {
    return this.session !== null && this.connectionState === 'online';
  }

  /** Send an IQ get/set and await its correlated result or error response. */
  requestIq(stanza: Element, options?: IqRequestOptions): Promise<Element> {
    return this.requiredSession().requestIq(stanza, options);
  }

  /**
   * The single outbound send path. Any stanza carrying an XEP-0184 <request/> is
   * registered for receipt tracking *before* the send resolves — otherwise a fast peer's
   * <received/> could arrive before registration and be dropped, leaving a delivered
   * message pending (and, with resends enabled, later duplicated). If the send itself
   * fails, the entry is removed.
   */
  private async sendTracked(stanza: Element): Promise<string> {
    const session = this.requiredSession();
    const id = String(stanza.attrs.id ?? '');
    const track = id !== '' && stanza.getChild('request', RECEIPTS_NS) != null;
    if (track) this.receipts.register(id, stanza);
    try {
      await session.send(stanza);
    } catch (err) {
      if (track) this.receipts.ack(id);
      throw err;
    }
    return id;
  }

  async deliver(input: OutboundDeliverRequest & { from: string }): Promise<string> {
    const built = buildOutboundStanza({ ...input, lang: input.lang ?? this.config.xmlLang }, input.from);
    // XEP-0334 <store/> so an offline 1:1 peer still gets it; MUC messages aren't stored.
    const stanza = applyStoreHints(built, built.attrs.type === 'chat' ? { store: true } : undefined);
    return this.sendTracked(stanza);
  }

  async deliverTaskEvent(event: TaskWireEvent): Promise<string> {
    return this.sendTracked(buildTaskEvent(event, this.config.protocolNamespaces ?? DEFAULT_PROTOCOL_NAMESPACES));
  }

  async setTyping(
    from: string,
    to: string,
    threadId: string | null,
    state: 'composing' | 'paused' | 'inactive',
  ): Promise<void> {
    const session = this.requiredSession();
    const targets = { to, threadId, groupchat: isMucJid(to) };
    const send = (stanza: Element) => session.send(stanza);
    if (state === 'inactive') await sendInactiveForAgent(send, from, targets);
    else if (state === 'paused') await sendPausedForAgent(send, from, targets);
    else await sendComposingForAgent(send, from, targets);
  }

  private requiredSession(): XmppComponentSession {
    if (!this.session) throw new Error('XMPP gateway is not connected');
    return this.session;
  }
}

export type { GatewayRuntimeMailbox } from './runtime-mailbox.js';
export { xml, type Element } from '@xmpp/xml';
export { IqResponseError } from './xmpp-component.js';
export type { IqRequestOptions } from './xmpp-component.js';
export * from './agent-api-disco.js';
export * from './task-stanza-codec.js';
export * from './hash-codec.js';
export * from './json-codec.js';
export * from './rsm-codec.js';
export * from './protocol-error.js';
export * from './xep-plugins/ping.js';
export * from './xep-plugins/presence.js';
export * from './xep-plugins/search.js';
export * from './xep-plugins/vcard.js';
