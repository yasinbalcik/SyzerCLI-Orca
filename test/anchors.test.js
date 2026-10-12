'use strict';
// Anchor regression tests against REAL (windowed) Orca bundle fixtures; see scripts/make-fixtures.js.
// Engine semantics mirrored from buildPatched() in src/orca-patch.js: a group is all-or-nothing, each `from` must match
// exactly once in its target, a failing non-core group is skipped (rolled back), never thrown.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const patch = require('../src/orca-patch');
const { countOf, keyOf, CMD, FIXTURES } = require('../scripts/make-fixtures');

const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
const versions = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES).filter((d) => fs.existsSync(path.join(FIXTURES, d, 'index.json'))).sort(cmpVer) : [];
const newest = versions[versions.length - 1];

const parses = (s) => { try { new vm.Script(s); return true; } catch { return false; } };
const edits = patch.edits(CMD);
const groupsOf = (list) => { const g = new Map(); for (const e of list) { if (!g.has(e.group)) g.set(e.group, []); g.get(e.group).push(e); } return g; };

function load(version) {
  const dir = path.join(FIXTURES, version);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const byKey = new Map(idx.entries.map((e) => [e.key, e]));
  const texts = new Map();
  for (const e of idx.entries) if (!texts.has(e.target)) texts.set(e.target, fs.readFileSync(path.join(dir, e.fixture), 'utf8'));
  return { idx, byKey, texts };
}

// runs every group over (a copy of) the fixture texts. Returns { results: Map(group -> {ok, error, applied:[{ed,m0,repl}]}), files }
function run(fx, mutate = {}, missingOk = false) {
  const files = new Map(fx.texts);
  for (const [t, v] of Object.entries(mutate)) files.set(t, v);
  const results = new Map();
  for (const [name, list] of groupsOf(edits)) {
    const snap = new Map(files);
    const applied = [];
    try {
      for (const ed of list) {
        const ent = fx.byKey.get(keyOf(ed));
        if (!ent) { if (missingOk) throw new Error('no fixture for edit (older Orca version)'); throw new Error(`no fixture entry for ${ed.group}: ${String(ed.from).slice(0, 60)} (run scripts/make-fixtures.js)`); }
        const t = ent.target;
        if (ed.file) assert.strictEqual(t, ed.file); else assert.ok(ed.glob.test(t), `target ${t} must match glob`);
        const cur = files.get(t);
        const n = countOf(cur, ed.from);
        if (n !== 1) throw new Error(`anchor "${String(ed.from).slice(0, 60)}" matched ${n}x in ${t}`);
        let m0 = null; let repl = null;
        files.set(t, cur.replace(ed.from, (...m) => { m0 = m[0]; repl = typeof ed.to === 'function' ? ed.to(m) : ed.to; return repl; }));
        applied.push({ ed, m0, repl, target: t });
      }
      results.set(name, { ok: true, applied });
    } catch (e) {
      files.clear(); for (const [k, v] of snap) files.set(k, v);
      results.set(name, { ok: false, error: e.message, applied: [] });
    }
  }
  return { results, files };
}

test('fixtures exist and stay small', () => {
  assert.ok(newest, 'no fixture version under test/fixtures (run scripts/make-fixtures.js)');
  let total = 0;
  for (const v of versions) for (const f of fs.readdirSync(path.join(FIXTURES, v))) total += fs.statSync(path.join(FIXTURES, v, f)).size;
  assert.ok(total < 300 * 1024, `fixtures total ${total} bytes`);
});

for (const v of versions) {
  const isNewest = v === newest;
  test(`Orca ${v}: ${isNewest ? 'every' : 'covered'} patch group applies to real bundle fixtures`, () => {
    const fx = load(v);
    const { results } = run(fx, {}, !isNewest);
    const failed = [...results].filter(([, r]) => !r.ok && (isNewest || !/no fixture/.test(r.error)));
    assert.deepStrictEqual(failed.map(([n, r]) => `${n}: ${r.error}`), []);
    if (isNewest) assert.deepStrictEqual([...results.keys()].sort(), [...groupsOf(edits).keys()].sort());
  });

  test(`Orca ${v}: replacements stay syntactically plausible`, () => {
    const fx = load(v);
    const { results } = run(fx, {}, !isNewest);
    let checked = 0;
    for (const [name, r] of results) {
      for (const a of r.applied) {
        assert.ok(typeof a.repl === 'string' && a.repl.length > 0, `${name}: to() returned a string`);
        if (/^(async )?function /.test(a.m0) && parses(a.m0)) { checked++; assert.ok(parses(a.repl), `${name}: replacement of a complete statement must parse: ${a.repl.slice(0, 120)}`); }
      }
    }
    assert.ok(isNewest ? checked >= 3 : true, `only ${checked} parse checks ran`);
  });
}

