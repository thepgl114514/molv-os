'use strict';

const fs = require('fs');
const path = require('path');
const { run } = require('./exec');
const { toolsRoot } = require('./paths');
const { Logger } = require('./logger');

const log = new Logger('compilers');

const DEFS = [
  {
    id: 'cpp', name: 'C / C++', short: 'C++', color: '#6fd3ff',
    desc: 'GCC / G++ 与 make，适合系统编程与算法练习',
    commands: ['g++', 'gcc'], versionArgs: ['--version'], linuxCmd: 'g++',
    winget: 'MSYS2.MSYS2', apk: 'build-base', apt: 'build-essential', dnf: 'gcc-c++ make', pacman: 'base-devel',
    portable: ['w64devkit/bin/g++.exe'],
    website: 'https://gcc.gnu.org/',
  },
  {
    id: 'python', name: 'Python', short: 'Python', color: '#ffd166',
    desc: 'Python 3 与 pip，数据处理、脚本与 AI 工具的基础',
    commands: ['python', 'python3'], versionArgs: ['--version'], linuxCmd: 'python3',
    winget: 'Python.Python.3.12', apk: 'python3', apt: 'python3 python3-pip', dnf: 'python3 python3-pip', pacman: 'python python-pip',
    portable: ['python/python.exe'],
    website: 'https://www.python.org/',
  },
  {
    id: 'java', name: 'Java', short: 'Java', color: '#ff9b71',
    desc: 'OpenJDK 运行时与编译器，可运行 JAR / Android 工具',
    commands: ['java'], versionArgs: ['-version'], linuxCmd: 'java',
    winget: 'EclipseAdoptium.Temurin.21.JDK', apk: 'openjdk17-jdk', apt: 'default-jdk', dnf: 'java-17-openjdk-devel', pacman: 'jdk-openjdk',
    portable: [],
    website: 'https://adoptium.net/',
  },
  {
    id: 'node', name: 'Node.js', short: 'Node', color: '#8ee78e',
    desc: 'JavaScript / TypeScript 运行时与 npm 生态',
    commands: ['node'], versionArgs: ['--version'], linuxCmd: 'node',
    winget: 'OpenJS.NodeJS.LTS', apk: 'nodejs npm', apt: 'nodejs npm', dnf: 'nodejs npm', pacman: 'nodejs npm',
    portable: [],
    website: 'https://nodejs.org/',
  },
  {
    id: 'go', name: 'Go', short: 'Go', color: '#65d9e8',
    desc: '静态编译、云原生与高并发服务开发',
    commands: ['go'], versionArgs: ['version'], linuxCmd: 'go',
    winget: 'GoLang.Go', apk: 'go', apt: 'golang-go', dnf: 'golang', pacman: 'go',
    portable: ['go/bin/go.exe'],
    website: 'https://go.dev/',
  },
  {
    id: 'rust', name: 'Rust', short: 'Rust', color: '#e8a27a',
    desc: '内存安全系统语言，附带 cargo 包管理器',
    commands: ['rustc'], versionArgs: ['--version'], linuxCmd: 'rustc',
    winget: 'Rustlang.Rustup', apk: 'rust cargo', apt: 'rustc cargo', dnf: 'rust cargo', pacman: 'rust',
    portable: [],
    website: 'https://www.rust-lang.org/',
  },
  {
    id: 'php', name: 'PHP', short: 'PHP', color: '#b79cff',
    desc: 'Web 后端与脚本语言，适合快速构建站点',
    commands: ['php'], versionArgs: ['-v'], linuxCmd: 'php',
    winget: 'PHP.PHP', apk: 'php', apt: 'php-cli', dnf: 'php-cli', pacman: 'php',
    portable: [],
    website: 'https://www.php.net/',
  },
  {
    id: 'ruby', name: 'Ruby', short: 'Ruby', color: '#ff8fa3',
    desc: '简洁的动态语言与 Rails 生态',
    commands: ['ruby'], versionArgs: ['-v'], linuxCmd: 'ruby',
    winget: 'RubyInstallerTeam.Ruby.3.2', apk: 'ruby', apt: 'ruby', dnf: 'ruby', pacman: 'ruby',
    portable: [],
    website: 'https://www.ruby-lang.org/',
  },
];

const byId = new Map(DEFS.map((d) => [d.id, d]));

