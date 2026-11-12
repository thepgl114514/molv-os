'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { appRoot, integrityFile } = require('./paths');

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function normalizeRel(rel) {
  return rel.split(path.sep).join('/');
}

function computeRootHash(files) {
  const lines = Object.keys(files)
    .sort()
    .map((rel) => `${rel}\u0000${files[rel]}`)
    .join('\n');
  return sha256Text(lines);
}

async function verify(options = {}) {
  const started = Date.now();
  const manifestPath = options.manifestPath || integrityFile();
  const base = options.baseDir || appRoot();
  const result = {
    ok: false,
    state: 'unknown',
    checked: 0,
    total: 0,
    missing: [],
    mismatch: [],
    generatedAt: null,
    rootHash: null,
    actualRootHash: null,
    durationMs: 0,
    manifestPath,
    message: '',
  };

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    result.state = 'missing-manifest';
    result.message = fs.existsSync(manifestPath)
      ? `完整性清单无法读取：${err.message}`
      : '未找到完整性清单（开发模式或首次构建前属正常）';
    result.durationMs = Date.now() - started;
    return result;
  }

  if (!manifest || typeof manifest.files !== 'object') {
    result.state = 'invalid-manifest';
    result.message = '完整性清单格式无效';
    result.durationMs = Date.now() - started;
    return result;
  }

  const entries = Object.entries(manifest.files);
  result.total = entries.length;
  result.generatedAt = manifest.generatedAt || null;
  result.rootHash = manifest.rootHash || computeRootHash(manifest.files);

  for (const [rel, expected] of entries) {
    const normalized = normalizeRel(rel);
    if (normalized.includes('..')) continue;
    const file = path.join(base, normalized);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) {
        result.missing.push(normalized);
        continue;
      }
      // Use sync fs here: Electron patches sync fs for files inside app.asar,
      // while some promise-based paths are not asar-aware on all versions.
      const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      result.checked += 1;
      if (actual !== expected) result.mismatch.push({ file: normalized, expected, actual });
    } catch (_) {
      result.missing.push(normalized);
    }
  }

  result.actualRootHash = computeRootHash(manifest.files);
  result.ok = result.missing.length === 0 && result.mismatch.length === 0;
  result.state = result.ok ? 'valid' : 'damaged';
  result.message = result.ok
    ? `已校验 ${result.checked}/${result.total} 个文件，全部一致`
    : `发现 ${result.missing.length} 个缺失文件、${result.mismatch.length} 个校验不一致文件`;
  result.missing = result.missing.slice(0, 80);
  result.mismatch = result.mismatch.slice(0, 80);
  result.durationMs = Date.now() - started;
  return result;
}

async function buildManifest(baseDir, relatives, options = {}) {
  const files = {};
  for (const rel of relatives) {
    const normalized = normalizeRel(rel);
    const file = path.join(baseDir, normalized);
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) continue;
      files[normalized] = await sha256File(file);
    } catch (_) {}
  }
  return {
    product: 'MolvOS',
    version: options.version || null,
    algorithm: 'sha256',
    generatedAt: new Date().toISOString(),
    note: '用于检测安装文件缺失或损坏。完整性清单不替代代码签名。',
    rootHash: computeRootHash(files),
    files,
  };
}

module.exports = { sha256File, sha256Text, computeRootHash, verify, buildManifest, normalizeRel };
