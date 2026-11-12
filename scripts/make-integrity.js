'use strict';

const fs = require('fs');
const path = require('path');
const { buildManifest } = require('../src/main/core/integrity');

const root = path.resolve(__dirname, '..');

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === '.userdata' || entry.name === '.sdk') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) {
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (/\.(map)$/.test(rel)) continue;
      out.push(rel);
    }
  }
  return out;
}

(async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const candidates = [
    ...walk(path.join(root, 'src')).map((f) => `src/${f}`),
    'build/icon.png',
  ].filter((rel) => fs.existsSync(path.join(root, rel)));
  const manifest = await buildManifest(root, candidates, { version: pkg.version });
  fs.writeFileSync(path.join(root, 'integrity.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`integrity.json: ${Object.keys(manifest.files).length} files, root ${manifest.rootHash.slice(0, 16)}…`);
})();
