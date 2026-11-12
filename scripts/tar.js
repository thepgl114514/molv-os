'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

function writeString(buf, text, offset, length) {
  const bytes = Buffer.from(String(text), 'utf8');
  bytes.copy(buf, offset, 0, Math.min(bytes.length, length));
}

function splitName(name) {
  const bytes = Buffer.from(name, 'utf8');
  if (bytes.length <= 100) return { name, prefix: '' };
  for (let i = name.length - 1; i > 0; i -= 1) {
    if (name[i] !== '/') continue;
    const prefix = name.slice(0, i);
    const base = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(base) <= 100) return { name: base, prefix };
  }
  return { name: name.slice(-100), prefix: '' };
}

function header(name, stat, type, linkname = '') {
  const buf = Buffer.alloc(512, 0);
  const parts = splitName(name);
  writeString(buf, parts.name, 0, 100);
  writeString(buf, octal(stat.mode & 0o7777, 8), 100, 8);
  writeString(buf, octal(0, 8), 108, 8);
  writeString(buf, octal(0, 8), 116, 8);
  const size = type === '0' ? stat.size : 0;
  writeString(buf, octal(size, 12), 124, 12);
  writeString(buf, octal(Math.floor(stat.mtimeMs / 1000), 12), 136, 12);
  buf.fill(0x20, 148, 156);
  writeString(buf, type, 156, 1);
  writeString(buf, linkname, 157, 100);
  writeString(buf, 'ustar', 257, 6);
  writeString(buf, '00', 263, 2);
  writeString(buf, 'root', 265, 32);
  writeString(buf, 'root', 297, 32);
  writeString(buf, parts.prefix, 345, 155);
  let sum = 0;
  for (const b of buf) sum += b;
  writeString(buf, `${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return buf;
}

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    const stat = fs.lstatSync(full);
    if (entry.isSymbolicLink()) {
      out.push({ rel, stat, type: '2', link: fs.readlinkSync(full) });
    } else if (entry.isDirectory()) {
      out.push({ rel: `${rel}/`, stat, type: '5' });
      walk(full, base, out);
    } else if (entry.isFile()) {
      out.push({ rel, stat, type: '0' });
    }
  }
  return out;
}

function makeTar(base, options = {}) {
  const chunks = [];
  const entries = walk(base, base, []);
  for (const e of entries) {
    let mode = e.type === '5' ? 0o755 : 0o644;
    if (e.type === '0' && options.executable && options.executable(e.rel)) mode = 0o755;
    if (e.rel.endsWith('chrome-sandbox')) mode = 0o4755;
    const stat = { ...e.stat, mode };
    chunks.push(header(e.rel, stat, e.type, e.link || ''));
    if (e.type === '0') {
      chunks.push(fs.readFileSync(path.join(base, e.rel)));
      const pad = (512 - (e.stat.size % 512)) % 512;
      if (pad) chunks.push(Buffer.alloc(pad));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function tarGz(base, outFile, options = {}) {
  const tar = makeTar(base, options);
  fs.writeFileSync(outFile, zlib.gzipSync(tar, { level: 9 }));
  return outFile;
}

module.exports = { makeTar, tarGz, walk };

if (require.main === module) {
  const [base, out] = process.argv.slice(2);
  tarGz(base, out, { executable: (rel) => /(^|\/)MolvOS$|\.sh$|usr\/bin\//.test(rel) });
  console.log(`tar.gz written: ${out}`);
}
