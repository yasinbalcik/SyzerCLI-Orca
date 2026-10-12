'use strict';
// Windows: Zamanlanmış Görev + HKCU Run anahtarı + (isteğe bağlı) masaüstü kısayolu. Davranış değişmedi; yalnızca enjekte edilebilir.
// ctx: { run(cmd,args,opts), orcaHome, homedir, execPath, script, shortcut, locate() }
const fs = require('fs');
const path = require('path');

const TASKS = ['SyzerOrcaPatch'];
const RUN_KEY = ['HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Run'].join(String.fromCharCode(92));

const locateCandidates = (env) => [env.ORCA_DIR, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'orca'), 'C:\\Program Files\\Orca'].filter(Boolean);
const runningCheck = (run) => { const r = run('tasklist', ['/FI', 'IMAGENAME eq Orca.exe', '/NH'], { encoding: 'utf8' }); return /orca\.exe/i.test(String(r && r.stdout) || ''); };

function install(ctx) {
  const { run, orcaHome: HOME, homedir, execPath, script, shortcut, locate } = ctx;
  fs.mkdirSync(HOME, { recursive: true });
  const exe = `"${execPath}" "${script}"`; // zamanlanmış görev/kısayol eklentiyi doğrudan çalıştırır
  const q = (s) => s.replace(/"/g, '""');
  const vbs = path.join(HOME, 'patch.vbs');
  fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run "${q(exe)} patch --quiet", 0, True\r\n`);
  const create = (name, schedule) => run('schtasks', ['/Create', '/F', '/TN', name, '/TR', `wscript.exe //B "${vbs}"`, ...schedule], { encoding: 'utf8' });
  const r1 = create(TASKS[0], ['/SC', 'MINUTE', '/MO', '10']);
  // oturum açılışında da çalışsın (yönetici izni gerektirmeyen Run anahtarı)
  const r2 = run('reg', ['add', RUN_KEY, '/v', 'SyzerOrcaPatch', '/t', 'REG_SZ', '/d', `wscript.exe //B "${vbs}"`, '/f'], { encoding: 'utf8' });
  if (r1.status !== 0) return { status: 'error', detail: (r1.stderr || r1.stdout || '').trim() };
  let lnk = null;
  if (shortcut) {
    const dir = locate();
    if (dir) {
      const start = path.join(HOME, 'orca-start.vbs');
      fs.writeFileSync(start, `Set sh = CreateObject("WScript.Shell")\r\nsh.Run "${q(exe)} patch --quiet", 0, True\r\nsh.Run """${path.join(dir, 'Orca.exe')}""", 1, False\r\n`);
      lnk = path.join(homedir, 'Desktop', 'Orca (Syzer).lnk');
      const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}');$s.TargetPath='wscript.exe';$s.Arguments='//B "${start}"';$s.IconLocation='${path.join(dir, 'Orca.exe')},0';$s.Save()`;
      run('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    }
  }
  return { status: 'installed', detail: `task: ${TASKS.join(', ')} (every 10 min) + logon${r2.status === 0 ? '' : ' (logon entry failed)'}${lnk ? `; shortcut: ${lnk}` : ''}` };
}

function uninstall(ctx) {
  const { run, homedir } = ctx;
  for (const t of TASKS) run('schtasks', ['/Delete', '/F', '/TN', t], { encoding: 'utf8' });
  run('reg', ['delete', RUN_KEY, '/v', 'SyzerOrcaPatch', '/f'], { encoding: 'utf8' });
  try { fs.rmSync(path.join(homedir, 'Desktop', 'Orca (Syzer).lnk'), { force: true }); } catch { /* yok */ }
  return { status: 'uninstalled' };
}

module.exports = { TASKS, RUN_KEY, locateCandidates, runningCheck, install, uninstall };
