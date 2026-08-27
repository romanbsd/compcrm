import { describe, expect, it } from 'bun:test';
import { AGENT_API_NS, AGENT_TASK_NS } from '@agent-xmpp/protocol';
import { xml } from '@xmpp/xml';

import { parseManifestRegistration } from './agent-api-disco.js';
import { ProtocolError } from './protocol-error.js';
import { buildAcceptedResult, parseAcceptedResult, parseTaskEvent, parseTaskResult } from './task-stanza-codec.js';

const requestId = 'request-identifier-0001';
const taskId = 'task-identifier-000001';
const eventId = 'event-identifier-00001';

describe('review regressions', () => {
  it('preserves the current revision in replay acceptance results', () => {
    const request = xml('iq', {
      type: 'set',
      id: 'invoke',
      from: 'caller@example.test',
    });
    const response = buildAcceptedResult(
      request,
      {
        requestId,
        taskId,
        revision: 4,
        created: '2026-08-27T18:00:00.000Z',
        retainUntil: '2026-08-28T18:00:00.000Z',
      },
      'assistant@agents.example.test',
    );

    expect(parseAcceptedResult(response)?.revision).toBe(4);
  });

  it('rejects invalid and foreign registration manifests', () => {
    const invalid = xml(
      'iq',
      { type: 'set' },
      xml(
        'register',
        { xmlns: AGENT_API_NS },
        xml('manifest', { xmlns: AGENT_API_NS, 'media-type': 'application/json' }, '{}'),
      ),
    );
    const foreign = xml(
      'iq',
      { type: 'set' },
      xml(
        'register',
        { xmlns: AGENT_API_NS },
        xml('manifest', { xmlns: 'urn:example:foreign', 'media-type': 'application/json' }, '{}'),
      ),
    );

    expect(() => parseManifestRegistration(invalid)).toThrow(ProtocolError);
    expect(parseManifestRegistration(foreign)).toBeNull();
  });

  it('rejects non-object task result and event payloads', () => {
    const result = xml(
      'iq',
      { type: 'result' },
      xml(
        'task-result',
        {
          xmlns: AGENT_TASK_NS,
          'task-id': taskId,
          state: 'completed',
          revision: '1',
          'media-type': 'application/json',
        },
        'null',
      ),
    );
    const event = xml(
      'message',
      {
        type: 'normal',
        from: 'assistant@agents.example.test',
        to: 'caller@example.test',
      },
      xml(
        'event',
        {
          xmlns: AGENT_TASK_NS,
          'task-id': taskId,
          'event-id': eventId,
          revision: '1',
          type: 'status',
        },
        '[]',
      ),
    );

    expect(() => parseTaskResult(result)).toThrow('invalid task-result payload');
    expect(() => parseTaskEvent(event)).toThrow('invalid task event payload');
  });
});
