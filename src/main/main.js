'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, session, dialog } = require('electron');

app.setName('MolvOS');
let userDataSetupError = null;

function canWriteDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

const candidates = [];
if (process.env.MOLV_USERDATA) candidates.push(path.resolve(process.env.MOLV_USERDATA));
if (process.platform === 'win32') {
  candidates.push(path.join(app.getPath('home'), 'AppData', 'Local', 'MolvOS'));
  candidates.push(path.join(app.getPath('home'), 'AppData', 'Roaming', 'MolvOS'));
  candidates.push(path.join(app.getPath('home'), 'MolvOS-Data'));
  candidates.push(path.join(path.dirname(process.execPath), 'MolvOS-Data'));
  candidates.push(path.join(process.cwd(), '.molv-data'));
} else {
  candidates.push(path.join(app.getPath('appData'), 'MolvOS'));
  candidates.push(path.join(path.dirname(process.execPath), 'MolvOS-Data'));
}

let gotLock = false;
for (const dir of candidates) {
  if (!canWriteDir(dir)) {
    userDataSetupError = `目录不可写：${dir}`;
    continue;
  }
  try {
    app.setPath('userData', dir);
    gotLock = process.env.MOLV_NO_SINGLE_INSTANCE === '1' ? true : app.requestSingleInstanceLock();
    if (gotLock) break;
    userDataSetupError = `单实例锁不可用：${dir}`;
  } catch (err) {
    userDataSetupError = `${dir}: ${err.message}`;
  }
}
if (!gotLock) {
  // Some locked-down Windows profiles deny Chromium's singleton lock even when
  // the directory is writable. Start anyway rather than silently doing nothing.
  gotLock = true;
  userDataSetupError = (userDataSetupError || '') + '；已跳过单实例锁';
}
app.setAppUserModelId('os.molv.center');

try {
  if (!app.isPackaged) fs.appendFileSync(path.join(__dirname, '..', '..', 'boot.log'), `${new Date().toISOString()} boot appPath=${app.getAppPath()} userData=${app.getPath('userData')} setupError=${userDataSetupError || 'none'}\n`);
} catch (_) {}

bootstrap();

let mainWindow = null;
let tray = null;
let quitting = false;
let services = null;
let saveBoundsTimer = null;

function iconPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(__dirname, '..', '..', 'build', 'icon.png'),
  ];
  return candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } }) || null;
}

function restoreBounds(store) {
  const w = store.get('window', {});
  const bounds = { width: Math.max(980, Number(w.width) || 1280), height: Math.max(640, Number(w.height) || 840) };
  if (Number.isFinite(w.x) && Number.isFinite(w.y)) {
    const displays = require('electron').screen.getAllDisplays();
    const visible = displays.some((d) => {
      const b = d.workArea;
      return w.x >= b.x - 50 && w.y >= b.y - 50 && w.x < b.x + b.width - 100 && w.y < b.y + b.height - 100;
    });
    if (visible) { bounds.x = w.x; bounds.y = w.y; }
  }
  return bounds;
}

