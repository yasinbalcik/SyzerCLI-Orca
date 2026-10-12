'use strict';
// Node 18/20 `node --test` glob'unu genişletmez (21+ eder): test dosyalarını kendimiz listeleyip tek tek veririz.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort().map((n) => path.join('test', n));
const r = spawnSync(process.execPath, ['--test', ...files], { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
