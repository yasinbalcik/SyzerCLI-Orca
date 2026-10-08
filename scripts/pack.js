'use strict';
// Sürüm paketini üretir: dist/syzer-orca-<ver>.tar.gz (bin, src, assets, package.json, README)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const pkg = require('../package.json');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const name = `syzer-orca-${pkg.version}.tar.gz`;
const r = spawnSync('tar', ['-czf', `dist/${name}`, 'bin', 'src', 'assets', 'package.json', 'README.md'], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(1);
console.log(`dist/${name}`);
