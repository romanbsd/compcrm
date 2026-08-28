import { RSM_NS } from '@agent-xmpp/protocol';
import { xml, type Element } from '@xmpp/xml';

export interface RsmRequest {
  max: number;
  after?: string;
  before?: string;
}

export interface RsmPage<T> {
  items: T[];
  first?: string;
  last?: string;
  count: number;
}

type RsmOrderKey = string | Uint8Array;

export function parseRsm(parent: Element, defaultMax = 100, maximum = 100): RsmRequest {
  const set = parent.getChild('set', RSM_NS);
  const requested = Number(set?.getChildText('max') ?? defaultMax);
  const max = Number.isInteger(requested) && requested >= 0 ? Math.min(requested, maximum) : defaultMax;
  return {
    max,
    after: set?.getChildText('after') ?? undefined,
    before: set?.getChildText('before') ?? undefined,
  };
}

export function pageRsm<T>(
  items: T[],
  id: (item: T) => string,
  request: RsmRequest,
  orderKey: (item: T) => RsmOrderKey = id,
): RsmPage<T> {
  const ordered = [...items].sort((left, right) =>
    Buffer.compare(Buffer.from(orderKey(left)), Buffer.from(orderKey(right))),
  );
  let start = request.after ? ordered.findIndex((item) => id(item) === request.after) + 1 : 0;
  if (request.after && start === 0) start = ordered.length;
  let end = ordered.length;
  if (request.before !== undefined) {
    const before = request.before === '' ? ordered.length : ordered.findIndex((item) => id(item) === request.before);
    end = before < 0 ? 0 : before;
    start = Math.max(0, end - request.max);
  } else {
    end = Math.min(end, start + request.max);
  }
  const page = ordered.slice(start, end);
  return {
    items: page,
    first: page[0] ? id(page[0]) : undefined,
    last: page.at(-1) ? id(page.at(-1)!) : undefined,
    count: ordered.length,
  };
}

export function buildRsm(page: RsmPage<unknown>): Element {
  return xml(
    'set',
    { xmlns: RSM_NS },
    ...(page.first ? [xml('first', {}, page.first)] : []),
    ...(page.last ? [xml('last', {}, page.last)] : []),
    xml('count', {}, String(page.count)),
  );
}
