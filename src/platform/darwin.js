'use strict';
// macOS: launchd kullanıcı ajanı (~/Library/LaunchAgents/dev.syzer.orca-patch.plist), 600 sn aralık + oturum açılışında.
// ctx: { run(cmd,args,opts), orcaHome, homedir, execPath, script }
const fs = require('fs');
const path = require('path');

const LABEL = 'dev.syzer.orca-patch';
const INTERVAL = 600;

const locateCandidates = (env, home) => [
  env.ORCA_DIR,
  '/Applications/Orca.app/Contents',
  home && path.join(home, 'Applications', 'Orca.app', 'Contents'),
].filter(Boolean);
// birebir süreç adı (pgrep -x): ana süreç "Orca"
const runningCheck = (run) => { const r = run('pgrep', ['-x', 'Orca'], { encoding: 'utf8' }); return !!r && r.status === 0; };

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plistPath = (homedir) => path.join(homedir, 'Library', 'LaunchAgents', `${LABEL}.plist`);

function plistText({ execPath, script, logFile }) {
  const args = [execPath, script, 'patch', '--quiet'].map((a) => `    <string>${xml(a)}</string>`).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    args,
    '  </array>',
    '  <key>StartInterval</key>',
    `  <integer>${INTERVAL}</integer>`,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    ...(logFile ? ['  <key>StandardOutPath</key>', `  <string>${xml(logFile)}</string>`, '  <key>StandardErrorPath</key>', `  <string>${xml(logFile)}</string>`] : []),
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function install(ctx) {
  const { run, orcaHome, homedir, execPath, script } = ctx;
  const file = plistPath(homedir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(orcaHome, { recursive: true });
  fs.writeFileSync(file, plistText({ execPath, script, logFile: path.join(orcaHome, 'launchd.log') }));
  run('launchctl', ['unload', file], { encoding: 'utf8' }); // yoksa hata verir; önemsiz
  const r = run('launchctl', ['load', '-w', file], { encoding: 'utf8' });
  if (r.status !== 0) return { status: 'error', detail: (r.stderr || r.stdout || 'launchctl load failed').trim() };
  return { status: 'installed', detail: `launchd agent: ${LABEL} (every ${INTERVAL / 60} min + login)` };
}

function uninstall(ctx) {
  const { run, homedir } = ctx;
  const file = plistPath(homedir);
  run('launchctl', ['unload', file], { encoding: 'utf8' });
  try { fs.rmSync(file, { force: true }); } catch { /* yok */ }
  return { status: 'uninstalled' };
}

module.exports = { LABEL, INTERVAL, locateCandidates, runningCheck, plistText, plistPath, install, uninstall };
