'use strict';

// Orca entegrasyonu: Orca'nın kendi dosyalarına (app.asar) küçük, geri alınabilir yamalar uygular.
//   Usage paneli/durum çubuğu (Kimi yuvası → Syzer), ajan menüsü (Autohand yuvası → Syzer),
//   oturum geçmişi etiketi ve "devam et" komutu.
// Bağımlılıksız. Idempotent: kendi işaretini (marker) okuyarak yalnızca gerektiğinde çalışır; Orca açıkken dokunmaz.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { spawnSync } = require('child_process');
const platforms = { win32: require('./platform/win32'), darwin: require('./platform/darwin'), linux: require('./platform/linux') };

const PATCH_VERSION = 11;
const ROOT = process.env.SYZER_HOME || path.join(os.homedir(), '.syzercli');
const HOME = path.join(ROOT, 'orca');
const CLI_FILE = path.join(HOME, 'cli.json'); // Orca'nın çağıracağı Syzer komutu (köprü kurulum sırasında yazar)
const LOG = path.join(HOME, 'patch.log');
const STATE_FILE = path.join(HOME, 'patch-state.json'); // {state:'writing'|'done', appliedAt, marker, launchesSinceApply, orcaVersion}
const TASKS = platforms.win32.TASKS;

const ICON = `data:image/png;base64,${(() => { try { return fs.readFileSync(path.join(__dirname, '..', 'assets', 'syzer-icon.png')).toString('base64'); } catch { return ''; } })()}`;

// Syzer'ı çalıştıracak komut (Orca ana süreci bunu çağırır): exe ise exe, değilse node + syzer.js
// Eklenti CLI'dan bağımsızdır: komutu köprüden (SYZER_CLI_CMD) alır, kurulumda cli.json'a yazar; yoksa PATH'teki `syzer`.
function selfCmd() {
  const env = process.env.SYZER_CLI_CMD;
  if (env) { try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(CLI_FILE, JSON.stringify({ cmd: env, at: Date.now() })); } catch { /* önemsiz */ } return env; }
  try { const j = JSON.parse(fs.readFileSync(CLI_FILE, 'utf8')); if (j && typeof j.cmd === 'string' && j.cmd) return j.cmd; } catch { /* yok */ }
  return 'syzer';
}

