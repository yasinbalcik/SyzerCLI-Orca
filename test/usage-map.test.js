'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mapSyzerUsage: map, MAP_SRC } = require('../src/orca-edits-usage');

const NOW = Date.parse('2026-10-12T10:00:00Z');
const FUTURE = '2026-10-13T00:00:00.000Z';
const prov = (o) => ({ provider: 'openrouter', name: 'OpenRouter', percent_used: 10, percent_remaining: 90, basis: 'free_requests', used: 5, limit: 50, keys_ready: 2, keys_total: 2, resets_at: FUTURE, ...o });
const payload = (providers, o) => ({ providers, percent_used: 0, keys_ready: providers.reduce((a, p) => a + p.keys_ready, 0), keys_total: providers.reduce((a, p) => a + p.keys_total, 0), updated_at: '2026-10-12T10:00:00Z', ...o });

test('all ready: ok levels, true average in Total, session is Total', () => {
  const j = payload([prov({ percent_used: 10 }), prov({ provider: 'nvidia', name: 'NVIDIA', percent_used: 30, used: 3, limit: 10, basis: 'local_requests' })]);
  const r = map(j, new Map(), NOW);
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.buckets.length, 3);
  assert.ok(r.buckets.every((b) => b.level === 'ok'));
  const total = r.buckets[2];
  assert.strictEqual(total.name, 'Total');
  assert.strictEqual(total.usedPercent, 20);
  assert.strictEqual(r.session.usedPercent, 20);
  assert.strictEqual(r.buckets[0].badge, '2/2 keys');
  assert.strictEqual(r.buckets[0].detail, '45 left');
  assert.strictEqual(r.buckets[0].resetsAt, Date.parse(FUTURE));
});

test('one provider exhausted: crit, session shows worst percent, Total keeps average', () => {
  const j = payload([prov({ percent_used: 10 }), prov({ provider: 'nvidia', name: 'NVIDIA', percent_used: 96, used: 48, limit: 50 })]);
  const r = map(j, new Map(), NOW);
  assert.strictEqual(r.buckets[1].level, 'crit');
  assert.strictEqual(r.buckets[1].badge, '! 96% used');
  assert.strictEqual(r.buckets[2].usedPercent, 53);
  assert.strictEqual(r.buckets[2].level, 'crit');
  assert.strictEqual(r.session.usedPercent, 96);
  const w = map(payload([prov({ percent_used: 87 })]), new Map(), NOW);
  assert.strictEqual(w.buckets[0].level, 'warn');
  assert.strictEqual(w.buckets[0].badge, '! 87% used');
});

test('no quota info: unavailable, no session', () => {
  const j = payload([prov({ percent_used: null, limit: null, used: null })]);
  const r = map(j, new Map(), NOW);
  assert.strictEqual(r.status, 'unavailable');
  assert.strictEqual(r.session, null);
  assert.match(r.error, /No quota info \(2\/2 keys ready\)/);
  assert.strictEqual(map({ providers: [] }, new Map(), NOW).status, 'unavailable');
});

test('keys_ready 0: crit even at low percent, session pushed to crit range', () => {
  const j = payload([prov({ percent_used: 20, keys_ready: 0 })]);
  const r = map(j, new Map(), NOW);
  assert.strictEqual(r.buckets[0].level, 'crit');
  assert.strictEqual(r.buckets[0].badge, '0 keys ready');
  assert.strictEqual(r.buckets[0].usedPercent, 20);
  assert.ok(r.session.usedPercent >= 95);
});

test('resets_at in the past is rolled forward to the next day boundary', () => {
  const past = '2026-10-11T00:00:00.000Z';
  const r = map(payload([prov({ resets_at: past })]), new Map(), NOW);
  assert.ok(r.buckets[0].resetsAt > NOW);
  assert.strictEqual(r.buckets[0].resetsAt, Date.parse('2026-10-13T00:00:00.000Z'));
  const none = map(payload([prov({ resets_at: null })]), new Map(), NOW);
  assert.strictEqual(none.buckets[0].resetsAt, NOW + 864e5);
});

test('key rotation notice: only with active_key, lasts 2 polls after detection', () => {
  const memo = new Map();
  const at = (k, ready = 2) => map(payload([prov({ active_key: k, keys_ready: ready })]), memo, NOW).buckets[0].detail;
  assert.strictEqual(at(1), '45 left');
  assert.strictEqual(at(1), '45 left');
  assert.strictEqual(at(2), 'rotated: key #2'); // detection
  assert.strictEqual(at(2), 'rotated: key #2'); // poll 1
  assert.strictEqual(at(2), 'rotated: key #2'); // poll 2
  assert.strictEqual(at(2), '45 left');
  // field absent: never invented
  const m2 = new Map();
  map(payload([prov({ keys_ready: 2 })]), m2, NOW);
  assert.strictEqual(map(payload([prov({ keys_ready: 1 })]), m2, NOW).buckets[0].detail, '45 left');
});

test('injected source is the mapper, with injection-safe text', () => {
  assert.ok(MAP_SRC.startsWith('function szMap('));
  assert.ok(!MAP_SRC.includes("'"));
  assert.ok(!MAP_SRC.includes('${'));
});
