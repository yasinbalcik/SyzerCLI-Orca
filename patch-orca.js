'use strict';

// Orca'nın Usage panelindeki "Kimi" kutusunu SyzerCLI'a çevirir (veri: `syzer usage --summary --json`).
//   node patch-orca.js build   → yamalı app.asar'ı staging'e üretir (Orca açıkken güvenli)
//   node patch-orca.js apply   → Orca kapalıyken yamalı asar'ı yerine koyar (yedek: app.asar.syzer-orig)
//   node patch-orca.js restore → yedeği geri koyar
//   node patch-orca.js status  → durum
// Orca güncellenince app.asar değişir ve yama silinir: `build` + `apply` tekrar çalıştırın.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const asar = require('@electron/asar');

const ORCA = process.env.ORCA_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'orca');
const RES = path.join(ORCA, 'resources');
const ASAR = path.join(RES, 'app.asar');
const BACKUP = `${ASAR}.syzer-orig`;
const STAGE = path.join(__dirname, 'staging');
const STAGED = path.join(STAGE, 'app.asar');
const UNPACKED = `${ASAR}.unpacked`;

// Kimi alıcısını (main süreç) syzer çıktısıyla değiştir: sağlayıcı başına bir çubuk + toplam ortalama çubuğu
const MAIN_FETCH = 'return(async()=>{const cp=process.getBuiltinModule?process.getBuiltinModule(`child_process`):require(`child_process`);' +
  'const base={provider:`kimi`,weekly:null,updatedAt:Date.now()};' +
  'return await new Promise(r=>cp.execFile(process.env.SYZER_BIN||`syzer`,[`usage`,`--summary`,`--json`],{timeout:20000,shell:true,windowsHide:true,maxBuffer:1<<20},(err,out)=>{' +
  'if(err)return r({...base,session:null,error:`syzer: `+String(err.message).split(`\n`)[0],status:`error`});' +
  'try{const j=JSON.parse(out);const ps=(j.providers||[]).filter(p=>p.percent_used!=null);' +
  'if(!ps.length)return r({...base,session:null,error:`No quota info (${j.keys_ready}/${j.keys_total} keys ready)`,status:`unavailable`});' +
  'const reset=ps.map(p=>p.resets_at?Date.parse(p.resets_at):null).filter(Boolean).sort()[0]||Date.now()+864e5;' +
  'const mk=(name,u,rd,ra)=>({name,usedPercent:u,windowMinutes:1440,resetsAt:ra,resetDescription:rd});' +
  'const total=mk(`Total`,Math.round(ps.reduce((a,p)=>a+p.percent_used,0)/ps.length),`${j.keys_ready}/${j.keys_total} keys ready`,reset);' +
  'const buckets=[...ps.map(p=>mk(p.name,p.percent_used,`${p.keys_ready}/${p.keys_total} keys ready`,p.resets_at?Date.parse(p.resets_at):reset)),total];' +
  'r({...base,session:total,buckets,error:null,status:`ok`})}' +
  'catch(e){r({...base,session:null,error:`syzer: bad JSON`,status:`error`})}}))})();';

const ICON = `data:image/svg+xml;base64,${fs.readFileSync(path.join(__dirname, 'syzer-icon.svg')).toString('base64')}`;
const icon = (size) => `(0,J.jsx)(\`img\`,{src:\`${ICON}\`,width:${size},height:${size},alt:\`Syzer\`,style:{borderRadius:3}})`;

