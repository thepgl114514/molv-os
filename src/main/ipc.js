'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');
const { verify } = require('./core/integrity');
const { dirs, ensureDataDirs, dataRoot } = require('./core/paths');
const { tailLogs } = require('./core/logger');
const { isGithubUrl } = require('./core/github');
const platform = require('./core/platform');

const VARIANTS = {
  full: {
    id: 'full', name: '全量安装包', size: '组件最全',
    desc: '适合开发者与创作者，内置完整 Linux 工具链、常用应用与离线组件。',
    components: ['Linux 完整工具链', 'C/C++ · Python · Java · Go · Rust · Node · PHP · Ruby', 'Ollama 推荐安装', 'Android 调试工具', '启动盘制作器', '示例项目与文档'],
  },
  slim: {
    id: 'slim', name: '精简安装包', size: '约 120 MB',
    desc: '默认推荐：保留核心功能，按需下载 Linux 环境与编译工具，安装快。',
    components: ['墨绿OS 工作台', 'Linux 环境安装器', '八种语言编译环境管理', '任务管理器 / 合规扫描 / 文件服务器', '启动盘制作器'],
  },
  minimal: {
    id: 'minimal', name: '极简安装包', size: '约 90 MB',
    desc: '只包含启动器与基础检查，适合低配置设备或完全自定义。',
    components: ['墨绿OS 启动器', '安装向导与完整性检查', 'CLI 工具', '按需安装全部扩展'],
  },
};

function ok(data) { return { ok: true, data }; }
function fail(error, code) { return { ok: false, error: String(error && error.message ? error.message : error), code: code || 'ERROR' }; }

let lastCpu = os.cpus().map((c) => ({ ...c.times }));
function systemStats() {
  const now = os.cpus().map((c) => ({ ...c.times }));
  let total = 0;
  let idle = 0;
  for (let i = 0; i < now.length; i += 1) {
    const prev = lastCpu[i] || now[i];
    const cur = now[i];
    const dTotal = (cur.user - prev.user) + (cur.nice - prev.nice) + (cur.sys - prev.sys) + (cur.idle - prev.idle) + (cur.irq - prev.irq);
    const dIdle = cur.idle - prev.idle;
    total += dTotal;
    idle += dIdle;
  }
  lastCpu = now;
  const cpu = total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : 0;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    cpu,
    memory: { total: totalMem, free: freeMem, used: totalMem - freeMem, percent: Math.round(((totalMem - freeMem) / totalMem) * 100) },
    uptime: os.uptime(),
    cores: os.cpus().length,
    load: os.loadavg(),
  };
}

function validateSender(event) {
  const url = event.senderFrame && event.senderFrame.url;
  if (!url) return false;
  return url.startsWith('file://') || url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:');
}