// Yama kaynağının özeti: orca-edits*/snippet dosyaları değişince işaret kendiliğinden değişir (PATCH_VERSION artırmayı unutmak yamayı bayatlatamaz)
function sourceHash() {
  const h = crypto.createHash('sha1');
  const files = [];
  for (const f of fs.readdirSync(__dirname)) if (/^orca-(edits|analytics)[\w-]*\.js$/.test(f)) files.push(path.join(__dirname, f));
  try { const sd = path.join(__dirname, 'orca-snippets'); for (const f of fs.readdirSync(sd)) files.push(path.join(sd, f)); } catch { /* yok */ }
  const CRLF = String.fromCharCode(13, 10), LF = String.fromCharCode(10); // satır sonundan bağımsız: CRLF çalışma kopyası = LF paket
  for (const f of files.sort()) { try { h.update(path.basename(f)).update(fs.readFileSync(f, 'utf8').split(CRLF).join(LF)); } catch { /* önemsiz */ } }
  return h.digest('hex');
}
const markerOf = (cmd) => `/*syzer-orca:${PATCH_VERSION}:${crypto.createHash('sha1').update(cmd).update(sourceHash()).update(`skip:${skipList().join(',')}`).digest('hex').slice(0, 8)}*/`;
// Hata ayıklama: bazı yama gruplarını kalıcı olarak atla (syzer orca skip restore,usage). Boş = hepsi uygulanır.
const SKIP_FILE = path.join(os.homedir(), '.syzercli', 'orca', 'skip-groups.txt');
const skipList = () => { try { return fs.readFileSync(SKIP_FILE, 'utf8').split(/[\s,]+/).filter(Boolean); } catch { return []; } };
const GROUPS_FILE = path.join(os.homedir(), '.syzercli', 'orca', 'groups.json');
const readGroups = () => { try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')); } catch { return null; } };
const edits = (cmd) => require('./orca-edits').edits(cmd, ICON, markerOf(cmd));

// ---------- asar (bağımlılıksız) ----------
const align4 = (n) => (n + 3) & ~3;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function integrity(buf) {
  const BS = 4 * 1024 * 1024;
  const blocks = [];
  for (let i = 0; i < buf.length; i += BS) blocks.push(sha(buf.subarray(i, i + BS)));
  return { algorithm: 'SHA256', hash: sha(buf), blockSize: BS, blocks: blocks.length ? blocks : [sha(Buffer.alloc(0))] };
}

function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  const h = Buffer.alloc(16);
  fs.readSync(fd, h, 0, 16, 0);
  const headerSize = h.readUInt32LE(4);
  const jsonLen = h.readUInt32LE(12);
  if (h.readUInt32LE(0) !== 4 || h.readUInt32LE(8) !== 4 + align4(jsonLen) || headerSize !== 4 + h.readUInt32LE(8)) { fs.closeSync(fd); throw new Error('unexpected asar header layout'); }
  const jb = Buffer.alloc(jsonLen);
  fs.readSync(fd, jb, 0, jsonLen, 16);
  const header = JSON.parse(jb.toString('utf8'));
  const dataStart = 8 + headerSize;
  const size = fs.fstatSync(fd).size;
  const files = [];
  (function rec(node, p) { for (const [k, v] of Object.entries(node.files || {})) { const q = p ? `${p}/${k}` : k; if (v.files) rec(v, q); else files.push(q); } })(header, '');
  const node = (p) => p.split('/').reduce((n, k) => n.files[k], header);
  return {
    header, files, node, dataStart, dataLen: size - dataStart,
    read(p) { const e = node(p); const b = Buffer.alloc(e.size); fs.readSync(fd, b, 0, e.size, dataStart + Number(e.offset)); return b; },
    copyData() { const b = Buffer.alloc(size - dataStart); fs.readSync(fd, b, 0, b.length, dataStart); return b; },
    close() { fs.closeSync(fd); },
  };
}

function writeAsar(out, header, dataBuf, extra) {
  let dataLen = dataBuf.length;
  const parts = [dataBuf];
  for (const { entry, buf } of extra) { entry.offset = String(dataLen); parts.push(buf); dataLen += buf.length; }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const head = Buffer.alloc(16 + align4(json.length));
  head.writeUInt32LE(4, 0); head.writeUInt32LE(8 + align4(json.length), 4); head.writeUInt32LE(4 + align4(json.length), 8); head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  fs.writeFileSync(out, Buffer.concat([head, ...parts]));
}

