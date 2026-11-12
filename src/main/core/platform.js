'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { run, powershell } = require('./exec');

let electron = null;
try { electron = require('electron'); } catch (_) { electron = null; }

let factsCache = { at: 0, data: null };
let wslCache = { at: 0, data: null };

function isWindows() { return process.platform === 'win32'; }
function isLinux() { return process.platform === 'linux'; }
function isMac() { return process.platform === 'darwin'; }

let adminCache = { at: 0, value: false };
async function isAdmin() {
  if (Date.now() - adminCache.at < 5000) return adminCache.value;
  if (isWindows()) {
    const r = await powershell(
      '$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
      { timeout: 5000 },
    );
    adminCache = { at: Date.now(), value: /true/i.test(r.stdout) };
    return adminCache.value;
  }
  if (isLinux() || isMac()) {
    try { return process.getuid && process.getuid() === 0; } catch (_) { return false; }
  }
  return false;
}

async function windowsFacts() {
  if (factsCache.data && Date.now() - factsCache.at < 10000) return factsCache.data;
  const script = `
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$longPaths = $null
try { $longPaths = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' -Name LongPathsEnabled -ErrorAction Stop).LongPathsEnabled } catch {}
$devMode = $null
try { $devMode = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock' -Name AllowDevelopmentWithoutDevLicense -ErrorAction Stop).AllowDevelopmentWithoutDevLicense } catch {}
[pscustomobject]@{
  manufacturer = $cs.Manufacturer
  model = $cs.Model
  totalMemory = $cs.TotalPhysicalMemory
  hypervisorPresent = $cs.HypervisorPresent
  cpu = $cpu.Name
  cores = $cpu.NumberOfCores
  threads = $cpu.NumberOfLogicalProcessors
  virtualizationFirmware = $cpu.VirtualizationFirmwareEnabled
  slat = $cpu.SecondLevelAddressTranslationExtensions
  longPaths = $longPaths
  developerMode = $devMode
  osCaption = $os.Caption
  osBuild = $os.BuildNumber
} | ConvertTo-Json -Compress
`;
  const r = await powershell(script, { timeout: 7000 });
  if (!r.ok || !r.stdout.trim()) {
    const fallback = {
      ok: false,
      error: r.error || '无法读取 Windows 系统信息',
      cpu: (os.cpus()[0] || {}).model,
      cores: os.cpus().length,
      threads: os.cpus().length,
      totalMemory: os.totalmem(),
    };
    factsCache = { at: Date.now(), data: fallback };
    return fallback;
  }
  try {
    const obj = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
    const data = { ok: true, ...obj };
    factsCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    const fallback = { ok: false, error: `系统信息解析失败：${err.message}`, raw: r.stdout.slice(0, 800), cpu: (os.cpus()[0] || {}).model };
    factsCache = { at: Date.now(), data: fallback };
    return fallback;
  }
}