function registerIpc(ctx) {
  const { store, linux, compilers, android, tasks, scanner, server, github, usb, getWindow } = ctx;

  const send = (type, data) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('molv:event', { type, data, at: Date.now() });
  };

  linux.on('install-progress', (d) => send('linux:install-progress', d));
  linux.on('terminal', (d) => send('linux:terminal', d));
  scanner.on('progress', (d) => send('scan:progress', d));
  scanner.on('hit', (d) => send('scan:hit', d));
  scanner.on('done', (d) => send('scan:done', d));
  server.on('started', (d) => send('server:started', d));
  server.on('stopped', (d) => send('server:stopped', d));
  server.on('request', (d) => send('server:request', d));
  usb.on('progress', (d) => send('usb:progress', d));
  store.on('change', (d) => send('config:change', d));

  async function handle(action, payload = {}) {
    switch (action) {
      case 'app.info': {
        return ok({
          version: app.getVersion(),
          name: '墨绿OS',
          englishName: 'MolvOS',
          platform: process.platform,
          arch: process.arch,
          packaged: app.isPackaged,
          admin: await platform.isAdmin(),
          dataDir: dataRoot(),
          paths: { tools: path.join(process.resourcesPath || '', 'tools'), docs: path.join(process.resourcesPath || '', 'docs'), vault: dirs().vault, logs: dirs().logs },
          variants: VARIANTS,
          config: store.get(),
          summary: platform.summary(),
          electron: process.versions.electron,
          node: process.versions.node,
          license: 'MIT',
        });
      }
      case 'app.bootstrap': {
        const [integrity, perms, virt, linuxStatus, androidStatus] = await Promise.all([
          verify().catch((e) => ({ ok: false, state: 'error', message: e.message })),
          platform.permissionsFast().catch((e) => ({ items: [], error: e.message })),
          Promise.resolve(platform.virtualizationFast()),
          linux.status().catch((e) => ({ installed: false, available: false, message: e.message })),
          linux.status().catch((e) => ({ installed: false, available: false, message: e.message })),
          android.status().catch((e) => ({ devices: [], message: e.message })),
        ]);
        return ok({
          config: store.get(),
          integrity,
          permissions: perms,
          virtualization: virt,
          linux: linuxStatus,
          android: androidStatus,
          variants: VARIANTS,
          app: { version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, admin: perms.admin, dataDir: dataRoot() },
        });
      }
      case 'system.stats': return ok(systemStats());
      case 'app.autostart': {
        const enabled = Boolean(payload.enabled);
        try {
          app.setLoginItemSettings({
            openAtLogin: enabled,
            path: process.execPath,
            args: app.isPackaged ? [] : [app.getAppPath()],
          });
          store.set('autostart', enabled);
          return ok({ enabled, message: enabled ? '已开启开机自启' : '已关闭开机自启' });
        } catch (err) {
          throw new Error(`设置开机自启失败：${err.message}`);
        }
      }
      case 'app.completeSetup': {
        store.patch({ setup: { completed: true, completedAt: new Date().toISOString() } });
        return ok(store.get('setup'));
      }
      case 'config.get': return ok(store.get(payload.key));
      case 'config.patch': {
        if (!payload || typeof payload.patch !== 'object') throw new Error('配置补丁格式不正确');
        return ok(store.patch(payload.patch));
      }
      case 'config.set': {
        if (!payload.key) throw new Error('缺少配置键');
        return ok(store.set(payload.key, payload.value));
      }
      case 'config.export': {
        const result = await dialog.showSaveDialog(getWindow(), {
          title: '导出墨绿OS 配置',
          defaultPath: path.join(app.getPath('documents'), `molv-os-config-${Date.now()}.json`),
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) return ok({ canceled: true });
        fs.writeFileSync(result.filePath, JSON.stringify(store.export(), null, 2), 'utf8');
        return ok({ path: result.filePath });
      }
      case 'config.import': {
        const result = await dialog.showOpenDialog(getWindow(), {
          title: '导入墨绿OS 配置', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'],
        });
        if (result.canceled || !result.filePaths.length) return ok({ canceled: true });
        const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
        store.import(parsed);
        return ok({ path: result.filePaths[0], config: store.get() });
      }
      case 'config.reset': {
        if (!payload.confirmed) throw new Error('重置需要确认');
        return ok(store.reset());
      }
      case 'permissions.check': return ok(await platform.permissions());
      case 'permissions.open': return ok(await platform.openSettings(payload.kind));
      case 'permissions.elevate': return ok(await platform.relaunchElevated());
      case 'integrity.verify': return ok(await verify());
      case 'virt.check': return ok(await platform.virtualization());
      case 'linux.status': return ok(await linux.status());
      case 'linux.install': return ok(await linux.install({ variant: store.get('variant', 'slim'), elevate: Boolean(payload.elevate) }));
      case 'linux.exec': return ok(await linux.exec(payload.command, { timeout: payload.timeout }));
      case 'linux.terminal.open': return ok(await linux.openTerminal());
      case 'linux.terminal.write': return ok(linux.writeTerminal(payload.id, payload.data));
      case 'linux.terminal.close': return ok(linux.closeTerminal(payload.id));
      case 'linux.packages': return ok(await linux.installPackages(payload.packages));
      case 'variant.set': {
        if (!VARIANTS[payload.variant]) throw new Error('未知安装包类型');
        store.patch({ variant: payload.variant, install: { selectedAt: new Date().toISOString() } });
        return ok(VARIANTS[payload.variant]);
      }
      case 'variant.list': return ok(VARIANTS);
      case 'compilers.list': return ok(await compilers.list({ scope: payload.scope }));
      case 'compilers.setEnabled': return ok(await compilers.setEnabled(payload.id, payload.enabled));
      case 'compilers.setScope': return ok(await compilers.setScope(payload.scope));
      case 'compilers.install': return ok(await compilers.install(payload.id, payload.scope));
      case 'compilers.verify': return ok(await compilers.verify(payload.id, payload.scope));
      case 'compilers.installEnabled': return ok(await compilers.installEnabled(payload.scope));
      case 'android.status': return ok(await android.status());
      case 'android.startAdb': return ok(await android.startAdb());
      case 'android.chooseApk': return ok(await android.chooseApk());
      case 'android.inspectApk': return ok(await android.inspectApk(payload.path));
      case 'android.installApk': return ok(await android.installApk(payload.path, { serial: payload.serial, grant: payload.grant }));
      case 'android.launch': return ok(await android.launchPackage(payload.packageName, payload.serial));
      case 'android.emulator': return ok(await android.launchEmulator(payload.avd));
      case 'android.installStudio': return ok(await android.installStudio());
      case 'android.wsa': return ok(await android.wsaStatus());
      case 'tasks.list': return ok(await tasks.list());
      case 'tasks.kill': return ok(await tasks.kill(payload.pid, { confirmed: Boolean(payload.confirmed), forceProtected: Boolean(payload.forceProtected) }));
      case 'tasks.openMonitor': return ok(await tasks.openMonitor());
      case 'scan.roots': return ok(await scanner.roots());
      case 'scan.policy': return ok(scanner.getPolicy());
      case 'scan.policy.set': return ok(scanner.setPolicy(payload.policy));
      case 'scan.start': return ok(await scanner.start({ roots: payload.roots, policy: payload.policy }));
      case 'scan.cancel': return ok(scanner.cancel(payload.id));
      case 'scan.status': return ok(scanner.status());
      case 'scan.quarantine': return ok(await scanner.quarantine(payload.paths, { confirmed: Boolean(payload.confirmed) }));
      case 'scan.report': return ok(await scanner.exportReport());
      case 'server.status': return ok(server.status());
      case 'server.start': return ok(await server.start(payload));
      case 'server.stop': return ok(await server.stop());
      case 'server.map': return ok(await server.mapPort(payload.port));
      case 'server.chooseRoot': {
        const result = await dialog.showOpenDialog(getWindow(), { title: '选择要共享的文件夹', properties: ['openDirectory'] });
        if (result.canceled || !result.filePaths.length) return ok({ canceled: true });
        store.set('server.root', result.filePaths[0]);
        return ok({ path: result.filePaths[0] });
      }
      case 'server.open': {
        const status = server.status();
        if (!status.running) throw new Error('服务器尚未启动');
        await shell.openExternal(status.urls[0]);
        return ok({ url: status.urls[0] });
      }
      case 'github.status': return ok({ mirrors: github.mirrors(), active: github.active(), enabled: store.get('github.enabled', true), lastTest: store.get('github.lastTest'), git: await github.gitInfo() });
      case 'github.set': return ok(github.setMirror(payload.mirror, payload.custom));
      case 'github.test': return ok(await github.testAll());
      case 'github.rewrite': return ok({ url: github.rewrite(payload.url), active: github.active() });
      case 'github.download': {
        if (!isGithubUrl(payload.url)) throw new Error('只支持 GitHub 链接');
        const name = path.basename(new URL(payload.url).pathname) || `download-${Date.now()}`;
        const dest = path.join(dirs().downloads, name);
        const r = await github.download(payload.url, dest, { onProgress: (d) => send('github:download', d) });
        return ok(r);
      }
      case 'github.clone': {
        const dest = payload.dest || path.join(app.getPath('documents'), 'MolvOS-Projects', `repo-${Date.now()}`);
        return ok(await github.clone(payload.url, dest));
      }
      case 'github.gitConfig': return ok(await github.applyGitConfig(Boolean(payload.enabled)));
      case 'usb.disks': return ok(await usb.listDisks());
      case 'usb.chooseIso': return ok(await usb.chooseIso());
      case 'usb.write': return ok(await usb.write(payload));
      case 'usb.cancel': return ok(usb.cancel());
      case 'usb.status': return ok(usb.status());
      case 'logs.tail': return ok({ lines: tailLogs(payload.scope || 'main', payload.lines || 200), dir: dirs().logs });
      case 'logs.open': {
        const err = await shell.openPath(dirs().logs);
        return err ? fail(err) : ok({ path: dirs().logs });
      }
      case 'shell.openPath': {
        if (typeof payload.path !== 'string') throw new Error('路径不合法');
        const target = path.resolve(payload.path);
        if (!fs.existsSync(target)) throw new Error('路径不存在');
        const err = await shell.openPath(target);
        return err ? fail(err) : ok({ path: target });
      }
      case 'shell.openExternal': {
        if (typeof payload.url !== 'string' || !/^https?:\/\//i.test(payload.url)) throw new Error('只允许打开 http/https 链接');
        await shell.openExternal(payload.url);
        return ok({ url: payload.url });
      }
      case 'dialog.chooseFolder': {
        const result = await dialog.showOpenDialog(getWindow(), { title: payload.title || '选择文件夹', defaultPath: payload.defaultPath, properties: ['openDirectory', 'createDirectory'] });
        if (result.canceled || !result.filePaths.length) return ok({ canceled: true });
        return ok({ path: result.filePaths[0] });
      }
      case 'dialog.chooseFile': {
        const result = await dialog.showOpenDialog(getWindow(), {
          title: payload.title || '选择文件',
          filters: payload.filters || [],
          properties: ['openFile'],
        });
        if (result.canceled || !result.filePaths.length) return ok({ canceled: true });
        return ok({ path: result.filePaths[0] });
      }
      case 'app.openDataDir': {
        const err = await shell.openPath(dataRoot());
        return err ? fail(err) : ok({ path: dataRoot() });
      }
      case 'app.openDocs': {
        const docs = app.isPackaged ? path.join(process.resourcesPath, 'docs') : path.join(app.getAppPath(), 'docs');
        const err = await shell.openPath(docs);
        return err ? fail(err) : ok({ path: docs });
      }
      case 'app.quit': setTimeout(() => app.quit(), 100); return ok({});
      case 'app.relaunch': app.relaunch(); setTimeout(() => app.exit(0), 100); return ok({});
      case 'window.minimize': { const w = getWindow(); if (w) w.minimize(); return ok({}); }
      case 'window.maximize': {
        const w = getWindow();
        if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
        return ok({});
      }
      case 'window.close': { const w = getWindow(); if (w) w.close(); return ok({}); }
      case 'window.state': {
        const w = getWindow();
        return ok(w ? { maximized: w.isMaximized(), visible: w.isVisible() } : {});
      }
      default:
        throw new Error(`未知操作：${action}`);
    }
  }

  ipcMain.handle('molv:invoke', async (event, action, payload) => {
    if (!validateSender(event)) return fail('非法调用来源', 'FORBIDDEN');
    try {
      return await handle(action, payload || {});
    } catch (err) {
      return fail(err);
    }
  });
}

module.exports = { registerIpc, VARIANTS, validateSender };
