'use strict';

const os = require('os');
const { run, powershell } = require('./exec');
const { Logger } = require('./logger');

const log = new Logger('tasks');
const PROTECTED = new Set([
  'system', 'idle', 'registry', 'memory compression', 'csrss', 'wininit', 'services',
  'lsass', 'smss', 'winlogon', 'fontdrvhost', 'dwm', 'wudfhost', 'securityhealthservice',
  'trustedinstaller', 'msmpeng', 'audiodg',
]);

class TaskManager {
  constructor() {
    this.last = new Map();
    this.lastAt = 0;
    this.lastCores = os.cpus().length || 1;
  }

  async list() {
    if (process.platform === 'win32') return this.listWindows();
    if (process.platform === 'linux') return this.listLinux();
    return { ok: false, error: '当前平台不支持任务管理器', processes: [], stats: this.basicStats() };
  }

  basicStats() {
    return {
      cpu: 0,
      memory: { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem(), percent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100) },
      uptime: os.uptime(),
      cores: os.cpus().length,
      platform: process.platform,
    };
  }

  async listWindows() {
    const script = `
$procs = Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{
    pid = $_.Id
    name = $_.ProcessName
    cpu = if ($null -ne $_.CPU) { [double]$_.CPU } else { 0 }
    mem = [int64]$_.WorkingSet64
    handles = $_.HandleCount
  }
}
@($procs) | ConvertTo-Json -Depth 3 -Compress
`;
    const r = await powershell(script, { timeout: 20000 });
    if (!r.ok) return { ok: false, error: r.error || '读取进程失败', processes: [], stats: this.basicStats() };
    let raw;
    try {
      raw = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
    } catch (err) {
      return { ok: false, error: `进程数据解析失败：${err.message}`, processes: [], stats: this.basicStats() };
    }
    const list = Array.isArray(raw) ? raw : [raw];
    const now = Date.now();
    const cores = os.cpus().length || 1;
    const elapsed = this.lastAt ? (now - this.lastAt) / 1000 : 0;
    const processes = list.map((p) => {
      const prev = this.last.get(p.pid);
      let percent = 0;
      if (prev && elapsed > 0) {
        percent = Math.max(0, ((Number(p.cpu) || 0) - prev) / elapsed / cores * 100);
      }
      this.last.set(p.pid, Number(p.cpu) || 0);
      return {
        pid: p.pid,
        name: p.name,
        cpu: Math.round(percent * 10) / 10,
        memory: p.mem,
        handles: p.handles,
        protected: PROTECTED.has(String(p.name).toLowerCase()) || p.pid <= 4,
      };
    }).sort((a, b) => (b.cpu - a.cpu) || (b.memory - a.memory));
    this.lastAt = now;
    this.lastCores = cores;
    const total = os.totalmem();
    const free = os.freemem();
    const cpuSum = processes.reduce((a, p) => a + p.cpu, 0);
    return {
      ok: true,
      processes,
      stats: {
        cpu: Math.max(0, Math.min(100, Math.round(cpuSum))),
        memory: { total, free, used: total - free, percent: Math.round(((total - free) / total) * 100) },
        uptime: os.uptime(),
        cores,
        platform: 'windows',
        count: processes.length,
      },
    };
  }

  async listLinux() {
    const r = await run('ps', ['-eo', 'pid=,comm=,%cpu=,%mem=,rss=', '--sort=-%cpu'], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    if (!r.ok) return { ok: false, error: r.error || '读取进程失败', processes: [], stats: this.basicStats() };
    const processes = [];
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(.+?)\s+([\d.]+)\s+([\d.]+)\s+(\d+)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      processes.push({
        pid,
        name: m[2].trim(),
        cpu: Number(m[3]),
        memory: Number(m[5]) * 1024,
        memPercent: Number(m[4]),
        protected: PROTECTED.has(m[2].toLowerCase()) || pid <= 1,
      });
    }
    const total = os.totalmem();
    const free = os.freemem();
    return {
      ok: true,
      processes,
      stats: {
        cpu: Math.round(processes.slice(0, 8).reduce((a, p) => a + p.cpu, 0)),
        memory: { total, free, used: total - free, percent: Math.round(((total - free) / total) * 100) },
        uptime: os.uptime(),
        cores: os.cpus().length,
        platform: 'linux',
        count: processes.length,
      },
    };
  }

  async kill(pid, options = {}) {
    pid = Number(pid);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('PID 不合法');
    if (pid === process.pid) throw new Error('不能结束墨绿OS自身进程');
    if (process.platform === 'win32' && pid <= 4) throw new Error('系统关键进程受保护');
    if (process.platform !== 'win32' && pid <= 1) throw new Error('系统关键进程受保护');
    const list = await this.list();
    const target = (list.processes || []).find((p) => p.pid === pid);
    if (target && target.protected && !options.forceProtected) {
      throw new Error(`“${target.name}”是系统关键进程，已阻止结束`);
    }
    if (!options.confirmed) throw new Error('结束进程需要显式确认');
    if (process.platform === 'win32') {
      const r = await run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: 15000 });
      return { ok: r.ok, pid, name: target ? target.name : null, message: r.ok ? '进程已结束' : (r.stderr || r.error) };
    }
    const r = await run('kill', ['-TERM', String(pid)], { timeout: 10000 });
    return { ok: r.ok, pid, name: target ? target.name : null, message: r.ok ? '已发送终止信号' : (r.stderr || r.error) };
  }

  async openMonitor() {
    if (process.platform === 'win32') {
      return require('./exec').openDetached('resmon.exe', []);
    }
    if (process.platform === 'linux') {
      for (const cmd of ['gnome-system-monitor', 'plasma-systemmonitor', 'xfce4-taskmanager', 'htop']) {
        const r = await run('sh', ['-lc', `command -v ${cmd}`], { timeout: 3000 });
        if (r.ok && r.stdout.trim()) return require('./exec').openDetached(cmd, []);
      }
    }
    return { ok: false, error: '未找到系统监视器' };
  }
}

module.exports = { TaskManager };
