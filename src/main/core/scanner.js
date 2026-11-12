'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { dirs, ensureDir } = require('./paths');
const { sha256File } = require('./integrity');
const { Logger } = require('./logger');

const log = new Logger('scanner');
const SKIP_DIRS = new Set([
  '$recycle.bin', 'system volume information', 'recovery', 'windows.old',
  'node_modules', '.git', '.svn', '__pycache__', 'proc', 'sys', 'dev', 'run',
]);
const TEXT_EXT = new Set(['.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.ini', '.conf', '.env', '.log', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.php', '.rb', '.sh', '.ps1', '.bat', '.cmd', '.html', '.htm', '.css', '.sql', '.toml']);

function readableSize(n) {
  if (!Number.isFinite(n)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function normalizeRoots(roots) {
  const list = Array.isArray(roots) ? roots : [roots];
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'string') continue;
    const abs = path.resolve(r);
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

class Scanner extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.current = null;
    this.lastState = null;
    this.seq = 0;
  }

  getPolicy() {
    return this.store.get('scan.policy');
  }

  setPolicy(policy) {
    if (!policy || typeof policy !== 'object') throw new Error('扫描策略格式不正确');
    const allowed = {};
    const defaults = this.getPolicy();
    for (const key of Object.keys(defaults)) {
      if (key in policy) allowed[key] = policy[key];
    }
    const next = { ...defaults, ...allowed };
    next.extensions = Array.isArray(next.extensions) ? next.extensions.filter((x) => typeof x === 'string').slice(0, 100) : defaults.extensions;
    next.sensitiveExtensions = Array.isArray(next.sensitiveExtensions) ? next.sensitiveExtensions.filter((x) => typeof x === 'string').slice(0, 100) : defaults.sensitiveExtensions;
    next.names = Array.isArray(next.names) ? next.names.filter((x) => typeof x === 'string').slice(0, 100) : defaults.names;
    next.contentKeywords = Array.isArray(next.contentKeywords) ? next.contentKeywords.filter((x) => typeof x === 'string').slice(0, 100) : defaults.contentKeywords;
    next.hashes = Array.isArray(next.hashes) ? next.hashes.filter((x) => /^[a-f0-9]{64}$/i.test(x)).slice(0, 500) : [];
    this.store.set('scan.policy', next);
    return next;
  }

  async start(options = {}) {
    if (this.current) throw new Error('已有扫描任务正在运行');
    const roots = normalizeRoots(options.roots || this.store.get('scan.roots', []));
    if (roots.length === 0) throw new Error('请选择要扫描的目录或磁盘');
    for (const root of roots) {
      if (!fs.existsSync(root)) throw new Error(`路径不存在：${root}`);
    }
    const policy = { ...this.getPolicy(), ...(options.policy || {}) };
    const id = `scan-${Date.now()}-${++this.seq}`;
    const token = { cancelled: false };
    const state = {
      id, roots, token, startedAt: Date.now(), files: 0, matched: 0, errors: 0,
      results: [], resultMap: new Map(), done: false, policy,
    };
    this.current = state;
    this.emit('start', { id, roots, startedAt: state.startedAt });
    this.run(state).catch((err) => {
      state.done = true;
      state.error = err.message;
      this.emit('done', { id, ok: false, error: err.message, ...this.summary(state) });
      this.current = null;
    });
    return { id, roots, policy };
  }

  async run(state) {
    const { policy } = state;
    let lastEmit = 0;
    const emitProgress = (currentPath, force = false) => {
      const now = Date.now();
      if (!force && now - lastEmit < 300) return;
      lastEmit = now;
      this.emit('progress', {
        id: state.id,
        files: state.files,
        matched: state.matched,
        errors: state.errors,
        current: currentPath,
        percent: null,
        elapsedMs: now - state.startedAt,
      });
    };

    const evaluate = async (file, stat) => {
      const name = path.basename(file);
      const lower = name.toLowerCase();
      const ext = path.extname(lower);
      const reasons = [];
      let level = 'low';
      if (policy.sensitiveExtensions.includes(ext)) { reasons.push(`敏感扩展名 ${ext}`); level = 'high'; }
      if (policy.extensions.includes(ext)) { reasons.push(`可执行/脚本扩展名 ${ext}`); if (level !== 'high') level = 'medium'; }
      for (const n of policy.names || []) {
        if (n && lower.includes(String(n).toLowerCase())) { reasons.push(`文件名包含“${n}”`); level = 'high'; }
      }
      if (policy.largeFileMB && stat.size >= Number(policy.largeFileMB) * 1024 * 1024) {
        reasons.push(`超大文件 ${readableSize(stat.size)}`);
        if (level === 'low') level = 'medium';
      }
      let hash = null;
      if (Array.isArray(policy.hashes) && policy.hashes.length && stat.size <= 512 * 1024 * 1024) {
        hash = await sha256File(file);
        if (policy.hashes.includes(hash)) { reasons.push('SHA-256 命中黑名单'); level = 'high'; }
      }
      if (reasons.length === 0 && policy.contentKeywords && policy.contentKeywords.length && TEXT_EXT.has(ext) && stat.size <= 2 * 1024 * 1024) {
        try {
          const content = await fs.promises.readFile(file, 'utf8');
          for (const kw of policy.contentKeywords) {
            if (kw && content.includes(kw)) { reasons.push(`内容包含“${kw}”`); level = 'high'; break; }
          }
        } catch (_) {}
      }
      if (reasons.length === 0) return null;
      return {
        path: file,
        name,
        ext,
        size: stat.size,
        sizeText: readableSize(stat.size),
        modified: stat.mtime.toISOString(),
        reasons,
        level,
        hash,
      };
    };

    const walk = async (target) => {
      if (state.token.cancelled) return;
      let stat;
      try { stat = await fs.promises.lstat(target); } catch (_) { state.errors += 1; return; }
      if (stat.isSymbolicLink() && !policy.followSymlinks) return;
      if (stat.isDirectory()) {
        const base = path.basename(target).toLowerCase();
        if (!policy.includeHidden && base.startsWith('.')) return;
        if (SKIP_DIRS.has(base)) return;
        let dir;
        try { dir = await fs.promises.opendir(target); } catch (_) { state.errors += 1; return; }
        try {
          for await (const entry of dir) {
            if (state.token.cancelled) break;
            if (!policy.includeHidden && entry.name.startsWith('.')) continue;
            await walk(path.join(target, entry.name));
          }
        } catch (_) { state.errors += 1; }
        return;
      }
      if (!stat.isFile()) return;
      state.files += 1;
      emitProgress(target);
      if (state.matched >= (policy.maxResults || 2000)) return;
      try {
        const hit = await evaluate(target, stat);
        if (hit) {
          state.matched += 1;
          state.results.push(hit);
          state.resultMap.set(hit.path, hit);
          this.emit('hit', { id: state.id, hit });
        }
      } catch (err) {
        state.errors += 1;
      }
    };

    for (const root of state.roots) {
      if (state.token.cancelled) break;
      await walk(root);
    }

    state.done = true;
    const summary = this.summary(state);
    this.store.patch({
      scan: {
        lastScan: {
          at: new Date().toISOString(),
          roots: state.roots,
          files: state.files,
          matched: state.matched,
          errors: state.errors,
          cancelled: state.token.cancelled,
          elapsedMs: Date.now() - state.startedAt,
        },
      },
    });
    this.lastState = state;
    this.emit('done', { id: state.id, ok: true, cancelled: state.token.cancelled, ...summary });
    this.current = null;
  }

  summary(state) {
    return {
      id: state.id,
      files: state.files,
      matched: state.matched,
      errors: state.errors,
      results: state.results,
      elapsedMs: Date.now() - state.startedAt,
      roots: state.roots,
      cancelled: state.token.cancelled,
    };
  }

  cancel(id) {
    if (!this.current || (id && this.current.id !== id)) throw new Error('没有正在运行的扫描任务');
    this.current.token.cancelled = true;
    return { ok: true, id: this.current.id };
  }

  status() {
    if (!this.current) return { running: false, lastScan: this.store.get('scan.lastScan') };
    return { running: true, id: this.current.id, files: this.current.files, matched: this.current.matched, errors: this.current.errors };
  }

  async quarantine(paths, options = {}) {
    const state = this.current && !this.current.done ? this.current : this.lastState;
    if (!state || state.results.length === 0) throw new Error('扫描结果已失效，请重新扫描');
    if (!options.confirmed) throw new Error('隔离文件需要显式确认');
    if (!Array.isArray(paths) || paths.length === 0) throw new Error('请选择要隔离的文件');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const vault = path.join(dirs().vault, stamp);
    ensureDir(vault);
    const moved = [];
    const errors = [];
    for (const file of paths.slice(0, 500)) {
      const hit = state.resultMap.get(file);
      if (!hit) { errors.push({ path: file, error: '不在本次扫描结果中' }); continue; }
      try {
        const rel = path.relative(path.parse(file).root, file).replace(/[:]/g, '_');
        const dest = path.join(vault, rel);
        ensureDir(path.dirname(dest));
        try {
          fs.renameSync(file, dest);
        } catch (err) {
          if (err.code === 'EXDEV') {
            fs.copyFileSync(file, dest);
            fs.unlinkSync(file);
          } else throw err;
        }
        moved.push({ from: file, to: dest, reasons: hit.reasons, level: hit.level });
      } catch (err) {
        errors.push({ path: file, error: err.message });
      }
    }
    const manifest = {
      product: 'MolvOS', createdAt: new Date().toISOString(), batch: stamp,
      policy: state.policy, moved, errors,
      note: '文件被移动到墨绿OS隔离区，可在隔离区目录中人工复核；本工具不替代法律判断。',
    };
    fs.writeFileSync(path.join(vault, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return { ok: errors.length === 0, vault, moved, errors, count: moved.length };
  }

  async exportReport() {
    const state = this.current && !this.current.done ? this.current : this.lastState;
    if (!state || state.results.length === 0) throw new Error('没有可导出的扫描结果');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    ensureDir(dirs().reports);
    const file = path.join(dirs().reports, `scan-${stamp}.json`);
    const report = {
      product: 'MolvOS', generatedAt: new Date().toISOString(),
      roots: state.roots, policy: state.policy,
      files: state.files, matched: state.matched, errors: state.errors,
      results: state.results,
      disclaimer: '本报告基于本地规则匹配，仅用于文件整理与安全自查，不构成违法性认定。',
    };
    fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
    return { ok: true, file, count: report.results.length };
  }

  async roots() {
    const list = [];
    if (process.platform === 'win32') {
      for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const root = `${letter}:\\`;
        if (fs.existsSync(root)) {
          list.push({ path: root, label: `${letter}: 本地磁盘`, type: 'drive' });
        }
      }
    } else {
      list.push({ path: '/', label: '根目录', type: 'drive' });
    }
    list.push({ path: os.homedir(), label: '用户主目录', type: 'home' });
    list.push({ path: path.join(os.homedir(), 'Desktop'), label: '桌面', type: 'desktop' });
    list.push({ path: path.join(os.homedir(), 'Downloads'), label: '下载', type: 'downloads' });
    return list.filter((x) => fs.existsSync(x.path));
  }
}

module.exports = { Scanner, readableSize };
