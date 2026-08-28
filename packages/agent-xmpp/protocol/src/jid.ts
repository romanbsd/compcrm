import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import IdnHostname from 'idn-hostname';
import { initSync, usernamecasemapped_enforce } from 'precis-wasm/precis_wasm.js';

/** Return the addressable bare JID, stripping any resource suffix. */
export function bareJid(jid: string): string {
  return jid.split('/')[0] ?? jid;
}

const LOCALPART_EXCLUDED = /["&'/:<>@]/u;
const DOMAINPART_EXCLUDED = /[/@]/u;
const DNS_LABEL_SEPARATOR_AT_END = /[.\u3002\uff0e\uff61]$/u;
const IPV6_ZONE = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/u;
const require = createRequire(import.meta.url);
const { idnHostname, punycode } = IdnHostname;
let precisInitialized = false;

/**
 * Prepare the RFC 7622 bare-JID shape used for ProtoXEP endpoints.
 * Endpoint identities require a localpart and deliberately reject resources.
 */
export function normalizeEndpointJid(value: string): string | null {
  if (value.includes('/') || value.indexOf('@') <= 0 || value.indexOf('@') !== value.lastIndexOf('@')) return null;
  const [rawLocal, rawDomain] = value.split('@');
  const local = normalizeLocalpart(rawLocal!);
  const domain = normalizeDomain(rawDomain!);
  if (!local || !domain || LOCALPART_EXCLUDED.test(local) || utf8Length(local) > 1023 || utf8Length(domain) > 1023) {
    return null;
  }
  return `${local}@${domain}`;
}

export function isNormalizedEndpointJid(value: string): boolean {
  return normalizeEndpointJid(value) === value;
}

export function sameEndpointJid(left: string, right: string): boolean {
  const preparedLeft = normalizeEndpointJid(left);
  return preparedLeft !== null && preparedLeft === normalizeEndpointJid(right);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function normalizeLocalpart(value: string): string | null {
  initializePrecis();
  try {
    return usernamecasemapped_enforce(value) as string;
  } catch (error) {
    if (error instanceof Error || typeof error === 'string') return null;
    throw error;
  }
}

function initializePrecis(): void {
  if (precisInitialized) return;
  const wasmPath = require.resolve('precis-wasm/precis_wasm_bg.wasm');
  initSync({ module: readFileSync(wasmPath) });
  precisInitialized = true;
}

function normalizeDomain(value: string): string | null {
  const withoutFinalSeparator = value.replace(DNS_LABEL_SEPARATOR_AT_END, '');
  if (!withoutFinalSeparator || DOMAINPART_EXCLUDED.test(withoutFinalSeparator)) {
    return null;
  }

  const ipLiteral = normalizeIpLiteral(withoutFinalSeparator);
  if (ipLiteral !== undefined) return ipLiteral;

  try {
    const ascii = idnHostname(withoutFinalSeparator);
    const unicode = punycode.toUnicode(ascii).normalize('NFC').toLowerCase().normalize('NFC');
    return idnHostname(unicode) === ascii ? unicode : null;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function normalizeIpLiteral(value: string): string | null | undefined {
  if (!value.startsWith('[') && !value.endsWith(']')) return undefined;
  if (!value.startsWith('[') || !value.endsWith(']')) return null;

  const content = value.slice(1, -1);
  const zoneDelimiter = content.indexOf('%25');
  const address = zoneDelimiter === -1 ? content : content.slice(0, zoneDelimiter);
  const zone = zoneDelimiter === -1 ? undefined : content.slice(zoneDelimiter + 3);
  if (isIP(address) !== 6 || (zone !== undefined && !IPV6_ZONE.test(zone))) return null;

  const hostname = new URL(`http://[${address}]/`).hostname.toLowerCase();
  if (zone === undefined) return hostname;
  const normalizedZone = zone.replace(/%[0-9A-Fa-f]{2}/gu, (encoded) => encoded.toUpperCase());
  return `${hostname.slice(0, -1)}%25${normalizedZone}]`;
}