async function wslFacts() {
  if (!isWindows()) return { available: false, distros: [], running: false };
  if (wslCache.data && Date.now() - wslCache.at < 8000) return wslCache.data;
  const list = await run('wsl.exe', ['-l', '-q'], { timeout: 3500 });
  const distros = list.ok
    ? list.stdout.replace(/\u0000/g, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    : [];
  const version = await run('wsl.exe', ['--version'], { timeout: 3500 });
  const data = {
    available: list.ok || version.ok,
    listOk: list.ok,
    distros,
    hasMolv: distros.some((d) => d.toLowerCase() === 'molvos'),
    versionOk: version.ok,
    version: (version.stdout || '').replace(/\u0000/g, '').split(/\r?\n/)[0] || null,
    rawStatus: (list.stderr || '').replace(/\u0000/g, '').slice(0, 800),
  };
  wslCache = { at: Date.now(), data };
  return data;
}

async function virtualization() {
  if (isWindows()) {
    const [facts, wsl, admin] = await Promise.all([windowsFacts(), wslFacts(), isAdmin()]);
    if (!facts.ok) {
      return {
        platform: 'windows', supported: false, enabled: false, hypervisor: false,
        wsl: false, admin, detail: facts.error, cpu: null, method: 'unknown',
      };
    }
    const hypervisor = Boolean(facts.hypervisorPresent);
    const wslFeature = facts.wslState === 1 || facts.wslState === 2 || wsl.available;
    const enabled = hypervisor || (wslFeature && wsl.hasMolv);
    const cpuSupported = Boolean(facts.virtualizationFirmware || facts.slat);
    let detail;
    if (wsl.hasMolv) detail = 'WSL 墨绿 Linux 环境已可用';
    else if (hypervisor) detail = '检测到 Hyper-V 虚拟化监控程序，可安装 WSL2';
    else if (wsl.available) detail = 'WSL 组件可用，但尚未导入墨绿 Linux 环境';
    else if (cpuSupported) detail = 'CPU 支持硬件虚拟化，需要启用 WSL2 组件并重启';
    else detail = '未检测到可用的硬件虚拟化，Linux 环境将使用兼容模式';
    return {
      platform: 'windows',
      supported: cpuSupported || wslFeature,
      enabled,
      hypervisor,
      wsl: wsl.available,
      wslDistros: wsl.distros,
      wslHasMolv: wsl.hasMolv,
      admin,
      cpu: facts.cpu,
      cores: facts.cores,
      threads: facts.threads,
      firmware: Boolean(facts.virtualizationFirmware),
      slat: Boolean(facts.slat),
      method: wsl.hasMolv ? 'wsl' : wsl.available ? 'wsl-ready' : 'wsl-install',
      detail,
      facts,
    };
  }
  if (isLinux()) {
    const kvm = fs.existsSync('/dev/kvm');
    const admin = await isAdmin();
    let detail = kvm ? '检测到 /dev/kvm，可运行 KVM 虚拟机' : '未检测到 /dev/kvm，将使用 chroot/proot 兼容模式';
    return {
      platform: 'linux', supported: kvm, enabled: kvm, hypervisor: kvm, admin,
      cpu: os.cpus()[0] && os.cpus()[0].model, cores: os.cpus().length,
      method: kvm ? 'kvm' : 'proot', detail,
    };
  }
  return {
    platform: process.platform, supported: Boolean(os.cpus().length), enabled: true,
    hypervisor: false, detail: '当前平台使用原生进程隔离', method: 'native',
  };
}

async function permissionsFast() {
  const admin = await isAdmin();
  return {
    platform: process.platform,
    admin,
    fast: true,
    items: [
      { id: 'admin', label: '管理员权限', level: admin ? 'ok' : 'warn', detail: admin ? '已以管理员身份运行' : '日常使用普通权限即可；安装 WSL2 / 制作启动盘时需要提权', action: admin ? null : 'elevate', actionLabel: '以管理员重启' },
      { id: 'integrity', label: '安装文件完整性', level: 'pending', detail: '启动时自动校验', action: 'verify-integrity' },
      { id: 'virtualization', label: '虚拟化与 WSL', level: 'pending', detail: '安装向导中运行完整检测', action: 'open-windows-features' },
      { id: 'storage', label: '磁盘空间', level: 'ok', detail: '建议保留至少 8 GB 可用空间', action: null },
    ],
  };
}

function virtualizationFast() {
  return {
    platform: process.platform,
    supported: true,
    enabled: false,
    hypervisor: false,
    pending: true,
    method: 'pending',
    detail: '待检测：点击安装向导中的“检测”确认 WSL2 / Hyper-V / KVM',
  };
}

async function permissions() {
  if (isWindows()) {
    const [facts, wsl, admin] = await Promise.all([windowsFacts(), wslFacts(), isAdmin()]);
    const items = [
      {
        id: 'admin',
        label: '管理员权限',
        level: admin ? 'ok' : 'warn',
        detail: admin ? '已以管理员身份运行，可管理启动盘与系统组件' : '普通权限即可日常使用；制作启动盘/安装 WSL 时需要提权',
        action: admin ? null : 'elevate',
        actionLabel: '以管理员重启',
      },
      {
        id: 'integrity',
        label: '安装文件完整性',
        level: 'pending',
        detail: '将在启动检查中校验',
        action: 'verify-integrity',
        actionLabel: '立即校验',
      },
      {
        id: 'virtualization',
        label: '虚拟化与 WSL',
        level: wsl.hasMolv ? 'ok' : wsl.available ? 'warn' : 'missing',
        detail: wsl.hasMolv ? '墨绿 Linux 环境可用' : wsl.available ? 'WSL 已启用，尚未安装 Linux 环境' : '未启用 WSL2；安装 Linux 环境需要此组件',
        action: 'open-windows-features',
        actionLabel: '查看系统设置',
      },
      {
        id: 'longpaths',
        label: '长路径支持',
        level: facts.ok && facts.longPaths === 1 ? 'ok' : 'warn',
        detail: facts.ok && facts.longPaths === 1 ? '已启用，适合深层编译缓存' : '未启用，极深目录可能出现路径错误',
        action: 'open-longpaths',
        actionLabel: '打开设置说明',
      },
      {
        id: 'devmode',
        label: '开发者模式',
        level: facts.ok && facts.developerMode === 1 ? 'ok' : 'warn',
        detail: facts.ok && facts.developerMode === 1 ? '已启用' : '可选，便于调试与侧载组件',
        action: 'open-developer',
        actionLabel: '打开开发者设置',
      },
      {
        id: 'storage',
        label: '磁盘空间',
        level: 'ok',
        detail: '建议至少保留 8 GB 可用空间用于 Linux 环境与工具链',
        action: null,
      },
    ];
    return { platform: 'windows', admin, items, wsl, facts };
  }

  if (isLinux()) {
    const admin = await isAdmin();
    const kvm = fs.existsSync('/dev/kvm');
    return {
      platform: 'linux', admin,
      items: [
        { id: 'root', label: 'root / sudo', level: admin ? 'ok' : 'warn', detail: admin ? '当前为 root' : '安装系统级工具与制作启动盘需要 sudo', action: null },
        { id: 'kvm', label: '/dev/kvm', level: kvm ? 'ok' : 'warn', detail: kvm ? '硬件虚拟化可用' : '未检测到 KVM，将使用 chroot/proot', action: null },
        { id: 'integrity', label: '安装文件完整性', level: 'pending', detail: '将在启动检查中校验', action: 'verify-integrity' },
        { id: 'storage', label: '磁盘空间', level: 'ok', detail: '建议至少保留 8 GB 可用空间', action: null },
      ],
    };
  }

  return {
    platform: process.platform, admin: false,
    items: [{ id: 'native', label: '原生权限', level: 'ok', detail: '当前平台使用原生权限模型', action: null }],
  };
}

async function openSettings(kind) {
  const map = {
    'open-windows-features': 'ms-settings:optionalfeatures',
    'open-developer': 'ms-settings:developers',
    'open-longpaths': 'ms-settings:developers',
    'open-storage': 'ms-settings:storagesense',
    'open-update': 'ms-settings:windowsupdate',
    'open-network': 'ms-settings:network',
  };
  const uri = map[kind];
  if (uri && electron && electron.shell) {
    await electron.shell.openExternal(uri);
    return { ok: true, uri };
  }
  return { ok: false, error: '当前环境无法打开系统设置' };
}

async function relaunchElevated() {
  if (!isWindows()) return { ok: false, error: '仅 Windows 支持自动提权重启' };
  if (!electron || !electron.app) return { ok: false, error: '仅桌面应用支持提权重启' };
  const exe = process.execPath;
  let argList = '';
  if (!electron.app.isPackaged) {
    argList = `-- \\"${electron.app.getAppPath()}\\"`;
  }
  const script = `Start-Process -FilePath '${exe.replace(/'/g, "''")}' ${argList ? `-ArgumentList '${argList.replace(/'/g, "''")}'` : ''} -Verb RunAs`;
  const r = await powershell(script, { timeout: 15000 });
  if (!r.ok) return { ok: false, error: r.error || '提权请求被取消或失败' };
  setTimeout(() => { try { electron.app.quit(); } catch (_) {} }, 500);
  return { ok: true, message: '已请求管理员权限，确认 UAC 后应用将重启' };
}

function summary() {
  return {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    cpuModel: (os.cpus()[0] || {}).model || '未知',
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    uptime: os.uptime(),
    node: process.versions.node,
    electron: process.versions.electron || null,
  };
}

module.exports = {
  isWindows, isLinux, isMac, isAdmin, permissions, permissionsFast, virtualization, virtualizationFast,
  windowsFacts, wslFacts, openSettings, relaunchElevated, summary,
};