function createWindow(store) {
  const bounds = restoreBounds(store);
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#2A603B',
    title: '墨绿OS',
    icon: iconPath() || undefined,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay: process.platform === 'win32'
      ? { color: '#2A603B', symbolColor: '#F2FFF6', height: 40 }
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: true,
    },
  });

  const renderer = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.loadFile(renderer);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (store.get('window.maximized', false)) mainWindow.maximize();
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = `file://${renderer.replace(/\\/g, '/')}`;
    if (!url.startsWith(allowed)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    try { require('./core/logger').Logger && new (require('./core/logger').Logger)('renderer').error('renderer gone', details); } catch (_) {}
  });

  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      try {
        if (mainWindow.isMaximized()) {
          store.set('window.maximized', true, { silent: true });
        } else {
          const b = mainWindow.getBounds();
          store.patch({ window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized: false } }, { silent: true });
        }
        store.saveNow();
      } catch (_) {}
    }, 350);
  };
  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);
  mainWindow.on('maximize', persistBounds);
  mainWindow.on('unmaximize', persistBounds);

  mainWindow.on('close', (event) => {
    if (!quitting && store.get('minimizeToTray', true) && tray) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    persistBounds();
    try { store.saveNow(); } catch (_) {}
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray(store) {
  const icon = iconPath();
  if (!icon) return;
  try {
    const img = nativeImage.createFromPath(icon);
    if (img.isEmpty()) return;
    tray = new Tray(img.resize({ width: 18, height: 18 }));
    tray.setToolTip('墨绿OS · MolvOS');
    const rebuild = () => {
      const menu = Menu.buildFromTemplate([
        { label: '打开墨绿OS', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow(store); } },
        { type: 'separator' },
        { label: 'Linux 终端', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.webContents.executeJavaScript("location.hash='#/linux'"); } } },
        { label: '任务管理器', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.webContents.executeJavaScript("location.hash='#/tasks'"); } } },
        { label: '合规扫描', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.webContents.executeJavaScript("location.hash='#/scan'"); } } },
        { type: 'separator' },
        { label: '退出', click: () => { quitting = true; app.quit(); } },
      ]);
      tray.setContextMenu(menu);
    };
    rebuild();
    tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch (_) {
    tray = null;
  }
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开数据目录', click: () => shell.openPath(app.getPath('userData')) },
        { label: '打开文档', click: () => shell.openPath(path.join(app.getAppPath(), 'docs')) },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', click: () => { quitting = true; app.quit(); } },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '使用说明书', click: () => shell.openPath(path.join(process.resourcesPath || app.getAppPath(), 'docs')) },
        { label: '项目主页', click: () => shell.openExternal('https://github.com/molvos/molv-os') },
        { type: 'separator' },
        { label: '关于墨绿OS', click: () => { if (mainWindow) mainWindow.webContents.executeJavaScript("location.hash='#/about'"); } },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function runScreenshotMode() {
  const outDir = process.env.MOLV_SHOT_DIR || path.join(app.getAppPath(), 'dist', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const pages = (process.env.MOLV_SHOT_PAGES || 'dashboard,linux,compilers,tasks,scan,server,usb,settings,about').split(',').filter(Boolean);
  const win = mainWindow;
  try {
    await win.webContents.executeJavaScript(`new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const boot = document.querySelector('#boot');
        if (!boot || boot.classList.contains('hide') || Date.now() - start > 20000) {
          clearInterval(timer);
          setTimeout(resolve, 700);
        }
      }, 250);
    })`);
  } catch (_) {
    await new Promise((r) => setTimeout(r, 3000));
  }
  for (const page of pages) {
    try {
      await win.webContents.executeJavaScript(`location.hash = '#/${page}'`);
      await new Promise((r) => setTimeout(r, 1800));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, `${page}.png`), img.toPNG());
    } catch (err) {
      console.error('screenshot failed', page, err.message);
    }
  }
  quitting = true;
  app.quit();
}

async function bootstrap() {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const { Store } = require('./core/store');
  const { LinuxManager } = require('./core/linux');
  const { CompilerManager } = require('./core/compilers');
  const { AndroidBridge } = require('./core/android');
  const { TaskManager } = require('./core/tasks');
  const { Scanner } = require('./core/scanner');
  const { StaticServer } = require('./core/server');
  const { GithubAccelerator } = require('./core/github');
  const { UsbWriter } = require('./core/usb');
  const { Logger } = require('./core/logger');
  const { registerIpc } = require('./ipc');
  const platform = require('./core/platform');

  const log = new Logger('main');
  const store = new Store();
  const linux = new LinuxManager(store);
  const compilers = new CompilerManager(store, linux);
  const android = new AndroidBridge(store);
  const tasks = new TaskManager();
  const scanner = new Scanner(store);
  const server = new StaticServer(store);
  const github = new GithubAccelerator(store);
  const usb = new UsbWriter(store);
  services = { store, linux, compilers, android, tasks, scanner, server, github, usb, log };

  registerIpc({ ...services, getWindow: () => mainWindow });
  buildMenu();
  createWindow(store);
  createTray(store);

  if (store.get('autostart', false)) {
    try { app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] }); } catch (_) {}
  }

  if (process.env.MOLV_SCREENSHOT) {
    mainWindow.webContents.once('did-finish-load', () => setTimeout(runScreenshotMode, 1200));
  }

  process.on('uncaughtException', (err) => log.error('uncaughtException', err));
  process.on('unhandledRejection', (err) => log.error('unhandledRejection', err));

  log.info(`MolvOS ${app.getVersion()} started on ${process.platform}/${process.arch}; packaged=${app.isPackaged}`);
  try {
    const admin = await platform.isAdmin();
    log.info(`admin=${admin}`);
  } catch (_) {}
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else if (services && services.store) createWindow(services.store);
});

app.on('before-quit', () => {
  quitting = true;
  try { if (services) { services.server.cleanup(); services.linux.closeAll(); services.store.saveNow(); } } catch (_) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!tray) app.quit();
  }
});

process.on('SIGINT', () => { quitting = true; app.quit(); });
process.on('SIGTERM', () => { quitting = true; app.quit(); });
