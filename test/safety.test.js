'use strict';
// Güvenlik katmanı: yazmadan önce sözdizimi doğrulama, yarım yazımdan kurtarma, platform kurulum metinleri.
// Gerçek sisteme dokunmaz: komut çalıştırıcı ve dosya kökleri enjekte edilir.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const patch = require('../src/orca-patch');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'syzer-safety-'));

// küçük sahte asar: { 'out/main/index.js': 'metin', ... }
function makeAsar(file, texts) {
  const header = { files: {} };
  const extra = [];
  for (const [p, text] of Object.entries(texts)) {
    const parts = p.split('/');
    let n = header;
    for (const d of parts.slice(0, -1)) n = (n.files[d] = n.files[d] || { files: {} });
    const buf = Buffer.from(text, 'utf8');
    const entry = { size: buf.length, offset: '0' };
    n.files[parts[parts.length - 1]] = entry;
    extra.push({ entry, buf });
  }
  patch.writeAsar(file, header, Buffer.alloc(0), extra);
}

const FILES = {
  'out/main/index.js': 'const m = 1;\n/*A*/\n/*D*/\nmodule.exports = m;\n',
  'out/renderer/app.js': 'const r = 1;\n/*B*/\n/*C*/\nexport { r };\n',
};
const ok = (group, file, from, to) => ({ group, file, from, to });