function cleanVersion(text) {
  const line = String(text || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  return line.replace(/\s+/g, ' ').slice(0, 160);
}

class CompilerManager {
  constructor(store, linux) {
    this.store = store;
    this.linux = linux;
    this.cache = new Map();
  }

  getScope() {
    return this.store.get('compilers.scope', 'device');
  }

  async detectDevice(def) {
    for (const rel of def.portable || []) {
      const exe = path.join(toolsRoot(), rel);
      if (fs.existsSync(exe)) {
        const r = await run(exe, def.versionArgs, { timeout: 15000 });
        return {
          installed: true, portable: true, path: exe,
          version: cleanVersion(r.stdout || r.stderr) || '内置便携版',
        };
      }
    }
    for (const cmd of def.commands) {
      const where = process.platform === 'win32'
        ? await run('where.exe', [cmd], { timeout: 5000 })
        : await run('sh', ['-lc', `command -v ${cmd}`], { timeout: 5000 });
      if (!where.ok || !where.stdout.trim()) continue;
      const exe = where.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      const r = await run(exe, def.versionArgs, { timeout: 15000 });
      const version = cleanVersion(r.stdout || r.stderr);
      if (version) return { installed: true, portable: false, path: exe, version };
    }
    return { installed: false, portable: false, path: null, version: null };
  }

  async detectLinux(def) {
    const status = await this.linux.status();
    if (!status.installed) {
      return { installed: false, path: null, version: null, unavailable: true, reason: 'Linux 环境尚未安装' };
    }
    const r = await this.linux.exec(`command -v ${def.linuxCmd} >/dev/null 2>&1 && (${def.linuxCmd} ${def.versionArgs.join(' ')} 2>&1 | head -n 1) || true`, { timeout: 30000 });
    const version = cleanVersion(r.stdout);
    return { installed: Boolean(version), path: version ? `/usr/bin/${def.linuxCmd}` : null, version: version || null };
  }

  async detectOne(id, scope) {
    const def = byId.get(id);
    if (!def) throw new Error(`未知编译环境：${id}`);
    const result = scope === 'linux' ? await this.detectLinux(def) : await this.detectDevice(def);
    const enabled = Boolean(this.store.get(`compilers.enabled.${id}`, false));
    return { ...def, ...result, id, enabled, scope };
  }

  async list(options = {}) {
    const scope = options.scope || this.getScope();
    const results = await Promise.all(DEFS.map((d) => this.detectOne(d.id, scope).catch((err) => ({
      ...d, id: d.id, installed: false, version: null, path: null, enabled: false, scope, error: err.message,
    }))));
    this.store.set('compilers.lastCheck', new Date().toISOString(), { silent: true });
    return { scope, compilers: results, checkedAt: new Date().toISOString() };
  }

  async setEnabled(id, enabled) {
    if (!byId.has(id)) throw new Error(`未知编译环境：${id}`);
    this.store.set(`compilers.enabled.${id}`, Boolean(enabled));
    return { ok: true, id, enabled: Boolean(enabled) };
  }

  async setScope(scope) {
    if (!['device', 'linux'].includes(scope)) throw new Error('作用域只能是 device 或 linux');
    this.store.set('compilers.scope', scope);
    return { ok: true, scope };
  }

  async install(id, scope = this.getScope()) {
    const def = byId.get(id);
    if (!def) throw new Error(`未知编译环境：${id}`);
    if (scope === 'linux') {
      const status = await this.linux.status();
      if (!status.installed) throw new Error('请先安装 Linux 环境，再安装 Linux 内的编译环境');
      const r = await this.linux.installPackages(def.apk.split(' '));
      if (!r.ok) throw new Error(`Linux 软件包安装失败：${r.error || r.stderr}`);
      this.store.set(`compilers.installed.${id}`, { scope, at: new Date().toISOString(), method: 'apk' });
      await this.detectOne(id, scope);
      return { ok: true, method: 'apk', output: (r.stdout || '').slice(-2000), message: `${def.name} 已安装到 Linux 环境` };
    }

    if (process.platform === 'win32') {
      const w = await run('winget.exe', ['--version'], { timeout: 8000 });
      if (!w.ok) throw new Error('未找到 winget。请从 Microsoft Store 安装“应用安装程序”，或手动安装。');
      const args = ['install', '--id', def.winget, '--exact', '--accept-source-agreements', '--accept-package-agreements', '--silent', '--disable-interactivity'];
      const r = await run('winget.exe', args, { timeout: 20 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
      const output = `${r.stdout}\n${r.stderr}`.trim().slice(-4000);
      if (!r.ok && !/already installed|已安装|No applicable update|没有可用的升级/i.test(output)) {
        throw new Error(`winget 安装失败：${output.slice(-1200) || r.error}`);
      }
      this.store.set(`compilers.installed.${id}`, { scope, at: new Date().toISOString(), method: 'winget' });
      return { ok: true, method: 'winget', output, message: `${def.name} 安装命令已完成；如未生效请重新打开终端`, needsRestart: true };
    }

    if (process.platform === 'linux') {
      const hint = await this.packageHint(def);
      return {
        ok: false,
        manual: true,
        message: `为了不擅自修改系统，请在终端执行：${hint}`,
        command: hint,
      };
    }
    throw new Error('当前平台暂不支持一键安装编译环境');
  }

  async packageHint(def) {
    const checks = [
      ['apt-get', `sudo apt-get update && sudo apt-get install -y ${def.apt}`],
      ['dnf', `sudo dnf install -y ${def.dnf}`],
      ['pacman', `sudo pacman -S --needed ${def.pacman}`],
      ['zypper', `sudo zypper install -y ${def.apt}`],
    ];
    for (const [cmd, hint] of checks) {
      const r = await run('sh', ['-lc', `command -v ${cmd}`], { timeout: 4000 });
      if (r.ok) return hint;
    }
    return `请使用系统包管理器安装：${def.apt}`;
  }

  async verify(id, scope = this.getScope()) {
    const one = await this.detectOne(id, scope);
    return { ok: Boolean(one.installed), id, version: one.version, path: one.path, scope };
  }

  async installEnabled(scope = this.getScope()) {
    const enabled = Object.entries(this.store.get('compilers.enabled', {})).filter(([, v]) => v).map(([k]) => k);
    const results = [];
    for (const id of enabled) {
      try {
        const r = await this.install(id, scope);
        results.push({ id, ...r });
      } catch (err) {
        results.push({ id, ok: false, error: err.message });
      }
    }
    return results;
  }
}

module.exports = { CompilerManager, DEFS };
