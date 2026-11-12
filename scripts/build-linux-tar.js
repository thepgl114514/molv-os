'use strict';

const fs = require('fs');
const path = require('path');
const { tarGz } = require('./tar');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'dist', 'linux-unpacked');
const stageRoot = path.join(root, 'dist', 'linux-tar');
const folder = 'MolvOS-0.1.0-linux-x64';
const stage = path.join(stageRoot, folder);
const out = path.join(root, 'dist', `${folder}.tar.gz`);

if (!fs.existsSync(path.join(src, 'molv-os'))) throw new Error('linux-unpacked not found');
fs.rmSync(stageRoot, { recursive: true, force: true });
fs.mkdirSync(stageRoot, { recursive: true });
fs.cpSync(src, stage, { recursive: true });

tarGz(stageRoot, out, {
  executable: (rel) => {
    if (rel === `${folder}/molv-os`) return true;
    if (rel === `${folder}/chrome-sandbox`) return true;
    if (rel === `${folder}/chrome_crashpad_handler`) return true;
    if (rel.endsWith('.so') || rel.endsWith('.so.1')) return true;
    return false;
  },
});
console.log(`tar: ${out} ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB`);
