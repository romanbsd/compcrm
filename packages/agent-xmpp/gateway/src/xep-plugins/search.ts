/**
 * Agent-directory search via XEP-0055, with legacy fields for widely deployed
 * clients and the recommended XEP-0004 form extension.
 *
 * @see https://xmpp.org/extensions/xep-0055.html
 */
import type { RegisteredAgent } from '@agent-xmpp/protocol';
import { xml, type Element } from '@xmpp/xml';

import { DATA_FORMS_NS, SEARCH_NS } from '../agent-api-disco.js';
import { buildRsm, pageRsm, parseRsm } from '../rsm-codec.js';

const INSTRUCTIONS = 'Enter a nickname to search for matching agents. Leave it empty to list up to 100 agents.';
const MAX_SEARCH_RESULTS = 100;

function resultIq(request: Element, componentJid: string, query: Element): Element {
  return xml(
    'iq',
    {
      type: 'result',
      id: request.attrs.id,
      from: componentJid,
      to: request.attrs.from,
      ...(request.attrs['xml:lang'] ? { 'xml:lang': request.attrs['xml:lang'] } : {}),
    },
    query,
  );
}

function dataFormFieldValue(form: Element, name: string): string {
  return (
    form
      .getChildren('field')
      .find((field) => field.attrs.var === name)
      ?.getChildText('value')
      ?.trim() ?? ''
  );
}

function nickname(agent: RegisteredAgent): string {
  return agent.manifest.agent.title ?? agent.manifest.agent.name;
}

export function buildSearchFields(request: Element, componentJid: string): Element {
  return resultIq(
    request,
    componentJid,
    xml(
      'query',
      { xmlns: SEARCH_NS },
      xml('instructions', {}, INSTRUCTIONS),
      xml('nick'),
      xml(
        'x',
        { xmlns: DATA_FORMS_NS, type: 'form' },
        xml('title', {}, 'Agent Directory Search'),
        xml('instructions', {}, INSTRUCTIONS),
        xml('field', { type: 'hidden', var: 'FORM_TYPE' }, xml('value', {}, SEARCH_NS)),
        xml('field', { type: 'text-single', label: 'Nickname', var: 'nick' }),
      ),
    ),
  );
}

export function buildSearchResults(request: Element, componentJid: string, agents: RegisteredAgent[]): Element {
  const query = request.getChild('query', SEARCH_NS);
  const dataForm = query?.getChild('x', DATA_FORMS_NS);
  if (dataForm && dataForm.attrs.type !== 'submit') {
    return resultIq(request, componentJid, xml('query', { xmlns: SEARCH_NS }));
  }
  const submittedForm = dataForm;
  const needle = (submittedForm ? dataFormFieldValue(submittedForm, 'nick') : (query?.getChildText('nick') ?? ''))
    .trim()
    .toLowerCase();
  const matches = agents.filter((agent) => {
    if (!needle) return true;
    const identity = agent.manifest.agent;
    const localpart = identity.jid.split('@', 1)[0] ?? '';
    return [localpart, identity.name, identity.title ?? ''].some((value) => value.toLowerCase().includes(needle));
  });
  const page = pageRsm(matches, (agent) => agent.manifest.agent.jid, parseRsm(query!, MAX_SEARCH_RESULTS));

  if (submittedForm) {
    return resultIq(
      request,
      componentJid,
      xml(
        'query',
        { xmlns: SEARCH_NS },
        xml(
          'x',
          { xmlns: DATA_FORMS_NS, type: 'result' },
          xml('field', { type: 'hidden', var: 'FORM_TYPE' }, xml('value', {}, SEARCH_NS)),
          xml(
            'reported',
            {},
            xml('field', { var: 'jid', label: 'Jabber ID', type: 'jid-single' }),
            xml('field', { var: 'nick', label: 'Nickname', type: 'text-single' }),
          ),
          ...page.items.map((agent) =>
            xml(
              'item',
              {},
              xml('field', { var: 'jid' }, xml('value', {}, agent.manifest.agent.jid)),
              xml('field', { var: 'nick' }, xml('value', {}, nickname(agent))),
            ),
          ),
        ),
        buildRsm(page),
      ),
    );
  }

  return resultIq(
    request,
    componentJid,
    xml(
      'query',
      { xmlns: SEARCH_NS },
      ...page.items.map((agent) => xml('item', { jid: agent.manifest.agent.jid }, xml('nick', {}, nickname(agent)))),
      buildRsm(page),
    ),
  );
}
