import { describe, expect, it } from 'bun:test';

import { parseStrictJson } from './strict-json.js';

describe('parseStrictJson', () => {
  it('parses many numeric tokens without copying each remaining suffix', () => {
    const values = Array.from({ length: 20_000 }, (_, index) => index % 10);
    expect(parseStrictJson(JSON.stringify(values))).toEqual(values);
  });
});
