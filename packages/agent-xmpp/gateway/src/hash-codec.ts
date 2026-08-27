import { HASHES_NS } from '@agent-xmpp/protocol';
import { xml, type Element } from '@xmpp/xml';

export interface Sha256Hash {
  algorithm: 'sha-256';
  value: string;
}

export function buildHash(value: string): Element {
  return xml('hash', { xmlns: HASHES_NS, algo: 'sha-256' }, value);
}

export function parseHash(parent: Element, wrapper?: string): Sha256Hash {
  const container = wrapper ? parent.getChild(wrapper) : parent;
  const hash = container?.getChild('hash', HASHES_NS);
  if (!hash || hash.attrs.algo !== 'sha-256') throw new Error('a sha-256 XEP-0300 hash is required');
  const value = hash.getText();
  if (!/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(value)) {
    throw new Error('invalid SHA-256 Base64 hash');
  }
  return { algorithm: 'sha-256', value };
}
