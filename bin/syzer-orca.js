#!/usr/bin/env node
'use strict';
// syzer-orca: Orca için SyzerCLI eklentisi (yama motoru). Genelde `syzer orca ...` köprüsüyle çağrılır, doğrudan da çalışır.
const pkg = require('../package.json');
const patch = require('../src/orca-patch');

const HELP = `syzer-orca v${pkg.version}  (Orca plugin for SyzerCLI)

  syzer-orca install [--shortcut]   zamanlanmış görev (+ masaüstü kısayolu) kur ve yamayı uygula
  syzer-orca status                 yama durumu (sürüm, uygulanmış gruplar, atlananlar)
  syzer-orca patch [--dry-run]      yamayı şimdi uygula (Orca kapalıyken)
  syzer-orca restore                orijinal Orca'ya dön
  syzer-orca uninstall              zamanlanmış görevi ve kısayolu kaldır
  syzer-orca skip <grup,...>        yama gruplarını kalıcı atla (hata ayıklama; boş = hepsi)
  syzer-orca config [killShellsOnQuit on|off]   kapanışta terminalleri kapat (varsayılan: açık)
  syzer-orca --version

Syzer komutu: SYZER_CLI_CMD ortam değişkeni, yoksa ~/.syzercli/orca/cli.json, yoksa PATH'teki "syzer".`;

const argv = process.argv.slice(2);
const flags = { quiet: false, dryRun: false, shortcut: false };
const rest = [];
for (const a of argv) {
  if (a === '--quiet') flags.quiet = true;
  else if (a === '--dry-run') flags.dryRun = true;
  else if (a === '--shortcut') flags.shortcut = true;
  else if (a === '--version' || a === '-v') { console.log(pkg.version); process.exit(0); }
  else if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
  else rest.push(a);
}
const [sub = 'status', ...more] = rest;
if (!['install', 'status', 'patch', 'restore', 'uninstall', 'skip', 'config'].includes(sub)) { console.log(HELP); process.exit(sub ? 1 : 0); }
patch.run(sub, { ...flags, arg: more.join(',') });
