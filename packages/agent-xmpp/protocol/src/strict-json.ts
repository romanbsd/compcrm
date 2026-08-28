export interface StrictJsonLimits {
  maxBytes: number;
  maxDepth: number;
  maxStringBytes: number;
  maxMembers: number;
}

export const DEFAULT_JSON_LIMITS: Readonly<StrictJsonLimits> = Object.freeze({
  maxBytes: 1_048_576,
  maxDepth: 64,
  maxStringBytes: 1_048_576,
  maxMembers: 100_000,
});

export class JsonResourceLimitError extends Error {}

const utf8Length = (value: string): number => new TextEncoder().encode(value).length;
const NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/** A bounded JSON parser that detects duplicate object names before information is lost. */
export function parseStrictJson(text: string, limits: Partial<StrictJsonLimits> = {}): unknown {
  const resolved = { ...DEFAULT_JSON_LIMITS, ...limits };
  assertJsonLimits(resolved);
  if (utf8Length(text) > resolved.maxBytes) throw new JsonResourceLimitError('JSON payload exceeds byte limit');
  let offset = 0;
  let members = 0;
  const fail = (message: string): never => {
    throw new Error(`${message} at JSON offset ${offset}`);
  };
  const whitespace = (): void => {
    while (offset < text.length && /[\t\n\r ]/.test(text[offset]!)) offset++;
  };
  const parseString = (): string => {
    if (text[offset++] !== '"') return fail('expected string');
    let result = '';
    while (offset < text.length) {
      const character = text[offset++]!;
      if (character === '"') {
        if (utf8Length(result) > resolved.maxStringBytes) {
          throw new JsonResourceLimitError(`JSON string exceeds byte limit at JSON offset ${offset}`);
        }
        assertUnicodeScalarString(result);
        return result;
      }
      if (character === '\\') {
        const escape = text[offset++]!;
        const simple: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        };
        if (escape in simple) result += simple[escape];
        else if (escape === 'u') {
          const hex = text.slice(offset, offset + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid Unicode escape');
          result += String.fromCharCode(Number.parseInt(hex, 16));
          offset += 4;
        } else fail('invalid string escape');
      } else {
        if (character.charCodeAt(0) < 0x20) fail('unescaped control character');
        result += character;
      }
    }
    return fail('unterminated string');
  };
  const parseNumber = (): number => {
    NUMBER_PATTERN.lastIndex = offset;
    const match = NUMBER_PATTERN.exec(text);
    if (!match) return fail('invalid number');
    offset = NUMBER_PATTERN.lastIndex;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail('number is not finite');
    if (/^-?[0-9]+$/.test(match[0])) {
      const integer = BigInt(match[0]);
      if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) {
        fail('integer is outside the lossless range');
      }
    }
    return number;
  };
  const parseValue = (depth: number): unknown => {
    if (depth > resolved.maxDepth) {
      throw new JsonResourceLimitError(`JSON nesting exceeds depth limit at JSON offset ${offset}`);
    }
    whitespace();
    const character = text[offset];
    if (character === '"') return parseString();
    if (character === '{') {
      offset++;
      const result: Record<string, unknown> = {};
      const names = new Set<string>();
      whitespace();
      if (text[offset] === '}') {
        offset++;
        return result;
      }
      while (true) {
        whitespace();
        if (text[offset] !== '"') fail('expected object member name');
        const name = parseString();
        if (names.has(name)) fail(`duplicate object member ${JSON.stringify(name)}`);
        names.add(name);
        if (++members > resolved.maxMembers) {
          throw new JsonResourceLimitError(`JSON member count exceeds limit at JSON offset ${offset}`);
        }
        whitespace();
        if (text[offset++] !== ':') fail('expected colon');
        result[name] = parseValue(depth + 1);
        whitespace();
        const separator = text[offset++];
        if (separator === '}') return result;
        if (separator !== ',') fail('expected comma or object end');
      }
    }
    if (character === '[') {
      offset++;
      const result: unknown[] = [];
      whitespace();
      if (text[offset] === ']') {
        offset++;
        return result;
      }
      while (true) {
        if (++members > resolved.maxMembers) {
          throw new JsonResourceLimitError(`JSON member count exceeds limit at JSON offset ${offset}`);
        }
        result.push(parseValue(depth + 1));
        whitespace();
        const separator = text[offset++];
        if (separator === ']') return result;
        if (separator !== ',') fail('expected comma or array end');
      }
    }
    if (text.startsWith('true', offset)) {
      offset += 4;
      return true;
    }
    if (text.startsWith('false', offset)) {
      offset += 5;
      return false;
    }
    if (text.startsWith('null', offset)) {
      offset += 4;
      return null;
    }
    if (character === '-' || (character !== undefined && /[0-9]/.test(character))) return parseNumber();
    return fail('expected JSON value');
  };
  const value = parseValue(0);
  whitespace();
  if (offset !== text.length) fail('trailing data');
  return value;
}

function assertJsonLimits(limits: StrictJsonLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < (name === 'maxDepth' ? 0 : 1)) {
      throw new Error(`${name} must be a ${name === 'maxDepth' ? 'non-negative' : 'positive'} safe integer`);
    }
  }
}

export function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!Number.isInteger(low) || low < 0xdc00 || low > 0xdfff) {
        throw new Error('lone high surrogate is not permitted');
      }
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error('lone low surrogate is not permitted');
    }
  }
}
