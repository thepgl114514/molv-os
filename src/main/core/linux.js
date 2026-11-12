'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { run, spawnStream } = require('./exec');
const { dirs, ensureDir } = require('./paths');
const { sha256File } = require('./integrity');
const { Logger } = require('./logger');

const log = new Logger('linux');

const ALPINE_LATEST = 'https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases';
const ROOTFS_ARCH = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const PACKAGE_SETS = {
  minimal: ['bash', 'busybox', 'curl', 'ca-certificates', 'git'],
  slim: ['bash', 'busybox', 'curl', 'ca-certificates', 'git', 'nano', 'procps', 'util-linux', 'python3'],
  full: ['bash', 'busybox', 'curl', 'ca-certificates', 'git', 'nano', 'procps', 'util-linux', 'build-base', 'python3', 'py3-pip', 'go', 'openjdk17-jdk', 'nodejs', 'npm', 'php', 'ruby', 'rust', 'cargo', 'sudo', 'openssh'],
};

function formatBytes(n) {
  if (!Number.isFinite(n)) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function downloadFile(url, dest, onProgress) {
  ensureDir(path.dirname(dest));
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}：${url}`);
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
      if (!out.write(Buffer.from(value))) {
        await new Promise((r) => out.once('drain', r));
      }
      const now = Date.now();
      if (onProgress && now - last > 250) {
        last = now;
        onProgress({ received, total, percent: total ? Math.round((received / total) * 100) : null, text: `${formatBytes(received)} / ${formatBytes(total)}` });
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  fs.renameSync(tmp, dest);
  if (onProgress) onProgress({ received, total, percent: 100, text: '下载完成' });
  return { path: dest, size: received };
}

async function resolveAlpineRootfs() {
  const yamlUrl = `${ALPINE_LATEST}/${ROOTFS_ARCH}/latest-releases.yaml`;
  const res = await fetch(yamlUrl, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`无法获取 Alpine 版本信息：HTTP ${res.status}`);
  const text = await res.text();
  const blocks = text.split(/\n(?=- flavor:)/);
  const block = blocks.find((b) => /flavor:\s*alpine-minirootfs/.test(b) && new RegExp(`arch:\\s*${ROOTFS_ARCH}`).test(b));
  if (!block) throw new Error('未找到适配当前架构的 Alpine minirootfs');
  const file = (block.match(/file:\s*([^\s]+)/) || [])[1];
  const sha256 = (block.match(/sha256:\s*([a-f0-9]{64})/) || [])[1];
  const version = (block.match(/version:\s*([^\s]+)/) || [])[1];
  if (!file) throw new Error('Alpine 版本信息缺少文件名');
  return { url: `${ALPINE_LATEST}/${ROOTFS_ARCH}/${file}`, file, sha256, version, arch: ROOTFS_ARCH };
}

class LinuxManager extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.sessions = new Map();
    this.sessionSeq = 0;
    this.installLock = false;
  }

  get wslName() {
    return this.store.get('linux.distro', 'MolvOS') || 'MolvOS';
  }

  get rootfsPath() {
    return path.join(dirs().linux, 'rootfs');
  }

  async wslList() {
    if (process.platform !== 'win32') return { ok: false, distros: [] };
    const r = await run('wsl.exe', ['-l', '-q'], { timeout: 15000 });
    const distros = r.ok
      ? r.stdout.replace(/\u0000/g, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      : [];
    return { ok: r.ok, distros, error: r.ok ? null : (r.stderr || r.error) };
  }

  async status() {
    const base = {
      platform: process.platform,
      distro: this.wslName,
      rootfs: this.rootfsPath,
      packages: PACKAGE_SETS,
      sessions: this.sessions.size,
      checkedAt: new Date().toISOString(),
    };
    if (process.platform === 'win32') {
      const list = await this.wslList();
      const installed = list.distros.some((d) => d.toLowerCase() === this.wslName.toLowerCase());
      let probe = null;
      if (installed) {
        probe = await run('wsl.exe', ['-d', this.wslName, '-u', 'root', '--', 'sh', '-lc', 'printf MOLV_OK; cat /etc/alpine-release 2>/dev/null || cat /etc/os-release 2>/dev/null | head -n 2'], { timeout: 30000 });
      }
      const ready = Boolean(probe && probe.ok && /MOLV_OK/.test(probe.stdout));
      const message = installed
        ? ready ? '墨绿 Linux 环境已就绪（WSL2）' : '已导入发行版，但启动探测失败，请查看日志'
        : list.ok ? '尚未安装 Linux 环境。将下载 Alpine minirootfs 并导入 WSL2。' : '未检测到 WSL2。需要管理员权限启用“适用于 Linux 的 Windows 子系统”。';
      return {
        ...base,
        method: 'wsl',
        available: list.ok,
        installed,
        ready,
        running: ready,
        distros: list.distros,
        version: probe && probe.ok ? probe.stdout.replace('MOLV_OK', '').trim().split(/\r?\n/)[0] : null,
        message,
        canInstall: list.ok,
        needsAdmin: !list.ok,
        instructions: list.ok ? null : [
          '以管理员身份打开 PowerShell',
          '执行：wsl --install --no-distribution',
          '重启电脑后回到墨绿OS，再次点击安装 Linux 环境',
        ],
      };
    }
    if (process.platform === 'linux') {
      const hasRootfs = fs.existsSync(path.join(this.rootfsPath, 'bin', 'sh'));
      const isRoot = process.getuid && process.getuid() === 0;
      const proot = await run('sh', ['-lc', 'command -v proot'], { timeout: 5000 });
      const method = hasRootfs ? (isRoot ? 'chroot' : proot.ok ? 'proot' : 'native') : 'native';
      return {
        ...base,
        method,
        available: true,
        installed: hasRootfs || true,
        ready: true,
        running: true,
        rootfsInstalled: hasRootfs,
        rootfsSize: hasRootfs ? await this.dirSize(this.rootfsPath) : 0,
        message: hasRootfs
          ? `已安装 Alpine rootfs，使用 ${method} 隔离运行`
          : '当前已是 Linux 系统，可直接使用原生 bash；可选安装 Alpine rootfs 以获得隔离环境',
        canInstall: true,
        needsAdmin: false,
      };
    }
    return { ...base, method: 'unsupported', available: false, installed: false, ready: false, message: '当前平台不支持 Linux 环境' };
  }

  async dirSize(dir) {
    let total = 0;
    try {
      const walk = async (d) => {
        const entries = await fs.promises.readdir(d, { withFileTypes: true });
        for (const e of entries) {
          const f = path.join(d, e.name);
          if (e.isSymbolicLink()) continue;
          if (e.isDirectory()) await walk(f);
          else if (e.isFile()) {
            try { total += (await fs.promises.stat(f)).size; } catch (_) {}
          }
        }
      };
      await walk(dir);
    } catch (_) {}
    return total;
  }

  async install(options = {}) {
    if (this.installLock) throw new Error('Linux 环境安装正在进行中');
    this.installLock = true;
    const variant = options.variant || this.store.get('variant', 'slim');
    const progress = (stage, percent, text, extra = {}) => {
      this.emit('install-progress', { stage, percent, text, ...extra });
    };
    try {
      if (process.platform === 'win32') return await this.installWsl({ variant, progress, elevate: Boolean(options.elevate) });
      if (process.platform === 'linux') return await this.installLinuxRootfs({ variant, progress });
      throw new Error('当前平台不支持安装 Linux 环境');
    } finally {
      this.installLock = false;
    }
  }

  async installWsl({ variant, progress, elevate }) {
    const list = await this.wslList();
    if (!list.ok) {
      if (elevate) {
        progress('elevate', 5, '正在请求管理员权限安装 WSL2…');
        const cmd = 'Start-Process -FilePath wsl.exe -ArgumentList @(\'--install\',\'--no-distribution\') -Verb RunAs -Wait';
        const r = await require('./exec').powershell(cmd, { timeout: 10 * 60 * 1000 });
        if (!r.ok) throw new Error(`WSL2 安装失败或被取消：${r.error || ''}`);
        return {
          ok: false,
          code: 'REBOOT_REQUIRED',
          message: 'WSL2 组件安装命令已完成。请重启电脑，然后再次运行安装。',
          needsReboot: true,
        };
      }
      return {
        ok: false,
        code: 'WSL_MISSING',
        needsAdmin: true,
        message: '当前系统未启用 WSL2。请以管理员身份重启应用并安装，或手动执行：wsl --install --no-distribution',
        instructions: ['以管理员身份打开 PowerShell', '执行：wsl --install --no-distribution', '重启电脑', '回到墨绿OS重新安装 Linux 环境'],
      };
    }

    const has = list.distros.some((d) => d.toLowerCase() === this.wslName.toLowerCase());
    if (!has) {
      progress('download', 8, '获取 Alpine minirootfs 版本信息…');
      const info = await resolveAlpineRootfs();
      const dest = path.join(dirs().downloads, info.file);
      if (!fs.existsSync(dest)) {
        progress('download', 12, `下载 Alpine ${info.version} (${info.arch})…`);
        await downloadFile(info.url, dest, ({ percent, text }) => {
          progress('download', 12 + Math.round((percent || 0) * 0.45), `下载 Alpine ${info.version}：${text}`);
        });
      }
      if (info.sha256) {
        progress('verify', 58, '校验 rootfs SHA-256…');
        const actual = await sha256File(dest);
        if (actual !== info.sha256) throw new Error(`Alpine rootfs 校验失败（期望 ${info.sha256}，实际 ${actual}）`);
      }
      const root = path.join(dirs().linux, 'wsl');
      ensureDir(root);
      progress('import', 62, '导入 WSL2 发行版（MolvOS）…');
      const imported = await run('wsl.exe', ['--import', this.wslName, root, dest, '--version', '2'], { timeout: 10 * 60 * 1000 });
      if (!imported.ok) {
        const fallback = await run('wsl.exe', ['--import', this.wslName, root, dest], { timeout: 10 * 60 * 1000 });
        if (!fallback.ok) throw new Error(`WSL 导入失败：${(imported.stderr || imported.error || '').slice(0, 500)}`);
        await run('wsl.exe', ['--set-version', this.wslName, '2'], { timeout: 5 * 60 * 1000 });
      }
      progress('import', 72, 'WSL2 发行版导入完成');
    } else {
      progress('import', 72, '检测到已导入的 MolvOS 发行版');
    }

    progress('packages', 76, '更新 Alpine 软件源…');
    const update = await run('wsl.exe', ['-d', this.wslName, '-u', 'root', '--', 'sh', '-lc', 'apk update'], { timeout: 10 * 60 * 1000 });
    if (!update.ok) throw new Error(`apk update 失败：${(update.stderr || update.error || '').slice(0, 600)}`);
    const pkgs = PACKAGE_SETS[variant] || PACKAGE_SETS.slim;
    progress('packages', 82, `安装基础组件：${pkgs.join(' ')}…`);
    const add = await run('wsl.exe', ['-d', this.wslName, '-u', 'root', '--', 'sh', '-lc', `apk add --no-cache ${pkgs.map((x) => `'${x}'`).join(' ')}`], { timeout: 30 * 60 * 1000 });
    if (!add.ok) throw new Error(`软件包安装失败：${(add.stderr || add.error || '').slice(0, 800)}`);

    progress('verify', 96, '验证 Linux 环境…');
    const probe = await run('wsl.exe', ['-d', this.wslName, '-u', 'root', '--', 'sh', '-lc', 'printf MOLV_OK; uname -a; echo; cat /etc/alpine-release'], { timeout: 30000 });
    if (!probe.ok) throw new Error(`环境验证失败：${(probe.stderr || probe.error || '').slice(0, 500)}`);
    this.store.patch({
      linux: { installed: true, installedAt: new Date().toISOString(), method: 'wsl', rootfs: this.rootfsPath, lastCheck: new Date().toISOString() },
      setup: { linux: 'ok' },
    });
    progress('done', 100, '墨绿 Linux 环境安装完成');
    return {
      ok: true,
      method: 'wsl',
      version: (probe.stdout.match(/[\d.]+(?=\s*$)/) || [])[0] || null,
      detail: probe.stdout.replace('MOLV_OK', '').trim(),
      packages: pkgs,
      message: 'Linux 环境已安装并可用',
    };
  }

  async installLinuxRootfs({ variant, progress }) {
    const root = this.rootfsPath;
    if (!fs.existsSync(path.join(root, 'bin', 'sh'))) {
      progress('download', 8, '获取 Alpine minirootfs 版本信息…');
      const info = await resolveAlpineRootfs();
      const dest = path.join(dirs().downloads, info.file);
      if (!fs.existsSync(dest)) {
        progress('download', 12, `下载 Alpine ${info.version}…`);
        await downloadFile(info.url, dest, ({ percent, text }) => {
          progress('download', 12 + Math.round((percent || 0) * 0.55), `下载 Alpine：${text}`);
        });
      }
      if (info.sha256) {
        const actual = await sha256File(dest);
        if (actual !== info.sha256) throw new Error('Alpine rootfs 校验失败');
      }
      ensureDir(root);
      progress('extract', 72, '解压 rootfs…');
      const tar = await run('tar', ['-xzf', dest, '-C', root], { timeout: 10 * 60 * 1000 });
      if (!tar.ok) throw new Error(`解压失败：${tar.error || tar.stderr}`);
    }
    progress('done', 100, 'Linux rootfs 已就绪');
    this.store.patch({ linux: { installed: true, installedAt: new Date().toISOString(), method: process.getuid && process.getuid() === 0 ? 'chroot' : 'proot', rootfs: root } });
    return { ok: true, method: 'chroot', message: 'Alpine rootfs 已安装', packages: PACKAGE_SETS[variant] || PACKAGE_SETS.slim };
  }

  terminalCommand() {
    if (process.platform === 'win32') {
      return {
        file: 'wsl.exe',
        args: ['-d', this.wslName, '-u', 'root', '--cd', '/root', '--', 'bash', '-il'],
        label: `WSL · ${this.wslName}`,
      };
    }
    const root = this.rootfsPath;
    const hasRootfs = fs.existsSync(path.join(root, 'bin', 'sh'));
    if (hasRootfs && process.getuid && process.getuid() === 0) {
      return { file: 'chroot', args: [root, '/bin/bash', '-il'], label: 'chroot · Alpine' };
    }
    const proot = path.join(dirs().base, 'bin', 'proot');
    if (hasRootfs && fs.existsSync(proot)) {
      return {
        file: proot,
        args: ['-r', root, '-0', '-w', '/root', '-b', '/proc', '-b', '/dev', '-b', '/sys', '/bin/bash', '-il'],
        label: 'proot · Alpine',
      };
    }
    return { file: '/bin/bash', args: ['-il'], label: '原生 Linux shell' };
  }

  async openTerminal(options = {}) {
    const status = await this.status();
    if (process.platform === 'win32' && !status.installed) {
      throw new Error('请先安装 Linux 环境（需要 WSL2）');
    }
    const spec = this.terminalCommand();
    const id = `term-${++this.sessionSeq}`;
    const child = spawnStream(spec.file, spec.args, {
      cwd: process.env.USERPROFILE || process.env.HOME || undefined,
      env: {
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: 'C.UTF-8',
        PS1: '\\[\\033[38;5;79m\\]molv\\[\\033[0m\\]:\\w\\$ ',
        PROMPT_COMMAND: '',
      },
    });
    const session = { id, child, spec, buffer: '', startedAt: Date.now() };
    this.sessions.set(id, session);
    const emit = (type, data) => this.emit('terminal', { id, type, data });
    child.stdout.on('data', (d) => emit('data', d.toString('utf8')));
    child.stderr.on('data', (d) => emit('data', d.toString('utf8')));
    child.on('error', (err) => emit('data', `\r\n\x1b[31m启动失败：${err.message}\x1b[0m\r\n`));
    child.on('close', (code) => {
      emit('exit', code);
      this.sessions.delete(id);
    });
    setTimeout(() => {
      try {
        child.stdin.write("printf '\\033[38;5;79m墨绿OS Linux\\033[0m · %s\\n' \"$(uname -srm)\"; pwd\n");
      } catch (_) {}
    }, 500);
    return { id, label: spec.label, pid: child.pid, method: status.method };
  }

  writeTerminal(id, data) {
    const s = this.sessions.get(id);
    if (!s) throw new Error('终端会话不存在或已结束');
    if (typeof data !== 'string' || data.length > 16384) throw new Error('输入内容过长');
    s.child.stdin.write(data);
    return { ok: true };
  }

  closeTerminal(id) {
    const s = this.sessions.get(id);
    if (!s) return { ok: true };
    try {
      if (process.platform === 'win32') {
        require('child_process').execFile('taskkill.exe', ['/PID', String(s.child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      } else {
        s.child.kill('SIGTERM');
      }
    } catch (_) {}
    this.sessions.delete(id);
    return { ok: true };
  }

  async exec(command, options = {}) {
    if (typeof command !== 'string' || !command.trim()) throw new Error('命令不能为空');
    if (command.length > 8192) throw new Error('命令过长');
    const status = await this.status();
    if (process.platform === 'win32') {
      if (!status.installed) throw new Error('Linux 环境尚未安装');
      return run('wsl.exe', ['-d', this.wslName, '-u', 'root', '--', 'sh', '-lc', command], { timeout: options.timeout || 120000, cwd: options.cwd });
    }
    const hasRootfs = fs.existsSync(path.join(this.rootfsPath, 'bin', 'sh'));
    if (hasRootfs && process.getuid && process.getuid() === 0) {
      return run('chroot', [this.rootfsPath, '/bin/sh', '-lc', command], { timeout: options.timeout || 120000 });
    }
    return run('/bin/sh', ['-lc', command], { timeout: options.timeout || 120000, cwd: options.cwd });
  }

  async installPackages(packages) {
    if (!Array.isArray(packages) || packages.length === 0) throw new Error('没有要安装的软件包');
    const safe = packages.filter((p) => /^[a-z0-9][a-z0-9+_.-]*$/i.test(p)).join(' ');
    const status = await this.status();
    if (process.platform === 'win32') {
      if (!status.installed) throw new Error('Linux 环境尚未安装');
      return run('wsl.exe', ['-d', this.wslName, '-u', 'root', '--', 'sh', '-lc', `apk add --no-cache ${safe}`], { timeout: 30 * 60 * 1000 });
    }
    return run('sh', ['-lc', `apk add --no-cache ${safe}`], { timeout: 30 * 60 * 1000 });
  }

  closeAll() {
    for (const id of Array.from(this.sessions.keys())) this.closeTerminal(id);
  }
}

module.exports = { LinuxManager, PACKAGE_SETS, resolveAlpineRootfs, downloadFile, formatBytes };