test('renamed minified identifiers are survived and threaded into the output', () => {
  const fx = load(newest);
  let mutated = 0;
  const NEW = 'ZZq$9';
  for (const [idx, ed] of edits.entries()) {
    if (!(ed.from instanceof RegExp) || typeof ed.to !== 'function' || ed.group === 'core') continue;
    const ent = fx.byKey.get(keyOf(ed));
    if (!ent) continue;
    const text = fx.texts.get(ent.target);
    const m = new RegExp(ed.from.source, `${ed.from.flags.replace('g', '')}d`).exec(text);
    if (!m || !m.indices) continue;
    const g = m.slice(1).findIndex((x) => typeof x === 'string' && /^[A-Za-z_$][\w$]{0,3}$/.test(x) && !/^(e|t|n|r|i|a|o|jsx|jsxs|type|id)$/.test(x));
    if (g < 0) continue;
    const name = m[g + 1];
    const [a, b] = m.indices[0];
    const esc = name.replace(/\$/g, '\\$');
    const seg = text.slice(a, b);
    const re = new RegExp(`(?<![\\w$])${esc}(?![\\w$])`, 'g');
    if (!re.test(seg)) continue; // name not recoverable as a bare identifier in the matched text
    const mutatedText = text.slice(0, a) + seg.replace(re, NEW) + text.slice(b);
    const probe = run(fx, { [ent.target]: mutatedText });
    const r = probe.results.get(ed.group);
    assert.ok(r.ok, `#${idx} ${ed.group}: renamed \`${name}\` -> \`${NEW}\` must still match: ${r.error}`);
    const hit = r.applied.find((x) => x.ed === ed);
    assert.ok(hit && hit.repl.includes(NEW), `#${idx} ${ed.group}: new name threaded into output`);
    mutated++;
  }
  assert.ok(mutated >= 10, `rename probe covered ${mutated} anchors`);
});

test('a missing anchor makes its group skip (rolled back), never throw, and leaves other groups intact', () => {
  const fx = load(newest);
  const base = run(fx);
  for (const [name, list] of groupsOf(edits)) {
    if (name === 'core') continue;
    const ed = list[list.length - 1];
    const ent = fx.byKey.get(keyOf(ed));
    const text = fx.texts.get(ent.target);
    const m = (ed.from instanceof RegExp ? new RegExp(ed.from.source, ed.from.flags.replace('g', '')).exec(text) : null);
    const at = ed.from instanceof RegExp ? m.index : text.indexOf(ed.from);
    const len = ed.from instanceof RegExp ? m[0].length : ed.from.length;
    const broken = text.slice(0, at) + '/*gone*/' + text.slice(at + len);
    let probe;
    assert.doesNotThrow(() => { probe = run(fx, { [ent.target]: broken }); }, `${name}: must not throw`);
    const r = probe.results.get(name);
    assert.strictEqual(r.ok, false, `${name} must skip when an anchor vanishes`);
    assert.match(r.error, /matched 0x/);
    for (const [other, o] of probe.results) {
      if (other === name) continue;
      // groups sharing the broken span may legitimately differ; unrelated groups must be unaffected
      if (base.results.get(other).ok !== o.ok) assert.ok(list.some((x) => keyOf(x) && fx.byKey.get(keyOf(x)).target === ent.target), `${other} changed by breaking ${name}`);
    }
  }
});

test('an anchor that matches twice also skips the group (ambiguity guard)', () => {
  const fx = load(newest);
  const ed = edits.find((e) => e.group === 'agent' && typeof e.from === 'string');
  const ent = fx.byKey.get(keyOf(ed));
  const doubled = `${fx.texts.get(ent.target)}\n${ed.from}\n`;
  const r = run(fx, { [ent.target]: doubled }).results.get('agent');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /matched 2x/);
});
