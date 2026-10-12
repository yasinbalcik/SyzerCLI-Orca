'use strict';
// Builds small anchor fixtures from an EXTRACTED pristine Orca bundle tree, so test/anchors.test.js can check
// (offline, in CI) that every patch group still matches the real minified text.
//
//   node scripts/make-fixtures.js <path-to-extracted-out-dir> --version=1.4.224
//   (or env ORCA_OUT / ORCA_VERSION; <dir> may be the `out` dir itself or its parent)
//
// Output: test/fixtures/<version>/<sanitized-target>.txt + index.json
// A fixture is the concatenation of (merged) windows around every anchor match in that target file. Matches whose `to`
// reads the whole source (m[m.length-1]) additionally get the whole enclosing function (and the functions named by
// capture groups), so Muse-derived builders (usage pane / overview / keys) can be regenerated from the fixture.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CMD = '"syzer"';
const WIN = 600;
const SEP = '\n/*--fixture-window--*/\n';
const FIXTURES = path.join(__dirname, '..', 'test', 'fixtures');

// ---- engine semantics (mirror of buildPatched in src/orca-patch.js) ----
const countOf = (text, from) => (from instanceof RegExp ? (text.match(new RegExp(from.source, `${from.flags.replace('g', '')}g`)) || []).length : text.split(from).length - 1);
const keyOf = (ed) => crypto.createHash('sha1').update(`${ed.group}\u0000${ed.file ? `file:${ed.file}` : `glob:${ed.glob.source}`}\u0000${ed.from instanceof RegExp ? `re:${ed.from.source}/${ed.from.flags}` : `s:${ed.from}`}`).digest('hex').slice(0, 12);
const fixtureName = (target) => `${target.replace(/[^\w.-]+/g, '__')}.txt`;

function listFiles(root) {
  const out = [];
  (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else out.push(path.relative(root, p).split(path.sep).join('/')); } })(root);
  return out;
}

function matchOf(text, from) {
  if (from instanceof RegExp) { const m = new RegExp(from.source, from.flags.replace('g', '')).exec(text); return m && { index: m.index, len: m[0].length, groups: m }; }
  const i = text.indexOf(from);
  return i < 0 ? null : { index: i, len: from.length, groups: [from] };
}

// regions (as [start,end)) a match needs beyond its own window
function extraRegions(text, ed, mt, extractFn) {
  const regions = [];
  if (typeof ed.to !== 'function' || !/m\.length|last\(m\)|off\(m\)/.test(ed.to.toString())) return regions;
  // alias-voting scans over the whole source (e.g. keys: top(/.../g)): keep a few sample occurrences of each scanned pattern
  for (const lit of ed.to.toString().matchAll(/\/((?:\\.|[^\/\\\n])+)\/g[,)]/g)) {
    let re; try { re = new RegExp(lit[1], 'g'); } catch { continue; }
    let k = 0;
    for (const x of text.matchAll(re)) { if (k++ >= 3) break; regions.push([Math.max(0, x.index - 40), Math.min(text.length, x.index + x[0].length + 40)]); }
  }
  const tryFn = (start) => { try { const s = extractFn(text, start); regions.push([start, start + s.length]); } catch { /* keep window only */ } };
  tryFn(mt.index);
  for (let i = 1; i < mt.groups.length; i++) {
    const g = mt.groups[i];
    if (typeof g !== 'string' || !/^[\w$]+$/.test(g)) continue;
    for (const pre of [`function ${g}(`, `async function ${g}(`]) { const at = text.indexOf(pre); if (at >= 0) { tryFn(at); break; } }
  }
  return regions;
}

function build(outDir, version) {
  const patch = require('../src/orca-patch');
  const { extractFn } = require('../src/orca-analytics-edits');
  const root = fs.existsSync(path.join(outDir, 'out')) ? outDir : path.dirname(outDir);
  const files = listFiles(root);
  const cache = new Map();
  const read = (f) => { if (!cache.has(f)) cache.set(f, fs.readFileSync(path.join(root, f), 'utf8')); return cache.get(f); };
  const regions = new Map(); // target -> [[a,b]]
  const index = [];
  const problems = [];
  const edits = patch.edits(CMD);
  edits.forEach((ed, i) => {
    let targets = files.filter((f) => (ed.file ? f === ed.file : ed.glob.test(f)));
    if (ed.glob && targets.length > 1) targets = targets.filter((f) => countOf(read(f), ed.from) > 0);
    if (targets.length !== 1) { problems.push(`#${i} ${ed.group}: target ${ed.file || ed.glob} resolved to ${targets.length}`); return; }
    const t = targets[0];
    const text = read(t);
    const n = countOf(text, ed.from);
    if (n !== 1) { problems.push(`#${i} ${ed.group}: anchor matched ${n}x in ${t}`); return; }
    const mt = matchOf(text, ed.from);
    const list = regions.get(t) || [];
    list.push([Math.max(0, mt.index - WIN), Math.min(text.length, mt.index + mt.len + WIN)]);
    for (const [a, b] of extraRegions(text, ed, mt, extractFn)) list.push([Math.max(0, a - 50), Math.min(text.length, b + 50)]);
    regions.set(t, list);
    index.push({ key: keyOf(ed), group: ed.group, target: t, fixture: fixtureName(t), edit: i });
  });
  const dir = path.join(FIXTURES, version);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  const sizes = {};
  for (const [t, list] of regions) {
    list.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of list) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
    const text = read(t);
    const body = merged.map(([a, b]) => text.slice(a, b)).join(SEP);
    fs.writeFileSync(path.join(dir, fixtureName(t)), body);
    sizes[t] = body.length; total += body.length;
  }
  fs.writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify({ orcaVersion: version, cmd: CMD, entries: index }, null, 1)}\n`);
  return { dir, total, sizes, count: index.length, of: edits.length, problems };
}

module.exports = { countOf, keyOf, fixtureName, matchOf, SEP, CMD, FIXTURES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const outDir = args.find((a) => !a.startsWith('--')) || process.env.ORCA_OUT;
  let version = (args.find((a) => a.startsWith('--version=')) || '').slice(10) || process.env.ORCA_VERSION;
  if (!outDir) { console.error('usage: node scripts/make-fixtures.js <extracted-out-dir> --version=<orca version>'); process.exit(2); }
  if (!version) {
    for (const d of [outDir, path.dirname(outDir)]) { try { version = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).version; break; } catch { /* next */ } }
  }
  if (!version) { console.error('Orca version unknown: pass --version=x.y.z'); process.exit(2); }
  const r = build(path.resolve(outDir), version);
  console.log(`${r.count}/${r.of} edits fixtured -> ${r.dir}  (${(r.total / 1024).toFixed(1)} KB)`);
  for (const [t, s] of Object.entries(r.sizes)) console.log(`  ${(s / 1024).toFixed(1).padStart(7)} KB  ${t}`);
  for (const p of r.problems) console.log('  PROBLEM', p);
  if (r.problems.length) process.exitCode = 1;
}
