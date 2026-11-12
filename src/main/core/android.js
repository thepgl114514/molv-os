'use strict';

const fs = require('fs');
const path = require('path');
const { run, openDetached } = require('./exec');
const { toolsRoot, ensureDir, dirs } = require('./paths');

function firstExisting(paths) {
  for (const p of paths) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

class AndroidBridge {
  constructor(store) {
    this.store = store;
  }

  async findAdb() {
    const candidates = [
      path.join(toolsRoot(), 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'),
      process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'),
    ];
    const local = firstExisting(candidates);
    if (local) return local;
    const r = await run(process.platform === 'win32' ? 'where.exe' : 'which', ['adb'], { timeout: 5000 });
    return r.ok ? r.stdout.split(/\r?\n/)[0].trim() : null;
  }

  async findEmulator() {
    const candidates = [
      path.join(toolsRoot(), 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator'),
      process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator'),
    ];
    return firstExisting(candidates);
  }

  async findAapt() {
    const candidates = [
      path.join(toolsRoot(), 'build-tools', '35.0.0', process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'build-tools', '35.0.0', process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'),
    ];
    return firstExisting(candidates);
  }

  async status() {
    const adb = await this.findAdb();
    const emulator = await this.findEmulator();
    const aapt = await this.findAapt();
    let devices = [];
    let adbError = null;
    if (adb) {
      const r = await run(adb, ['devices', '-l'], { timeout: 15000 });
      if (r.ok) {
        devices = r.stdout.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
          const parts = line.split(/\s+/);
          const serial = parts[0];
          const state = parts[1] || 'unknown';
          const model = (line.match(/model:([^\s]+)/) || [])[1] || '';
          const product = (line.match(/product:([^\s]+)/) || [])[1] || '';
          return { serial, state, model, product, online: state === 'device' };
        });
      } else {
        adbError = r.error || r.stderr;
      }
    }
    let avds = [];
    if (emulator) {
      const r = await run(emulator, ['-list-avds'], { timeout: 10000 });
      if (r.ok) avds = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    return {
      platform: process.platform,
      adb: adb ? { path: adb, version: (await run(adb, ['version'], { timeout: 8000 })).stdout.split(/\r?\n/)[0] } : null,
      emulator: emulator ? { path: emulator, avds } : null,
      aapt: aapt || null,
      devices,
      online: devices.filter((d) => d.online).length,
      adbError,
      canRunApk: Boolean(adb && devices.some((d) => d.online)),
      nativeApkSupport: false,
      message: adb
        ? devices.some((d) => d.online)
          ? `已连接 ${devices.filter((d) => d.online).length} 台 Android 设备`
          : avds.length
            ? '未连接设备；可以启动本地 Android 模拟器'
            : '未连接设备。请连接手机并开启 USB 调试，或安装 Android 模拟器'
        : '未找到 adb。安装 Android SDK Platform-Tools 或 Android Studio 后即可安装 APK',
      requirements: ['Android 设备开启“开发者选项 → USB 调试”', 'Windows 需安装 adb 与 Android 模拟器（或连接真机）', 'APK 不能由 Windows 原生直接运行，必须通过 Android 运行环境'],
    };
  }

  async startAdb() {
    const adb = await this.findAdb();
    if (!adb) throw new Error('未找到 adb');
    const r = await run(adb, ['start-server'], { timeout: 15000 });
    return { ok: r.ok, output: (r.stdout + r.stderr).trim() };
  }

  async inspectApk(file) {
    if (!file || !fs.existsSync(file)) throw new Error('APK 文件不存在');
    if (path.extname(file).toLowerCase() !== '.apk') throw new Error('请选择 .apk 文件');
    const aapt = await this.findAapt();
    let packageName = null;
    let label = null;
    let version = null;
    if (aapt) {
      const r = await run(aapt, ['dump', 'badging', file], { timeout: 20000 });
      if (r.ok) {
        packageName = (r.stdout.match(/package: name='([^']+)'/) || [])[1] || null;
        label = (r.stdout.match(/application-label:'([^']*)'/) || [])[1] || null;
        version = (r.stdout.match(/versionName='([^']+)'/) || [])[1] || null;
      }
    }
    const stat = fs.statSync(file);
    return { path: file, name: path.basename(file), size: stat.size, packageName, label, version };
  }

  async installApk(file, options = {}) {
    const info = await this.inspectApk(file);
    const adb = await this.findAdb();
    if (!adb) throw new Error('未找到 adb，请先安装 Android SDK Platform-Tools');
    const devices = (await this.status()).devices.filter((d) => d.online);
    if (devices.length === 0) throw new Error('没有在线的 Android 设备或模拟器。请连接设备并开启 USB 调试');
    const serial = options.serial || devices[0].serial;
    const args = ['-s', serial, 'install', '-r'];
    if (options.grant) args.push('-g');
    args.push(info.path);
    const r = await run(adb, args, { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    const output = `${r.stdout}\n${r.stderr}`.trim();
    if (!r.ok || /Failure|Error/i.test(output)) throw new Error(`APK 安装失败：${output.slice(-1200) || r.error}`);
    this.store.patch({ android: { lastApk: info.path } });
    return { ok: true, ...info, serial, output: output.slice(-1500), message: `已安装 ${info.label || info.name}` };
  }

  async launchPackage(packageName, serial) {
    if (!/^[a-zA-Z0-9._]+$/.test(packageName || '')) throw new Error('包名不合法');
    const adb = await this.findAdb();
    if (!adb) throw new Error('未找到 adb');
    const devices = (await this.status()).devices.filter((d) => d.online);
    if (!devices.length) throw new Error('没有在线设备');
    const r = await run(adb, ['-s', serial || devices[0].serial, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 30000 });
    return { ok: r.ok, output: (r.stdout + r.stderr).slice(-1200) };
  }

  async launchEmulator(avd) {
    const emulator = await this.findEmulator();
    if (!emulator) throw new Error('未找到 Android 模拟器。请安装 Android Studio 并在 Device Manager 中创建 AVD');
    const status = await this.status();
    const avds = status.emulator ? status.emulator.avds : [];
    if (!avds.length) throw new Error('尚未创建 Android 虚拟设备（AVD）。请在 Android Studio → Device Manager 中创建');
    const name = avd || avds[0];
    const r = openDetached(emulator, ['-avd', name]);
    return { ok: true, avd: name, pid: r.pid, message: `正在启动模拟器 ${name}，首次启动可能需要几分钟` };
  }

  async installStudio() {
    const r = await run('winget.exe', ['install', '--id', 'Google.AndroidStudio', '--exact', '--accept-source-agreements', '--accept-package-agreements'], { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
    if (!r.ok) throw new Error(`安装 Android Studio 失败：${(r.stderr || r.error || '').slice(0, 1000)}`);
    return { ok: true, output: (r.stdout + r.stderr).slice(-2000), message: 'Android Studio 安装完成，请打开并安装 SDK / 创建模拟器' };
  }

  async wsaStatus() {
    if (process.platform !== 'win32') return { supported: false };
    const { powershell } = require('./exec');
    const r = await powershell('Get-AppxPackage -Name "MicrosoftCorporationII.WindowsSubsystemForAndroid" | Select-Object Name,Version,InstallLocation | ConvertTo-Json -Compress', { timeout: 15000 });
    if (!r.ok || !r.stdout.trim()) return { supported: false, installed: false, message: '未安装 Windows Subsystem for Android（微软已逐步停止支持）' };
    try {
      const data = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
      return { supported: true, installed: true, ...data };
    } catch (_) {
      return { supported: false, installed: false };
    }
  }

  async chooseApk() {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      title: '选择 Android 安装包',
      filters: [{ name: 'Android APK', extensions: ['apk'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return this.inspectApk(result.filePaths[0]);
  }
}

module.exports = { AndroidBridge };
