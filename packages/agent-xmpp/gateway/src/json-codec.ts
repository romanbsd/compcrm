import { JSON_MEDIA_TYPE, parseStrictJson } from '@agent-xmpp/protocol';
import { xml, type Element } from '@xmpp/xml';

export function parseJsonElement(element: Element, maxBytes = 1_048_576): unknown {
  const mediaType = String(element.attrs['media-type'] ?? '');
  if (mediaType && mediaType !== JSON_MEDIA_TYPE) throw new Error(`unsupported JSON media type: ${mediaType}`);
  return parseStrictJson(element.getText(), { maxBytes });
}

export function jsonElement(name: string, namespace: string, canonicalJson: string): Element {
  return xml(name, { xmlns: namespace, 'media-type': JSON_MEDIA_TYPE }, canonicalJson);
}