const EDITS = [
  { glob: /^out\/renderer\/assets\/StatusBar-.*\.js$/, from: 'e===`kimi`?(0,J.jsx)(G,{agent:`kimi`,size:13})', to: `e===\`kimi\`?${icon(13)}` },
  { glob: /^out\/renderer\/assets\/StatusBar-.*\.js$/, from: '(0,J.jsx)(G,{agent:`kimi`,size:14})', to: icon(14) },
  { file: 'out/main/index.js', from: 'fetchKimiWithResolvedHome(){', to: `fetchKimiWithResolvedHome(){${MAIN_FETCH}` },
  { glob: /^out\/renderer\/assets\/StatusBar-.*\.js$/, from: 'e===`kimi`?`Kimi`:', to: 'e===`kimi`?`Syzer`:' },
  { glob: /^out\/renderer\/assets\/StatusBar-.*\.js$/, from: '`Kimi Usage`', to: '`Syzer Usage`' },
  { glob: /^out\/renderer\/assets\/StatusBar-.*\.js$/, from: 'case`kimi`:return`K`', to: 'case`kimi`:return`S`' },
  // Kimi CLI kurulu değilse Orca satırı gizliyor; SyzerCLI için her zaman göster
  { glob: /^out\/renderer\/assets\/status-bar-agent-gating-.*\.js$/, from: '`gemini`,`kimi`,`antigravity`,`grok`,`zcode`]);function D', to: '`gemini`,`antigravity`,`grok`,`zcode`]);function D' },
  { glob: /^out\/renderer\/assets\/StatusBar-.*\.js$/, from: 'e===`zcode`?t.zcodePlanApiKeyConfigured===!0:!1:!1}', to: 'e===`zcode`?t.zcodePlanApiKeyConfigured===!0:e===`kimi`||!1:!1}' },
];

const orcaRunning = () => { try { return /orca\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq Orca.exe" /NH', { encoding: 'utf8' })); } catch { return false; } };
const walk = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name)).split(path.sep).join('/')]));

function unpackedFiles(file) {
  const out = [];
  const rec = (node, p) => { for (const [k, v] of Object.entries(node.files || {})) { const q = p ? `${p}/${k}` : k; if (v.files) rec(v, q); else if (v.unpacked) out.push(q); } };
  rec(asar.getRawHeader(file).header, '');
  return out.sort();
}

const readOrig = (p) => fs.readFileSync(fs.existsSync(`${p}.syzer-orig`) ? `${p}.syzer-orig` : p, 'utf8');
const align4 = (n) => (n + 3) & ~3;
const sha = (b) => require('crypto').createHash('sha256').update(b).digest('hex');
function integrity(buf) {
  const BS = 4 * 1024 * 1024;
  const blocks = [];
  for (let i = 0; i < buf.length; i += BS) blocks.push(sha(buf.subarray(i, i + BS)));
  return { algorithm: 'SHA256', hash: sha(buf), blockSize: BS, blocks: blocks.length ? blocks : [sha(Buffer.alloc(0))] };
}

