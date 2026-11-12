'use strict';

const fs = require('fs');
const path = require('path');
const { run } = require('./exec');
const { ensureDir, dirs } = require('./paths');
const { Logger } = require('./logger');

const log = new Logger('github');

const MIRRORS = [
  { id: 'direct', name: 'GitHub 直连', prefix: '', note: '官方源，部分地区可能较慢', official: true },
  { id: 'ghproxy', name: 'GHProxy', prefix: 'https://ghproxy.net/', note: '社区公共镜像，适合 release / 归档下载' },
  { id: 'gh-proxy', name: 'gh-proxy', prefix: 'https://gh-proxy.com/', note: '社区公共镜像，支持 release 与 raw' },
  { id: 'ghfast', name: 'ghfast', prefix: 'https://ghfast.top/', note: '社区公共镜像，速度因网络而异' },
  { id: 'moeyy', name: 'Moeyy', prefix: 'https://github.moeyy.xyz/', note: '社区公共镜像，备用线路' },
  { id: 'custom', name: '自定义镜像', prefix: '', note: '填入以 / 结尾的镜像前缀，仅支持 GitHub 链接' },
];

const PROBE_URL = 'https://github.com/octocat/Hello-World/archive/refs/heads/master.zip';

function isGithubUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ['github.com', 'www.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com', 'codeload.github.com'].includes(u.hostname);
  } catch (_) {
    return false;
  }
}

class GithubAccelerator {
  constructor(store) {
    this.store = store;
  }

  mirrors() {
    return MIRRORS.map((m) => {
      if (m.id === 'custom') {
        return { ...m, prefix: this.store.get('github.custom', '') || '' };
      }
      return m;
    });
  }

  active() {
    const id = this.store.get('github.mirror', 'ghproxy');
    const custom = this.store.get('github.custom', '');
    const mirror = MIRRORS.find((m) => m.id === id) || MIRRORS[0];
    return { ...mirror, prefix: id === 'custom' ? custom : mirror.prefix };
  }

  setMirror(id, custom) {
    if (!MIRRORS.some((m) => m.id === id)) throw new Error('未知镜像');
    this.store.patch({ github: { mirror: id, custom: custom === undefined ? this.store.get('github.custom', '') : String(custom).trim() } });
    return this.active();
  }

  rewrite(url, mirrorId) {
    if (!this.store.get('github.enabled', true) && !mirrorId) return url;
    if (!isGithubUrl(url)) return url;
    const id = mirrorId || this.store.get('github.mirror', 'ghproxy');
    const m = this.mirrors().find((x) => x.id === id);
    if (!m || !m.prefix) return url;
    if (!/^https:\/\//.test(m.prefix)) return url;
    return `${m.prefix.replace(/\/?$/, '/')}${url}`;
  }

  async testOne(m) {
    const started = Date.now();
    try {
      const url = m.prefix ? `${m.prefix.replace(/\/?$/, '/')}${PROBE_URL}` : PROBE_URL;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-2047', 'User-Agent': 'MolvOS/0.1' },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      });
      const buf = await res.arrayBuffer();
      const ms = Date.now() - started;
      return { id: m.id, name: m.name, ok: res.ok || res.status === 206, status: res.status, ms, bytes: buf.byteLength, error: res.ok || res.status === 206 ? null : `HTTP ${res.status}` };
    } catch (err) {
      return { id: m.id, name: m.name, ok: false, ms: Date.now() - started, error: err.name === 'TimeoutError' ? '超时' : err.message };
    }
  }

  async testAll() {
    const results = await Promise.all(this.mirrors().map((m) => this.testOne(m)));
    const ok = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
    const payload = { at: new Date().toISOString(), results, fastest: ok[0] || null };
    this.store.set('github.lastTest', payload);
    return payload;
  }

  async download(url, dest, options = {}) {
    if (!isGithubUrl(url) && !options.allowAny) throw new Error('只允许从 GitHub 域名下载');
    const finalUrl = this.rewrite(url, options.mirror);
    ensureDir(path.dirname(dest));
    const res = await fetch(finalUrl, { redirect: 'follow', signal: AbortSignal.timeout(options.timeout || 60 * 60 * 1000), headers: { 'User-Agent': 'MolvOS/0.1' } });
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    const tmp = `${dest}.part`;
    const out = fs.createWriteStream(tmp);
    let received = 0;
    let last = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        const now = Date.now();
        if (options.onProgress && now - last > 250) {
          last = now;
          options.onProgress({ received, total, percent: total ? Math.round((received / total) * 100) : null });
        }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    fs.renameSync(tmp, dest);
    return { path: dest, size: received, url: finalUrl, mirror: this.active().name };
  }

  async gitInfo() {
    const r = await run('git.exe', ['--version'], { timeout: 6000 });
    if (!r.ok) {
      const g = await run('git', ['--version'], { timeout: 6000 });
      if (!g.ok) return { installed: false };
      return { installed: true, version: g.stdout.trim(), path: 'git' };
    }
    return { installed: true, version: r.stdout.trim(), path: 'git.exe' };
  }

  async applyGitConfig(enabled = true) {
    const info = await this.gitInfo();
    if (!info.installed) throw new Error('未找到 git，请先安装 Git for Windows');
    if (!enabled) {
      const r = await run(info.path, ['config', '--global', '--unset-all', `url.${this.active().prefix}https://github.com/.insteadOf`], { timeout: 10000 });
      return { ok: r.ok, message: '已移除墨绿OS写入的 Git 加速配置' };
    }
    const prefix = this.active().prefix;
    if (!prefix) throw new Error('当前为 GitHub 直连，无需配置');
    const key = `url.${prefix}https://github.com/.insteadOf`;
    const set = await run(info.path, ['config', '--global', key, 'https://github.com/'], { timeout: 10000 });
    if (!set.ok) throw new Error(set.error || set.stderr || 'git config 失败');
    return { ok: true, message: `已配置 git 使用 ${this.active().name} 访问 GitHub`, key };
  }

  async clone(url, dest) {
    if (!isGithubUrl(url)) throw new Error('只允许克隆 GitHub 仓库');
    const info = await this.gitInfo();
    const finalUrl = this.rewrite(url);
    if (!info.installed) {
      const zip = url.replace(/\.git$/, '').replace(/\/$/, '') + '/archive/refs/heads/main.zip';
      const out = path.join(dest.endsWith('.zip') ? dest : `${dest}.zip`);
      return this.download(zip, out);
    }
    ensureDir(path.dirname(path.resolve(dest)));
    const r = await run(info.path, ['clone', '--depth', '1', finalUrl, dest], { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
    if (!r.ok) throw new Error(`克隆失败：${r.stderr || r.error}`);
    return { ok: true, path: dest, output: (r.stdout + r.stderr).slice(-2000) };
  }
}

module.exports = { GithubAccelerator, MIRRORS, isGithubUrl };