function build(editList) {
  const d = tmpdir();
  const asar = path.join(d, 'fake.asar');
  makeAsar(asar, FILES);
  try { return patch.buildValidated(d, asar, (f) => path.join(d, f), 'cmd', { edits: editList }); } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

test('syntax error in one group skips only that group; the rest apply', () => {
  const built = build([
    ok('core', 'out/main/index.js', '/*A*/', 'const a = 2;'),
    ok('good', 'out/renderer/app.js', '/*B*/', 'export const b = 1;'),
    ok('badrender', 'out/renderer/app.js', '/*C*/', 'export const = ;'), // aynı dosyada sonraki grup bozar
    ok('badmain', 'out/main/index.js', '/*D*/', 'var = ;'),
  ]);
  assert.strictEqual(built.skipped.length, 2);
  assert.ok(built.skipped.some((s) => /^badrender \(syntax check failed: .+\)$/.test(s)), built.skipped.join('|'));
  assert.ok(built.skipped.some((s) => /^badmain \(syntax check failed: .+\)$/.test(s)));
  const render = built.texts.get('out/renderer/app.js');
  assert.ok(render.includes('export const b = 1;'), 'good group kept');
  assert.ok(!render.includes('export const = ;'));
  assert.ok(built.texts.get('out/main/index.js').includes('const a = 2;'), 'core kept');
  assert.ok(!built.texts.get('out/main/index.js').includes('var = ;'));
});

test('culprit is the group that introduced the error, not a later innocent group', () => {
  const built = build([
    ok('core', 'out/main/index.js', '/*A*/', 'const a = 2;'),
    ok('breaker', 'out/renderer/app.js', '/*B*/', 'export const = ;'),
    ok('innocent', 'out/renderer/app.js', '/*C*/', 'export const c = 3;'),
  ]);
  assert.deepStrictEqual(built.skipped.map((s) => s.split(' ')[0]), ['breaker']);
  assert.ok(built.texts.get('out/renderer/app.js').includes('export const c = 3;'));
});

test('syntax error in core aborts (nothing to write)', () => {
  assert.throws(() => build([ok('core', 'out/main/index.js', '/*A*/', 'var = ;')]), (e) => e.code === 'SYNTAX_CORE' && /core syntax check failed/.test(e.message));
});

test('syntaxError: CJS allows top-level return (Electron wrapper), ESM renderer is checked via node --check', () => {
  assert.strictEqual(patch.syntaxError('out/main/index.js', 'if (x) return;'), null);
  assert.ok(patch.syntaxError('out/main/index.js', 'let = ;'));
  assert.strictEqual(patch.syntaxError('out/renderer/a.js', 'import x from "y"; export default x;'), null);
  assert.ok(patch.syntaxError('out/renderer/a.js', 'export const = ;'));
  assert.strictEqual(patch.syntaxError('out/renderer/a.css', 'not js {{{'), null);
});

test('recoverInterrupted: leftover .syzer-new or state "writing" restores from backup', () => {
  const d = tmpdir();
  try {
    fs.mkdirSync(path.join(d, 'resources'));
    const P = patch.paths(d);
    const stateFile = path.join(d, 'patch-state.json');
    fs.writeFileSync(P.asarFile, 'HALF-WRITTEN');
    fs.writeFileSync(P.backup, 'ORIGINAL');
    fs.writeFileSync(P.meta, JSON.stringify({ orcaVersion: '1.0.0' }));
    fs.writeFileSync(`${P.asarFile}.syzer-new`, 'TMP');
    fs.writeFileSync(stateFile, JSON.stringify({ state: 'writing' }));

    const r = patch.recoverInterrupted(P, '1.0.0', stateFile);
    assert.strictEqual(r.recovered, true);
    assert.strictEqual(r.restored, true);
    assert.strictEqual(fs.readFileSync(P.asarFile, 'utf8'), 'ORIGINAL');
    assert.ok(!fs.existsSync(`${P.asarFile}.syzer-new`));
    assert.notStrictEqual(patch.readState(stateFile).state, 'writing');
    // ikinci çağrı: yapacak bir şey yok
    assert.strictEqual(patch.recoverInterrupted(P, '1.0.0', stateFile).recovered, false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('recoverInterrupted: state "writing" alone triggers; backup of another Orca version is never restored', () => {
  const d = tmpdir();
  try {
    fs.mkdirSync(path.join(d, 'resources'));
    const P = patch.paths(d);
    const stateFile = path.join(d, 'patch-state.json');
    fs.writeFileSync(P.asarFile, 'NEW-ORCA');
    fs.writeFileSync(P.backup, 'OLD-ORCA');
    fs.writeFileSync(P.meta, JSON.stringify({ orcaVersion: '1.0.0' }));
    fs.writeFileSync(stateFile, JSON.stringify({ state: 'writing' }));
    const r = patch.recoverInterrupted(P, '2.0.0', stateFile);
    assert.deepStrictEqual([r.recovered, r.restored], [true, false]);
    assert.strictEqual(fs.readFileSync(P.asarFile, 'utf8'), 'NEW-ORCA');
    // sağlam durum: dokunma
    fs.writeFileSync(stateFile, JSON.stringify({ state: 'done' }));
    assert.strictEqual(patch.recoverInterrupted(P, '2.0.0', stateFile).recovered, false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('recoverInterrupted also restores unpacked .syzer-orig files', () => {
  const d = tmpdir();
  try {
    fs.mkdirSync(path.join(d, 'resources', 'app.asar.unpacked', 'out'), { recursive: true });
    const P = patch.paths(d);
    const u = path.join(P.unpacked, 'out', 'x.js');
    fs.writeFileSync(P.asarFile, 'A'); fs.writeFileSync(P.backup, 'A'); fs.writeFileSync(P.meta, JSON.stringify({ orcaVersion: '1' }));
    fs.writeFileSync(u, 'PATCHED'); fs.writeFileSync(`${u}.syzer-orig`, 'ORIG');
    const stateFile = path.join(d, 's.json');
    fs.writeFileSync(stateFile, JSON.stringify({ state: 'writing' }));
    patch.recoverInterrupted(P, '1', stateFile);
    assert.strictEqual(fs.readFileSync(u, 'utf8'), 'ORIG');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

const recorder = (replies = {}) => {
  const calls = [];
  const run = (cmd, args, opts) => { calls.push({ cmd, args, input: opts && opts.input }); const k = `${cmd} ${(args || []).join(' ')}`; return replies[k] || { status: 0, stdout: '', stderr: '' }; };
  return { run, calls };
};

test('macOS launchd plist: ProgramArguments, StartInterval 600, RunAtLoad', () => {
  const home = tmpdir(); const oh = path.join(home, 'orca');
  try {
    const { run, calls } = recorder();
    const r = patch.install({ platform: 'darwin', run, homedir: home, orcaHome: oh, execPath: '/usr/local/bin/node', script: '/opt/syzer-orca/bin/syzer-orca.js' });
    assert.strictEqual(r.status, 'installed');
    const file = path.join(home, 'Library', 'LaunchAgents', 'dev.syzer.orca-patch.plist');
    const t = fs.readFileSync(file, 'utf8');
    assert.match(t, /<key>Label<\/key>\s*<string>dev\.syzer\.orca-patch<\/string>/);
    assert.match(t, /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/usr\/local\/bin\/node<\/string>\s*<string>\/opt\/syzer-orca\/bin\/syzer-orca\.js<\/string>\s*<string>patch<\/string>\s*<string>--quiet<\/string>\s*<\/array>/);
    assert.match(t, /<key>StartInterval<\/key>\s*<integer>600<\/integer>/);
    assert.match(t, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.deepStrictEqual(calls.map((c) => c.cmd), ['launchctl', 'launchctl']);
    assert.deepStrictEqual(calls[1].args, ['load', '-w', file]);
    patch.uninstall({ platform: 'darwin', run, homedir: home });
    assert.ok(!fs.existsSync(file));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('plist escapes XML metacharacters in paths', () => {
  const t = patch.platforms.darwin.plistText({ execPath: '/a&b/node', script: '/x<y>/s.js' });
  assert.ok(t.includes('/a&amp;b/node') && t.includes('/x&lt;y&gt;/s.js'));
});

test('Linux systemd user units: ExecStart and 10 min timer', () => {
  const home = tmpdir();
  try {
    const { run, calls } = recorder();
    const r = patch.install({ platform: 'linux', run, homedir: home, orcaHome: path.join(home, 'orca'), execPath: '/usr/bin/node', script: '/opt/s o/bin/syzer-orca.js' });
    assert.strictEqual(r.status, 'installed');
    const dir = path.join(home, '.config', 'systemd', 'user');
    const svc = fs.readFileSync(path.join(dir, 'syzer-orca-patch.service'), 'utf8');
    const tim = fs.readFileSync(path.join(dir, 'syzer-orca-patch.timer'), 'utf8');
    assert.match(svc, /^ExecStart="\/usr\/bin\/node" "\/opt\/s o\/bin\/syzer-orca\.js" patch --quiet$/m);
    assert.match(svc, /^Type=oneshot$/m);
    assert.match(tim, /^OnUnitActiveSec=10min$/m);
    assert.match(tim, /^Unit=syzer-orca-patch\.service$/m);
    assert.match(tim, /^WantedBy=timers\.target$/m);
    assert.ok(calls.some((c) => c.cmd === 'systemctl' && c.args.join(' ') === '--user enable --now syzer-orca-patch.timer'));
    assert.ok(!calls.some((c) => c.cmd === 'crontab'));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Linux falls back to crontab when systemctl --user is unavailable (idempotent, keeps other entries)', () => {
  const home = tmpdir();
  try {
    const { run, calls } = recorder({
      'systemctl --user show-environment': { status: 1, stdout: '', stderr: 'no bus' },
      'crontab -l': { status: 0, stdout: '0 1 * * * backup.sh\n*/10 * * * * old # syzer-orca-patch\n', stderr: '' },
    });
    const r = patch.install({ platform: 'linux', run, homedir: home, orcaHome: path.join(home, 'orca'), execPath: '/usr/bin/node', script: '/s/syzer-orca.js' });
    assert.strictEqual(r.status, 'installed');
    const w = calls.find((c) => c.cmd === 'crontab' && c.args[0] === '-');
    assert.ok(w.input.includes('0 1 * * * backup.sh'));
    assert.ok(!w.input.includes(' old '));
    assert.ok(w.input.includes(`*/10 * * * * '/usr/bin/node' '/s/syzer-orca.js' patch --quiet # syzer-orca-patch`));
    assert.ok(w.input.includes('@reboot'));
    assert.ok(!fs.existsSync(path.join(home, '.config', 'systemd')));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Windows install keeps schtasks /MINUTE /MO 10 + Run key (no other platform behaviour leaks)', () => {
  const home = tmpdir();
  try {
    const { run, calls } = recorder();
    const r = patch.install({ platform: 'win32', run, homedir: home, orcaHome: path.join(home, 'orca'), execPath: 'C:\\node.exe', script: 'C:\\s\\syzer-orca.js' });
    assert.strictEqual(r.status, 'installed');
    const st = calls.find((c) => c.cmd === 'schtasks');
    assert.deepStrictEqual(st.args.slice(0, 3), ['/Create', '/F', '/TN']);
    assert.deepStrictEqual(st.args.slice(-4), ['/SC', 'MINUTE', '/MO', '10']);
    assert.ok(calls.some((c) => c.cmd === 'reg' && c.args[0] === 'add'));
    const vbs = fs.readFileSync(path.join(home, 'orca', 'patch.vbs'), 'utf8');
    assert.ok(vbs.includes('C:\\node.exe') && vbs.includes('C:\\s\\syzer-orca.js') && vbs.includes('patch --quiet'));
    assert.match(r.detail, /task: SyzerOrcaPatch \(every 10 min\) \+ logon/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('locate finds macOS and Linux layouts and orcaRunning uses pgrep -x', () => {
  const root = tmpdir();
  try {
    const mac = path.join(root, 'Orca.app', 'Contents');
    fs.mkdirSync(path.join(mac, 'Resources'), { recursive: true });
    fs.writeFileSync(path.join(mac, 'Resources', 'app.asar'), 'x');
    assert.strictEqual(patch.locate({ platform: 'darwin', env: { ORCA_DIR: mac }, home: root }), mac);
    assert.strictEqual(patch.paths(mac).asarFile.toLowerCase(), path.join(mac, 'Resources', 'app.asar').toLowerCase()); // Windows'ta dosya sistemi büyük/küçük harfe duyarsız
    const lin = path.join(root, 'opt-orca');
    fs.mkdirSync(path.join(lin, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(lin, 'resources', 'app.asar'), 'x');
    assert.strictEqual(patch.locate({ platform: 'linux', env: { ORCA_DIR: lin }, home: root }), lin);
    assert.strictEqual(patch.locate({ platform: 'linux', env: {}, home: root }), null);

    const seen = [];
    const prev = process.env.SYZER_ORCA_SKIP_RUNNING_CHECK; delete process.env.SYZER_ORCA_SKIP_RUNNING_CHECK;
    try {
      assert.strictEqual(patch.orcaRunning({ platform: 'darwin', run: (c, a) => { seen.push([c, ...a]); return { status: 0 }; } }), true);
      assert.deepStrictEqual(seen[0], ['pgrep', '-x', 'Orca']);
      assert.strictEqual(patch.orcaRunning({ platform: 'linux', run: () => ({ status: 1 }) }), false);
      assert.strictEqual(patch.orcaRunning({ platform: 'win32', run: () => ({ status: 0, stdout: 'Orca.exe  123 Console' }) }), true);
    } finally { if (prev !== undefined) process.env.SYZER_ORCA_SKIP_RUNNING_CHECK = prev; }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