// asar'ı yeniden paketlemeden yerinde yamar: yamalı dosyalar veri bölümünün sonuna eklenir, başlık güncellenir
// (offsetler veri bölümüne göre göreli olduğundan diğer dosyalar ve app.asar.unpacked olduğu gibi kalır)
async function build() {
  const src = fs.existsSync(BACKUP) ? BACKUP : ASAR; // her zaman yamasız orijinalden üret
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  const raw = fs.readFileSync(src);
  const headerSize = raw.readUInt32LE(4);
  const jsonLen = raw.readUInt32LE(12);
  if (raw.readUInt32LE(8) !== 4 + align4(jsonLen) || headerSize !== 4 + raw.readUInt32LE(8)) throw new Error('unexpected asar header layout');
  const header = JSON.parse(raw.subarray(16, 16 + jsonLen).toString('utf8'));
  const dataStart = 8 + headerSize;
  const data = [raw.subarray(dataStart)];
  let dataLen = raw.length - dataStart;

  const all = [];
  (function rec(node, p) { for (const [k, v] of Object.entries(node.files || {})) { const q = p ? `${p}/${k}` : k; if (v.files) rec(v, q); else all.push(q); } })(header, '');
  const node = (p) => p.split('/').reduce((n, k) => n.files[k], header);

  const edited = new Map();
  for (const ed of EDITS) {
    const targets = all.filter((f) => (ed.file ? f === ed.file : ed.glob.test(f)));
    if (targets.length !== 1) throw new Error(`anchor file not found/ambiguous: ${ed.file || ed.glob} (${targets.length}) — Orca changed; update EDITS`);
    const f = targets[0];
    const cur = edited.get(f) || (node(f).unpacked ? readOrig(path.join(UNPACKED, ...f.split('/'))) : asar.extractFile(src, f.split('/').join(path.sep)).toString('utf8'));
    const n = cur.split(ed.from).length - 1;
    if (n !== 1) throw new Error(`anchor "${ed.from}" matched ${n}× in ${f} — Orca changed; update EDITS`);
    edited.set(f, cur.replace(ed.from, () => ed.to));
    console.log(`patched ${f}`);
  }
  for (const [f, text] of edited) {
    const buf = Buffer.from(text, 'utf8');
    const e = node(f);
    if (e.integrity) e.integrity = integrity(buf);
    e.size = buf.length;
    if (e.unpacked) { // diskte duran dosya: staging/unpacked altına yazılır, apply ile yerine konur
      const out = path.join(STAGE, 'unpacked', ...f.split('/'));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
      continue;
    }
    e.offset = String(dataLen);
    data.push(buf);
    dataLen += buf.length;
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const head = Buffer.alloc(16 + align4(json.length));
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(4 + 4 + align4(json.length), 4);
  head.writeUInt32LE(4 + align4(json.length), 8);
  head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  fs.writeFileSync(STAGED, Buffer.concat([head, ...data]));
  // doğrulama: yamalı dosya okunabiliyor, diğerleri aynı
  for (const [f, text] of edited) if (!node(f).unpacked && asar.extractFile(STAGED, f.split('/').join(path.sep)).toString('utf8') !== text) throw new Error(`verify failed: ${f}`);
  const probe = all.find((f) => !edited.has(f) && !node(f).unpacked);
  if (!asar.extractFile(STAGED, probe.split('/').join(path.sep)).equals(asar.extractFile(src, probe.split('/').join(path.sep)))) throw new Error('verify failed: untouched file differs');
  console.log(`built ${STAGED} (${(fs.statSync(STAGED).size / 1048576).toFixed(1)} MB)`);
}

const staged = () => (fs.existsSync(path.join(STAGE, 'unpacked')) ? walk(path.join(STAGE, 'unpacked')) : []);

function apply() {
  if (!fs.existsSync(STAGED)) throw new Error('run "build" first');
  if (orcaRunning()) throw new Error('Orca is running — close it completely, then run apply again');
  if (!fs.existsSync(BACKUP)) fs.copyFileSync(ASAR, BACKUP);
  for (const f of staged()) {
    const dst = path.join(UNPACKED, ...f.split('/'));
    if (!fs.existsSync(`${dst}.syzer-orig`)) fs.copyFileSync(dst, `${dst}.syzer-orig`);
    fs.copyFileSync(path.join(STAGE, 'unpacked', ...f.split('/')), dst);
  }
  fs.copyFileSync(STAGED, ASAR);
  console.log('applied. Start Orca; Usage → "Syzer" (the former Kimi slot).');
}

function restore() {
  if (orcaRunning()) throw new Error('Orca is running — close it first');
  if (!fs.existsSync(BACKUP)) throw new Error('no backup found');
  fs.copyFileSync(BACKUP, ASAR);
  for (const f of staged()) {
    const dst = path.join(UNPACKED, ...f.split('/'));
    if (fs.existsSync(`${dst}.syzer-orig`)) fs.copyFileSync(`${dst}.syzer-orig`, dst);
  }
  console.log('restored original files');
}

const cmd = process.argv[2];
(async () => {
  if (cmd === 'build') await build();
  else if (cmd === 'apply') apply();
  else if (cmd === 'restore') restore();
  else if (cmd === 'status') console.log({ orca: ORCA, asar: fs.existsSync(ASAR), backup: fs.existsSync(BACKUP), staged: fs.existsSync(STAGED), orcaRunning: orcaRunning() });
  else console.log('usage: node patch-orca.js build|apply|restore|status');
})().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
