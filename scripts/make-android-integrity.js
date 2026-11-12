'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'android', 'assets');
const www = path.join(assets, 'www');

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const files = {};
for (const rel of walk(www)) {
  if (rel.endsWith('.map')) continue;
  files[`www/${rel}`] = sha256(path.join(www, rel));
}
const lines = Object.keys(files).sort().map((k) => `${k}\u0000${files[k]}`).join('\n');
const rootHash = crypto.createHash('sha256').update(lines, 'utf8').digest('hex');
const manifest = {
  product: 'MolvOS Android',
  version: '0.1.0',
  algorithm: 'sha256',
  generatedAt: new Date().toISOString(),
  rootHash,
  files,
};
fs.writeFileSync(path.join(assets, 'integrity.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`android integrity: ${Object.keys(files).length} files`);
