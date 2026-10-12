#!/usr/bin/env node
'use strict';
// Canary: en son Orca sürümüne karşı yama çapalarını (anchor) kuru çalıştırır; hangi grupların atlanacağını yazar.
// Hiçbir şeye yazmaz (asar'a dokunmaz). Bağımlılıksız.
//
// Kullanım:
//   ORCA_ASAR=<app.asar yolu | çıkarılmış Orca dizini> node scripts/canary.js [--json] [--out sonuc.json]
//   node scripts/canary.js            (ORCA_ASAR yoksa: GitHub'dan en son Linux .deb indirilir, dpkg-deb ile açılır; Linux gerekir)
// Çıkış: 0 = tüm gruplar uygulanır, 2 = en az bir grup atlanır / çekirdek bozuk, 1 = hata (indirme/açma).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = 'stablyai/orca';
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const optVal = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

function findAsar(p) {
  if (!fs.existsSync(p)) return null;
  if (fs.statSync(p).isFile()) return p;
  const stack = [p];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) stack.push(f);
      else if (e.name === 'app.asar') return f;
    }
  }
  return null;
}

async function download() {
  if (process.platform !== 'linux') throw new Error('indirme modu yalnızca Linux (dpkg-deb); başka platformda ORCA_ASAR kullanın');
  const headers = { 'User-Agent': 'syzer-orca-canary', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const rel = await (await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers })).json();
  if (!rel || !Array.isArray(rel.assets)) throw new Error(`release bilgisi alınamadı: ${JSON.stringify(rel).slice(0, 200)}`);
  const asset = rel.assets.find((a) => /^orca-ide_.*_amd64\.deb$/.test(a.name));
  if (!asset) throw new Error(`amd64 .deb varlığı bulunamadı (${rel.assets.map((a) => a.name).join(', ')})`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-canary-'));
  const deb = path.join(work, asset.name);
  console.error(`indiriliyor: ${asset.name} (${rel.tag_name})`);
  const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'syzer-orca-canary' } });
  if (!res.ok) throw new Error(`indirme başarısız: HTTP ${res.status}`);
  fs.writeFileSync(deb, Buffer.from(await res.arrayBuffer()));
  const out = path.join(work, 'x');
  fs.mkdirSync(out);
  const r = spawnSync('dpkg-deb', ['-x', deb, out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`dpkg-deb başarısız: ${(r.stderr || r.error || '').toString().trim()}`);
  const asar = findAsar(out);
  if (!asar) throw new Error('açılan pakette app.asar bulunamadı');
  return { asar, tag: rel.tag_name };
}

function dryRun(asarFile) {
  const patch = require('../src/orca-patch');
  // yedek (app.asar.syzer-orig) verilirse unpacked kökü asıl app.asar.unpacked'dır ve .syzer-orig kopyaları öncelikli
  const unpackedRoot = `${asarFile.replace(/\.syzer-orig$/, '')}.unpacked`;
  const unpackedSrc = (f) => { const p = path.join(unpackedRoot, ...f.split('/')); return fs.existsSync(`${p}.syzer-orig`) ? `${p}.syzer-orig` : p; };
  const a = patch.openAsar(asarFile);
  let version = null;
  try { version = JSON.parse(a.read('package.json').toString('utf8')).version; } finally { a.close(); }
  const res = { orcaVersion: version, applied: [], skipped: [], coreBroken: null };
  try {
    const built = patch.buildPatched(null, asarFile, unpackedSrc, 'syzer');
    res.skipped = built.skipped.map((s) => { const m = s.match(/^([\w-]+) \(([\s\S]*)\)$/); return m ? { group: m[1], reason: m[2] } : { group: s, reason: '' }; });
    res.applied = built.groupNames.filter((n) => !res.skipped.some((s) => s.group === n));
  } catch (e) {
    res.coreBroken = e.message; // çekirdek grup bozuksa buildPatched fırlatır
    res.skipped = [{ group: 'core', reason: e.message }];
  }
  return res;
}

(async () => {
  let asar = process.env.ORCA_ASAR && findAsar(process.env.ORCA_ASAR);
  let tag = null;
  if (process.env.ORCA_ASAR && !asar) throw new Error(`ORCA_ASAR içinde app.asar bulunamadı: ${process.env.ORCA_ASAR}`);
  if (!asar) ({ asar, tag } = await download());
  const res = dryRun(asar);
  res.tag = tag;
  const outFile = optVal('--out');
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(res, null, 2));
  if (flag('--json')) console.log(JSON.stringify(res, null, 2));
  else {
    console.log(`Orca ${res.orcaVersion}${tag ? ` (${tag})` : ''}: ${res.applied.length} grup uygulanır, ${res.skipped.length} atlanır`);
    for (const g of res.applied) console.log(`  OK   ${g}`);
    for (const g of res.skipped) console.log(`  SKIP ${g.group} - ${g.reason}`);
  }
  process.exitCode = res.skipped.length ? 2 : 0;
})().catch((e) => { console.error(`canary hata: ${e.message}`); process.exitCode = 1; });
