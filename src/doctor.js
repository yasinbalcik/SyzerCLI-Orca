'use strict';
// syzer-orca doctor: salt-okunur tanı. Orca açıkken de güvenle çalışır (hiçbir dosyaya yazmaz).
// Çıkış kodu: 0 = tüm gruplar uygulanmış, 2 = en az bir grup atlanmış / yama yok, 1 = hata.
const fs = require('fs');
const { spawnSync } = require('child_process');
const pkg = require('../package.json');
const patch = require('./orca-patch');

// "usage (anchor ... matched 0× in ...)" -> { group, reason }
function parseSkipped(s) {
  const m = String(s).match(/^([\w-]+) \(([\s\S]*)\)$/);
  return m ? { group: m[1], reason: m[2] } : { group: String(s), reason: '' };
}

function taskPresent() {
  if (process.platform !== 'win32') return null;
  try {
    const r = spawnSync('schtasks', ['/Query', '/TN', patch.TASKS[0]], { encoding: 'utf8' });
    return r.status === 0;
  } catch { return null; }
}

function tailLog(n = 8) {
  try { return fs.readFileSync(patch.LOG, 'utf8').split(/\r?\n/).filter(Boolean).slice(-n); } catch { return []; }
}

function collect() {
  const r = { plugin: pkg.version, patchVersion: patch.PATCH_VERSION, platform: process.platform };
  const dir = patch.locate();
  r.orcaDir = dir;
  if (!dir) { r.error = 'Orca bulunamadı (ORCA_DIR ile belirtilebilir)'; r.task = taskPresent(); r.log = tailLog(); return r; }
  r.running = patch.orcaRunning();
  try {
    const i = patch.inspect(dir);
    r.orcaVersion = i.orcaVersion;
    r.patched = !!i.marker;
    const want = patch.markerOf(patch.selfCmd()).match(/:(\d+):([0-9a-f]{8})\*/);
    r.upToDate = !!i.marker && i.marker.v === Number(want[1]) && i.marker.h === want[2];
  } catch (e) { r.error = e.message; }
  const g = patch.readGroups();
  if (g) {
    r.groupsAt = g.at ? new Date(g.at).toISOString() : null;
    r.groupsOrcaVersion = g.orcaVersion;
    r.groupsStale = !!(r.orcaVersion && g.orcaVersion !== r.orcaVersion);
    r.groups = [
      ...(g.applied || []).map((n) => ({ group: n, status: 'applied' })),
      ...(g.skipped || []).map((s) => ({ ...parseSkipped(s), status: 'skipped' })),
    ];
  } else r.groups = [];
  r.task = taskPresent();
  r.log = tailLog();
  return r;
}

function exitCodeOf(r) {
  if (r.error) return 1;
  if (!r.patched || r.groupsStale || !r.groups.length) return 2;
  return r.groups.some((g) => g.status === 'skipped') ? 2 : 0;
}

function render(r) {
  const yn = (v, a = 'evet', b = 'hayır') => (v === null || v === undefined ? '?' : v ? a : b);
  const L = [];
  L.push(`syzer-orca doctor  (eklenti v${r.plugin}, yama sürümü ${r.patchVersion})`, '');
  L.push(`Orca dizini      : ${r.orcaDir || '-'}`);
  L.push(`Orca sürümü      : ${r.orcaVersion || '-'}`);
  L.push(`Yamalı           : ${r.patched === undefined ? '?' : yn(r.patched)}`);
  L.push(`Güncel (marker)  : ${r.upToDate === undefined ? '?' : yn(r.upToDate)}`);
  L.push(`Orca çalışıyor   : ${yn(r.running)}`);
  L.push(`Zamanlanmış görev: ${r.task === null ? 'n/a (Windows değil)' : yn(r.task, 'var', 'YOK')}`);
  if (r.error) L.push(`HATA             : ${r.error}`);
  L.push('', 'Gruplar:');
  if (!r.groups || !r.groups.length) L.push('  (bilgi yok: henüz yama uygulanmamış)');
  else {
    if (r.groupsStale) L.push(`  ! groups.json Orca ${r.groupsOrcaVersion} için; mevcut Orca ${r.orcaVersion} (bayat)`);
    for (const g of r.groups) L.push(`  ${g.status === 'applied' ? 'OK  ' : 'SKIP'} ${g.group}${g.reason ? `  - ${g.reason.length > 110 ? `${g.reason.slice(0, 107)}...` : g.reason}` : ''}`);
  }
  L.push('', 'patch.log (son satırlar):');
  if (!r.log.length) L.push('  (boş)'); else for (const l of r.log) L.push(`  ${l}`);
  return L.join('\n');
}

function run({ json = false } = {}) {
  let r;
  try { r = collect(); } catch (e) { r = { plugin: pkg.version, error: e.message, groups: [], log: [] }; }
  r.exitCode = exitCodeOf(r);
  console.log(json ? JSON.stringify(r, null, 2) : render(r));
  process.exitCode = r.exitCode;
  return r;
}

module.exports = { run, collect, render, exitCodeOf, parseSkipped };
