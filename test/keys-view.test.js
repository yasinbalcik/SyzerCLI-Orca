'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'orca-snippets', 'keys-renderer.js'), 'utf8');
const V = new Function(src + '\n;return __SyzerKeysView();')();

test('snippet obeys injection rules', () => {
  assert.ok(!src.includes("'"), 'no single quotes');
  assert.ok(!src.includes('${'), 'no template interpolation');
});

test('sortKeys modes', () => {
  const ks = [
    { index: 0, state: 'ready', free: { remaining: 10, limit: 50 } },
    { index: 1, state: 'invalid', free: null },
    { index: 2, state: 'ready', free: { remaining: 40, limit: 50 } },
    { index: 3, state: 'ready', credit: { remaining: 2.5, limit: 5 } },
  ];
  const idx = (m) => V.sortKeys(ks, m).map((k) => k.index);
  assert.deepStrictEqual(idx('key'), [0, 1, 2, 3]);
  assert.deepStrictEqual(idx('low'), [3, 0, 2, 1]);
  assert.deepStrictEqual(idx('high'), [2, 0, 3, 1]);
  assert.deepStrictEqual(idx('problems'), [1, 0, 2, 3]);
});

test('paging helpers', () => {
  assert.strictEqual(V.pageCount(0, 25), 1);
  assert.strictEqual(V.pageCount(679, 25), 28);
  assert.strictEqual(V.clampPage(99, 100, 25), 4);
  assert.strictEqual(V.clampPage(0, 100, 25), 1);
  const list = Array.from({ length: 60 }, (_, i) => ({ index: i, active: i === 52 }));
  assert.strictEqual(V.activePage(list, 25), 3);
  assert.strictEqual(V.activePage([{}], 25), 0);
});

test('totals with fallback and sum', () => {
  const p = { keys: [
    { state: 'ready', free: { remaining: 5, limit: 50 }, checked_at: 1000 },
    { state: 'dead', free: null, checked_at: null },
  ] };
  const t = V.totalsOf(p);
  assert.deepStrictEqual([t.keys_total, t.ready, t.keys_with_data, t.free_remaining, t.free_limit, t.oldest_check_at], [2, 1, 1, 5, 50, 1000]);
  const t2 = V.totalsOf({ totals: { keys_total: 9, ready: 7, free_remaining: 20, free_limit: 100 }, keys: [] });
  assert.strictEqual(t2.keys_total, 9);
  assert.strictEqual(V.pctOf(t2.free_remaining, t2.free_limit), 20);
  const s = V.sumTotals([p, { totals: { keys_total: 9, free_remaining: 20, free_limit: 100 } }]);
  assert.strictEqual(s.keys_total, 11);
  assert.strictEqual(s.free_remaining, 25);
  assert.match(V.line(s), /11 keys .* remaining today 25\/150 \(17%\)/);
  assert.strictEqual(V.ageText(0, 3 * 60000), '3 min ago');
  assert.strictEqual(V.ageText(null), '');
  assert.strictEqual(V.remText({}), 'no data');
  assert.strictEqual(V.remText({ credit: { remaining: 1.234 } }), '$1.23 left');
});