// ---------- Orca bulma / durum ----------
const log = (m) => { try { fs.mkdirSync(HOME, { recursive: true }); fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`); if (fs.statSync(LOG).size > 200000) fs.writeFileSync(LOG, ''); } catch { /* önemsiz */ } };

// kaynak klasörü: Windows/Linux "resources", macOS "Resources" (Contents altında)
const resourcesOf = (dir) => ['resources', 'Resources'].map((n) => path.join(dir, n)).find((d) => fs.existsSync(path.join(d, 'app.asar'))) || path.join(dir, 'resources');
// opts: { platform, env, home } (test için enjekte edilebilir)
function locate(opts = {}) {
  const platform = opts.platform || process.platform;
  const pm = platforms[platform];
  if (!pm) return null;
  const cands = pm.locateCandidates(opts.env || process.env, opts.home || os.homedir());
  for (const d of cands) if (fs.existsSync(path.join(resourcesOf(d), 'app.asar'))) return d;
  return null;
}
function orcaRunning(opts = {}) {
  if (process.env.SYZER_ORCA_SKIP_RUNNING_CHECK) return false;
  const pm = platforms[opts.platform || process.platform];
  if (!pm) return false;
  try { return !!pm.runningCheck(opts.run || spawnSync); } catch { return false; }
}
const markerRe = /\/\*syzer-orca:(\d+):([0-9a-f]{8})\*\//;

function paths(dir) {
  const asarFile = path.join(resourcesOf(dir), 'app.asar');
  return { asarFile, backup: `${asarFile}.syzer-orig`, meta: `${asarFile}.syzer-orig.json`, unpacked: `${asarFile}.unpacked` };
}

// Mevcut asar: işaret + (sürüm) bilgisini oku
function inspect(dir) {
  const P = paths(dir);
  const a = openAsar(P.asarFile);
  try {
    const main = a.read('out/main/index.js').toString('utf8');
    const m = main.match(markerRe);
    const pkg = JSON.parse(a.read('package.json').toString('utf8'));
    return { marker: m ? { v: Number(m[1]), h: m[2] } : null, orcaVersion: pkg.version };
  } finally { a.close(); }
}

function status() {
  const dir = locate();
  if (!dir) return { found: false };
  try {
    const cmd = selfCmd();
    const i = inspect(dir);
    const want = markerOf(cmd).match(markerRe);
    const applied = !!i.marker && i.marker.v === Number(want[1]) && i.marker.h === want[2];
    const g = readGroups();
    return { found: true, dir, orcaVersion: i.orcaVersion, patched: !!i.marker, upToDate: applied, running: orcaRunning(), ...(g && g.orcaVersion === i.orcaVersion ? { groups: g.applied, skippedGroups: g.skipped } : {}) };
  } catch (e) { return { found: true, dir, error: e.message }; }
}

// ---------- yamayı uygula ----------
// from: TAM metin ya da RegExp (minify isimleri sürümler arası değişir); RegExp ise to(m) fonksiyonu yakalama gruplarını alır
const count = (text, from) => (from instanceof RegExp ? (text.match(new RegExp(from.source, `${from.flags.replace("g", "")}g`)) || []).length : text.split(from).length - 1);


// opts: { skip: Set (çalışma zamanı atlanacak gruplar; core atlanamaz), edits: yama listesi (varsayılan: edits(cmd)) }
// history: dosya -> [{group:null,text:orijinal}, {group,text}, ...] (sözdizimi doğrulamada suçlu grubu bulmak için)
function buildPatched(dir, srcAsar, unpackedSrc, cmd, opts = {}) {
  const a = openAsar(srcAsar);
  try {
    const edited = new Map();
    const history = new Map();
    const read = (f) => edited.get(f) ?? (a.node(f).unpacked ? fs.readFileSync(unpackedSrc(f), 'utf8') : a.read(f).toString('utf8'));
    const groups = new Map();
    for (const ed of (opts.edits || edits(cmd))) { if (!groups.has(ed.group)) groups.set(ed.group, []); groups.get(ed.group).push(ed); }
    const skipped = [];
    for (const [name, list] of groups) {
      if (name !== 'core' && skipList().includes(name)) { skipped.push(`${name} (skipped by user)`); continue; }
      if (name !== 'core' && opts.skip && opts.skip.has(name)) continue; // çalışma zamanı atlaması: çağıran kaydeder
      const snapshot = new Map(edited);
      const orig = new Map();
      try {
        for (const ed of list) {
          let targets = a.files.filter((f) => (ed.file ? f === ed.file : ed.glob.test(f)));
          if (ed.glob && targets.length > 1) targets = targets.filter((f) => count(read(f), ed.from) > 0);
          if (targets.length !== 1) throw new Error(`anchor file not found/ambiguous: ${ed.file || ed.glob} (${targets.length})`);
          const f = targets[0];
          const cur = read(f);
          const n = count(cur, ed.from);
          if (n !== 1) throw new Error(`anchor "${String(ed.from).slice(0, 60)}…" matched ${n}× in ${f}`);
          if (!orig.has(f)) orig.set(f, cur);
          edited.set(f, cur.replace(ed.from, (...m) => (typeof ed.to === 'function' ? ed.to(m) : ed.to)));
        }
        for (const [f, before] of orig) {
          if (!history.has(f)) history.set(f, [{ group: null, text: before }]);
          history.get(f).push({ group: name, text: edited.get(f) });
        }
      } catch (e) {
        if (name === 'core') throw e;
        edited.clear(); for (const [k, v] of snapshot) edited.set(k, v); // grubu geri al: yarım yama bırakma
        skipped.push(`${name} (${e.message})`);
      }
    }
    const header = JSON.parse(JSON.stringify(a.header));
    const nodeOf = (p) => p.split('/').reduce((n, k) => n.files[k], header);
    const extra = [];
    const unpacked = [];
    for (const [f, text] of edited) {
      const buf = Buffer.from(text, 'utf8');
      const e = nodeOf(f);
      if (e.integrity) e.integrity = integrity(buf);
      e.size = buf.length;
      if (e.unpacked) unpacked.push({ f, buf }); else extra.push({ entry: e, buf, f });
    }
    return { header, data: a.copyData(), extra, unpacked, skipped, groupNames: [...groups.keys()], texts: edited, history };
  } finally { a.close(); }
}

// ---------- yazmadan önce sözdizimi doğrulama ----------
// Main/preload: CommonJS (Electron bunları fonksiyon içine sarar) → vm.Script. Renderer: ES modülü → node --check (.mjs).
// Dönüş: null (geçerli) | hata iletisinin ilk satırı. Yalnızca JS dosyaları denetlenir.
const firstLine = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || 'syntax error';
function syntaxError(file, text, run = spawnSync) {
  if (!/\.(c|m)?js$/.test(file)) return null;
  const esm = /\.mjs$/.test(file) || /^out\/renderer\//.test(file);
  if (!esm) {
    try { new vm.Script(`(function (exports, require, module, __filename, __dirname) {${text}\n})`, { filename: file }); return null; } catch (e) { return firstLine(e && e.message); }
  }
  let tmp = null;
  try {
    tmp = path.join(os.tmpdir(), `syzer-orca-check-${process.pid}-${crypto.randomBytes(4).toString('hex')}.mjs`);
    fs.writeFileSync(tmp, text);
    const r = run(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    if (r && r.status === 0) return null;
    const err = String((r && r.stderr) || '').split(/\r?\n/).filter((l) => /Error/.test(l)).pop();
    return firstLine(err || (r && r.stderr) || (r && r.error && r.error.message));
  } finally { if (tmp) try { fs.rmSync(tmp, { force: true }); } catch { /* önemsiz */ } }
}

// buildPatched'ı sözdizimi geçerli olana dek yeniden çalıştırır; bozan grubu atlar. core bozarsa Error(code='SYNTAX_CORE') fırlatır.
function buildValidated(dir, srcAsar, unpackedSrc, cmd, opts = {}) {
  const run = opts.run || spawnSync;
  const skip = new Set();
  const dropped = [];
  for (let guard = 0; guard < 64; guard++) {
    const built = buildPatched(dir, srcAsar, unpackedSrc, cmd, { skip, edits: opts.edits });
    let blamed = null;
    for (const [f, text] of built.texts) {
      const err = syntaxError(f, text, run);
      if (!err) continue;
      const hist = built.history.get(f) || [];
      if (hist.length && syntaxError(f, hist[0].text, run)) continue; // orijinal zaten ayrışmıyor (taban hata): bizim suçumuz değil
      // ilk ayrışmayan adım = suçlu grup
      const bad = hist.find((h) => h.group && syntaxError(f, h.text, run));
      blamed = { group: bad ? bad.group : (hist[hist.length - 1] || {}).group || 'core', file: f, err };
      break;
    }
    if (!blamed) { built.skipped.push(...dropped); return built; }
    if (blamed.group === 'core') { const e = new Error(`core syntax check failed in ${blamed.file}: ${blamed.err}`); e.code = 'SYNTAX_CORE'; throw e; }
    skip.add(blamed.group);
    dropped.push(`${blamed.group} (syntax check failed: ${blamed.err})`);
  }
  throw new Error('syntax validation did not converge');
}

// ---------- yazma durumu / yarım kalmış yazımdan kurtarma ----------
const readState = (file = STATE_FILE) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const writeState = (patchObj, file = STATE_FILE) => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ ...(readState(file) || {}), ...patchObj })); } catch { /* önemsiz */ } };

const walkFiles = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
// yedekten asar + unpacked dosyaları geri yazar (restore() ile ortak)
function restoreFiles(P) {
  fs.copyFileSync(P.backup, P.asarFile);
  for (const f of walkFiles(P.unpacked).filter((x) => x.endsWith('.syzer-orig'))) fs.copyFileSync(f, f.slice(0, -'.syzer-orig'.length));
}

// Önceki `patch` yarım kaldıysa (".syzer-new" artığı ya da durum 'writing') yedekten geri yükler. Orca açıkken ÇAĞRILMAZ.
// orcaVersion: şu anki asar'ın sürümü; yedek başka sürümden ise (Orca güncellendi) dosyalara dokunmadan yalnızca artık temizlenir.
function recoverInterrupted(P, orcaVersion, stateFile = STATE_FILE) {
  const tmp = `${P.asarFile}.syzer-new`;
  const st = readState(stateFile);
  const interrupted = fs.existsSync(tmp) || (st && st.state === 'writing');
  if (!interrupted) return { recovered: false };
  try { fs.rmSync(tmp, { force: true }); } catch { /* önemsiz */ }
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(P.meta, 'utf8')); } catch { /* yok */ }
  let restored = false;
  if (fs.existsSync(P.backup) && meta && meta.orcaVersion === orcaVersion) { restoreFiles(P); restored = true; }
  writeState({ state: 'recovered', recoveredAt: Date.now() }, stateFile);
  return { recovered: true, restored, detail: restored ? 'interrupted patch detected; restored original from backup' : 'interrupted patch detected; stale temp file removed (no matching backup)' };
}

// ilk 'n' en büyük düzenlenmiş dosya
const largest = (extra, n = 3) => [...extra].sort((x, y) => y.buf.length - x.buf.length).slice(0, n);

// opts: { dryRun, quiet }. Dönüş: { status: 'applied'|'up-to-date'|'running'|'not-found'|'incompatible'|'error', detail }
function patch(opts = {}) {
  const dir = locate();
  if (!dir) return { status: 'not-found' };
  const cmd = selfCmd();
  const P = paths(dir);
  let unpackedStarted = false;
  try {
    const st = inspect(dir);
    const want = markerOf(cmd).match(markerRe);
    const applied = st.marker && st.marker.v === Number(want[1]) && st.marker.h === want[2];
    if (applied && !opts.dryRun) {
      // işaret asar'a en son yazılır → unpacked dosyalar da tamamdır. (Orca'nın kendi çökmesi izlenmez; yalnızca bakım çağrıları sayılır.)
      const s = readState();
      if (!(s && s.state === 'writing')) { writeState({ state: 'done', marker: want[0], launchesSinceApply: ((s && s.launchesSinceApply) || 0) + 1 }); return { status: 'up-to-date' }; }
    }
    if (!opts.dryRun && orcaRunning()) return { status: 'running' };
    if (!opts.dryRun) {
      // önceki yazım yarım kaldıysa: önce yedekten geri yükle (Orca kapalı), sonra yeniden yama
      const rec = recoverInterrupted(P, st.orcaVersion);
      if (rec.recovered) {
        log(`recover: ${rec.detail}`);
        if (rec.restored) { const again = inspect(dir); st.marker = again.marker; }
      }
    }

    // Kaynak = yamasız orijinal
    let srcAsar = P.asarFile;
    const plain = (f) => path.join(P.unpacked, ...f.split('/'));
    const orig = (f) => (fs.existsSync(`${plain(f)}.syzer-orig`) ? `${plain(f)}.syzer-orig` : plain(f));
    let unpackedSrc = plain;
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(P.meta, 'utf8')); } catch { /* yok */ }
    const legacy = !st.marker && fs.existsSync(P.backup) && !meta; // eski araçla (patch-orca.js) yamalanmış
    if (st.marker || legacy) {
      if (legacy) {
        const b = openAsar(P.backup);
        let bv; try { bv = JSON.parse(b.read('package.json').toString('utf8')).version; } finally { b.close(); }
        if (bv !== st.orcaVersion) return { status: 'incompatible', detail: 'old backup is from another Orca version' };
        meta = { orcaVersion: bv, at: Date.now() };
        if (!opts.dryRun) fs.writeFileSync(P.meta, JSON.stringify(meta));
      }
      if (!fs.existsSync(P.backup) || !meta || meta.orcaVersion !== st.orcaVersion) return { status: 'incompatible', detail: 'patched asar without a matching backup; reinstall Orca or run "syzer orca restore"' };
      srcAsar = P.backup;
      unpackedSrc = orig;
    } else if (!opts.dryRun) {
      // yamasız (yeni/güncellenmiş Orca): bu, yeni orijinaldir → yedeği tazele
      fs.copyFileSync(P.asarFile, P.backup);
      fs.writeFileSync(P.meta, JSON.stringify({ orcaVersion: st.orcaVersion, at: Date.now() }));
    }
    const wasPatched = !!(st.marker || legacy);

    const built = buildValidated(dir, srcAsar, unpackedSrc, cmd);
    if (opts.dryRun) return { status: 'dry-run-ok', detail: `${built.extra.length + built.unpacked.length} files would be patched (Orca ${st.orcaVersion})${built.skipped.length ? `; skipped: ${built.skipped.join(' | ')}` : ''}` };

    // unpacked dosyalar: orijinali .syzer-orig olarak sakla (yoksa; yamalı bir dosya "orijinal" diye yedeklenmez), sonra yamalıyı yaz
    for (const { f } of built.unpacked) {
      const dst = path.join(P.unpacked, ...f.split('/'));
      if (!fs.existsSync(`${dst}.syzer-orig`) && /syzer/i.test(fs.readFileSync(dst, 'utf8'))) {
        return { status: 'error', detail: `original of ${f} is missing (file already patched); run "syzer orca restore" or reinstall Orca` };
      }
    }
    // yazma evresi: 'writing' → 'done'. Arada kesilirse bir sonraki patch() yedekten geri yükler (recoverInterrupted).
    writeState({ state: 'writing', startedAt: Date.now(), orcaVersion: st.orcaVersion });
    const tmp = `${P.asarFile}.syzer-new`;
    writeAsar(tmp, built.header, built.data, built.extra);
    const chk = openAsar(tmp);
    try {
      for (const { f, buf } of built.extra) if (!chk.read(f).equals(buf)) throw new Error(`verify failed: ${f}`);
      // yeni asar'dan geri okunan en büyük dosyalar yeniden ayrıştırılır (başlık/ofset bozulmasını yakalar)
      for (const { f } of largest(built.extra)) {
        const err = syntaxError(f, chk.read(f).toString('utf8'));
        if (err) throw new Error(`verify failed (syntax, read back from new asar): ${f}: ${err}`);
      }
    } finally { chk.close(); }
    // unpacked dosyalar yalnızca yeni asar doğrulandıktan sonra yazılır
    unpackedStarted = true;
    for (const { f, buf } of built.unpacked) {
      const dst = path.join(P.unpacked, ...f.split('/'));
      if (!fs.existsSync(`${dst}.syzer-orig`)) fs.copyFileSync(dst, `${dst}.syzer-orig`);
      fs.writeFileSync(dst, buf);
    }
    fs.renameSync(tmp, P.asarFile);
    writeState({ state: 'done', appliedAt: Date.now(), marker: want[0], launchesSinceApply: 0, orcaVersion: st.orcaVersion });
    try { fs.mkdirSync(path.dirname(GROUPS_FILE), { recursive: true }); fs.writeFileSync(GROUPS_FILE, JSON.stringify({ orcaVersion: st.orcaVersion, at: Date.now(), applied: built.groupNames.filter((n) => !built.skipped.some((x) => x.startsWith(`${n} (`))), skipped: built.skipped })); } catch { /* önemsiz */ }
    return { status: 'applied', detail: `Orca ${st.orcaVersion}${built.skipped.length ? `; skipped: ${built.skipped.join(' | ')}` : ''}` };
  } catch (e) {
    try { fs.rmSync(`${P.asarFile}.syzer-new`, { force: true }); } catch { /* önemsiz */ }
    // hata yazma evresinde olduysa ve asar henüz değişmediyse durum bayrağını temizle (yarım unpacked varsa sonraki çağrı onarır)
    // unpacked yazımı başladıysa 'writing' kalır: sonraki patch() yedekten onarır
    const s = readState();
    if (s && s.state === 'writing' && !unpackedStarted) writeState({ state: 'failed', error: String(e.message).slice(0, 200) });
    return { status: /anchor/.test(e.message) ? 'incompatible' : 'error', detail: e.message };
  }
}

function restore() {
  const dir = locate();
  if (!dir) return { status: 'not-found' };
  if (orcaRunning()) return { status: 'running' };
  const P = paths(dir);
  if (!fs.existsSync(P.backup)) return { status: 'error', detail: 'no backup' };
  restoreFiles(P);
  return { status: 'restored' };
}

// ---------- otomatik bakım ----------
// win32: Zamanlanmış Görev + Run anahtarı (+ kısayol); darwin: launchd ajanı; linux: systemd --user zamanlayıcı (yedek: crontab).
// opts (test için): { platform, run, homedir, orcaHome, execPath, script }; hiçbiri verilmezse gerçek sistem.
function platformCtx(o = {}) {
  return {
    run: o.run || spawnSync,
    homedir: o.homedir || os.homedir(),
    orcaHome: o.orcaHome || HOME,
    execPath: o.execPath || process.execPath,
    script: o.script || path.join(__dirname, '..', 'bin', 'syzer-orca.js'),
    shortcut: !!o.shortcut,
    locate: o.locate || (() => locate()),
  };
}

function install({ shortcut = false, platform = process.platform, ...o } = {}) {
  const pm = platforms[platform];
  if (!pm) return { status: 'error', detail: `automatic maintenance is not supported on ${platform}` };
  const r = pm.install(platformCtx({ ...o, shortcut }));
  if (platform !== 'win32' && shortcut && r.status === 'installed') r.detail += '; --shortcut is Windows-only (ignored)';
  return r;
}

function uninstall({ platform = process.platform, ...o } = {}) {
  const pm = platforms[platform];
  if (!pm) return { status: 'uninstalled' };
  return pm.uninstall(platformCtx(o));
}


// CLI: syzer orca <status|patch|install|uninstall|restore> [--quiet] [--dry-run] [--shortcut]
function run(sub, flags = {}) {
  let r;
  if (sub === 'patch') { r = patch({ dryRun: flags.dryRun, quiet: flags.quiet }); log(`patch: ${r.status}${r.detail ? ` — ${r.detail}` : ''}`); }
  else if (sub === 'install') { r = install({ shortcut: flags.shortcut }); const p = patch(); r.patch = p; log(`install: ${r.status}; patch: ${p.status}`); }
  else if (sub === 'skip') {
    const names = String(flags.arg || '').split(/[\s,]+/).filter(Boolean);
    fs.mkdirSync(path.dirname(SKIP_FILE), { recursive: true });
    if (names.length) fs.writeFileSync(SKIP_FILE, names.join(',')); else fs.rmSync(SKIP_FILE, { force: true });
    r = { status: 'ok', skip: names, detail: 'Orca kapalıyken "syzer orca patch" (veya masaüstü kısayolu) ile uygula' };
  }
  else if (sub === 'config') {
    // syzer orca config [killShellsOnQuit on|off]
    const SETTINGS = path.join(os.homedir(), '.syzercli', 'orca', 'settings.json');
    let cur = {}; try { cur = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { /* yok */ }
    const [key, val] = String(flags.arg || '').split(',');
    if (key) {
      if (key !== 'killShellsOnQuit' || !/^(on|off)$/.test(val || '')) r = { status: 'error', detail: 'kullanım: syzer orca config killShellsOnQuit on|off' };
      else { cur[key] = val === 'on'; fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(cur, null, 2)); r = { status: 'ok', settings: { killShellsOnQuit: cur.killShellsOnQuit !== false } }; }
    } else r = { status: 'ok', settings: { killShellsOnQuit: cur.killShellsOnQuit !== false }, file: SETTINGS };
  }
  else if (sub === 'uninstall') r = uninstall();
  else if (sub === 'restore') r = restore();
  else r = status();
  if (!flags.quiet) console.log(JSON.stringify(r, null, 2));
  if (['error', 'incompatible'].includes(r.status)) process.exitCode = 1;
  return r;
}

module.exports = { run, patch, status, install, uninstall, restore, PATCH_VERSION, markerOf, sourceHash, edits, openAsar, buildPatched, selfCmd, readGroups, locate, inspect, orcaRunning, LOG, TASKS,
  // güvenlik katmanı (test/safety.test.js)
  buildValidated, syntaxError, recoverInterrupted, readState, writeState, writeAsar, STATE_FILE, platforms, paths };
