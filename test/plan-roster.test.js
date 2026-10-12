'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SYZER_EVENT } = require('../src/orca-snippets/syzer-event');

// Orca'nın genel normalleştiricisi yerine kimlik işlevi: ayrıştırıcının ürettiği alanları doğrudan görürüz
const mk = () => new Function('un', `${SYZER_EVENT};return __syzerEvent;`)((x) => x);

const plan = (items, total) => ({ plan: items, done: (total || items.length) - items.length, total: total || items.length });
const item = (id, n, title, status, extra = {}) => ({ id, n, title, status, agent: '', model: '', waits: [], ...extra });

test('Plan event: idle items listed, running agent item left to the subagent entry', () => {
  const ev = mk(); const e = {};
  ev(e, 'Prompt', 'build it', 'pane1', {});
  ev(e, 'SubagentStart', '', 'pane1', { agent_id: 'sa1', agent_type: 'explore', description: 'scan the repo' });
  const out = ev(e, 'Plan', '', 'pane1', plan([
    item('1', 1, 'scan the repo', 'working', { agent: 'explore' }),
    item('2', 2, 'write tests', 'idle', { agent: 'general', waits: ['1'] }),
    item('3', 3, 'update docs', 'working'), // ana ajanın kendi maddesi (agent yok)
  ], 4));
  assert.strictEqual(out.state, 'working');
  const ids = out.subagents.map((x) => x.id);
  assert.deepStrictEqual(ids.sort(), ['plan:2', 'plan:3', 'sa1'].sort());
  const byId = Object.fromEntries(out.subagents.map((x) => [x.id, x]));
  assert.strictEqual(byId.sa1.description, 'scan the repo');
  assert.strictEqual(byId['plan:2'].state, 'idle');
  assert.match(byId['plan:2'].description, /^\[2\/4\] write tests \(waits: 1\)$/);
  assert.strictEqual(byId['plan:3'].state, 'working');
  assert.strictEqual(byId['plan:3'].agentType, 'todo');
});

test('empty Plan clears the plan entries but keeps running subagents', () => {
  const ev = mk(); const e = {};
  ev(e, 'Prompt', 'x', 'p', {});
  ev(e, 'SubagentStart', '', 'p', { agent_id: 'sa', agent_type: 'general' });
  ev(e, 'Plan', '', 'p', plan([item('1', 1, 'a', 'idle')], 1));
  const out = ev(e, 'Plan', '', 'p', plan([], 0));
  assert.deepStrictEqual(out.subagents.map((x) => x.id), ['sa']);
});

test('empty Plan with nothing running yields no roster', () => {
  const ev = mk(); const e = {};
  ev(e, 'Prompt', 'x', 'p', {});
  ev(e, 'Plan', '', 'p', plan([item('1', 1, 'a', 'idle')], 1));
  const out = ev(e, 'Plan', '', 'p', plan([], 0));
  assert.strictEqual(out.subagents, undefined);
});

test('roster is capped at 32 and plan labels are bounded', () => {
  const ev = mk(); const e = {};
  ev(e, 'Prompt', 'x', 'p', {});
  const many = Array.from({ length: 50 }, (_, k) => item(String(k + 1), k + 1, 'T'.repeat(300), 'idle'));
  const out = ev(e, 'Plan', '', 'p', plan(many, 50));
  assert.ok(out.subagents.length <= 32);
  assert.ok(out.subagents.every((x) => x.description.length <= 160 + 12));
});

test('Plan before any prompt does not invent a state', () => {
  const ev = mk();
  assert.strictEqual(ev({}, 'Plan', '', 'p', plan([], 0)), null);
});
