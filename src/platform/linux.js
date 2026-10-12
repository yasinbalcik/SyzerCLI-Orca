'use strict';
// Linux: systemd --user zamanlayıcı + servis (~/.config/systemd/user); systemctl --user yoksa crontab satırına düşer.
// ctx: { run(cmd,args,opts), orcaHome, homedir, execPath, script }
// Not: AppImage salt-okunur (squashfs) olduğundan yamalanamaz; .deb/.rpm kurulumları /opt/Orca (electron-builder varsayılanı) altındadır.
const fs = require('fs');
const path = require('path');

const NAME = 'syzer-orca-patch';
const TAG = '# syzer-orca-patch';
const MINUTES = 10;

const locateCandidates = (env, home) => [
  env.ORCA_DIR,
  '/opt/Orca',
  '/opt/orca',
  '/opt/orca-ide',
  '/usr/lib/orca-ide',
  '/usr/lib/orca',
  '/usr/share/orca-ide',
  home && path.join(home, '.local', 'share', 'orca-ide'),
  home && path.join(home, '.local', 'share', 'Orca'),
].filter(Boolean);
// birebir süreç adı: ürün adı büyük/küçük harf ve paket adı varyantları
const runningCheck = (run) => ['Orca', 'orca', 'orca-ide'].some((n) => { const r = run('pgrep', ['-x', n], { encoding: 'utf8' }); return !!r && r.status === 0; });

const unitDir = (homedir) => path.join(homedir, '.config', 'systemd', 'user');
// systemd ExecStart: çift tırnak + % ve $ kaçışı
const sdq = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`;
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function unitTexts({ execPath, script }) {
  const service = [
    '[Unit]',
    'Description=Syzer Orca patch maintenance',
    '',
    '[Service]',
    'Type=oneshot',
    `ExecStart=${sdq(execPath)} ${sdq(script)} patch --quiet`,
    '',
  ].join('\n');
  const timer = [
    '[Unit]',
    `Description=Syzer Orca patch maintenance (every ${MINUTES} min)`,
    '',
    '[Timer]',
    'OnActiveSec=30s',
    'OnBootSec=1min',
    `OnUnitActiveSec=${MINUTES}min`,
    `Unit=${NAME}.service`,
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');
  return { service, timer };
}

function cronLines({ execPath, script }) {
  const cmd = `${shq(execPath)} ${shq(script)} patch --quiet`;
  return [`*/${MINUTES} * * * * ${cmd} ${TAG}`, `@reboot ${cmd} ${TAG}`];
}

const hasSystemd = (run) => { const r = run('systemctl', ['--user', 'show-environment'], { encoding: 'utf8' }); return !!r && r.status === 0; };

function install(ctx) {
  const { run, orcaHome, homedir, execPath, script } = ctx;
  fs.mkdirSync(orcaHome, { recursive: true });
  if (hasSystemd(run)) {
    const dir = unitDir(homedir);
    const t = unitTexts({ execPath, script });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${NAME}.service`), t.service);
    fs.writeFileSync(path.join(dir, `${NAME}.timer`), t.timer);
    run('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
    const r = run('systemctl', ['--user', 'enable', '--now', `${NAME}.timer`], { encoding: 'utf8' });
    if (r.status !== 0) return { status: 'error', detail: (r.stderr || r.stdout || 'systemctl enable failed').trim() };
    return { status: 'installed', detail: `systemd user timer: ${NAME}.timer (every ${MINUTES} min)` };
  }
  // yedek: crontab
  const cur = run('crontab', ['-l'], { encoding: 'utf8' });
  const kept = (cur && cur.status === 0 ? String(cur.stdout || '') : '').split('\n').filter((l) => l && !l.includes(TAG));
  const text = `${[...kept, ...cronLines({ execPath, script })].join('\n')}\n`;
  const w = run('crontab', ['-'], { encoding: 'utf8', input: text });
  if (w.status !== 0) return { status: 'error', detail: (w.stderr || w.stdout || 'crontab failed').trim() };
  return { status: 'installed', detail: `crontab entry (every ${MINUTES} min + reboot); systemd --user unavailable` };
}

function uninstall(ctx) {
  const { run, homedir } = ctx;
  if (hasSystemd(run)) {
    run('systemctl', ['--user', 'disable', '--now', `${NAME}.timer`], { encoding: 'utf8' });
    for (const ext of ['service', 'timer']) { try { fs.rmSync(path.join(unitDir(homedir), `${NAME}.${ext}`), { force: true }); } catch { /* yok */ } }
    run('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
  }
  const cur = run('crontab', ['-l'], { encoding: 'utf8' });
  if (cur && cur.status === 0 && String(cur.stdout || '').includes(TAG)) {
    const kept = String(cur.stdout).split('\n').filter((l) => l && !l.includes(TAG));
    run('crontab', ['-'], { encoding: 'utf8', input: kept.length ? `${kept.join('\n')}\n` : '' });
  }
  return { status: 'uninstalled' };
}

module.exports = { NAME, TAG, MINUTES, locateCandidates, runningCheck, unitTexts, cronLines, unitDir, install, uninstall };
