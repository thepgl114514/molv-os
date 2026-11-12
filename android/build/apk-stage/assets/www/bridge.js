'use strict';

(function () {
  const listeners = new Set();
  const nativeEvents = [];

  function emit(message) {
    for (const fn of Array.from(listeners)) {
      try { fn(message); } catch (err) { console.error('event handler failed', err); }
    }
  }

  window.MolvNativeEvent = function (json) {
    try {
      const message = typeof json === 'string' ? JSON.parse(json) : json;
      emit(message);
    } catch (err) {
      console.error('bad native event', err);
    }
  };

  const desktop = window.molvDesktop;
  const android = window.MolvAndroid;

  if (desktop) {
    window.Molv = {
      platform: desktop.platform,
      arch: desktop.arch,
      isDesktop: true,
      isAndroid: false,
      versions: desktop.versions,
      async invoke(action, payload) {
        const result = await desktop.invoke(action, payload || {});
        if (!result || result.ok !== true) {
          const err = new Error((result && result.error) || '操作失败');
          err.code = result && result.code;
          throw err;
        }
        return result.data;
      },
      on(fn) {
        if (typeof fn !== 'function') return () => {};
        return desktop.on(fn);
      },
      windowControl(action) {
        return desktop.windowControl(action);
      },
    };
  } else if (android) {
    window.Molv = {
      platform: 'android',
      arch: android.arch ? android.arch() : 'arm64',
      isDesktop: false,
      isAndroid: true,
      versions: {},
      async invoke(action, payload) {
        let raw;
        try {
          raw = android.invoke(action, JSON.stringify(payload || {}));
        } catch (err) {
          throw new Error(`原生桥接失败：${err.message}`);
        }
        let result;
        try { result = JSON.parse(raw); } catch (_) { throw new Error('原生返回数据格式错误'); }
        if (!result || result.ok !== true) {
          const err = new Error((result && result.error) || '操作失败');
          err.code = result && result.code;
          throw err;
        }
        return result.data;
      },
      on(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      windowControl() { return Promise.resolve({}); },
    };
  } else {
    // Browser preview: a tiny in-memory mock so the interface can be reviewed
    // without Electron. It is never used by the packaged desktop app.
    const mockConfig = {
      variant: 'slim', theme: 'ink', lastPage: 'dashboard',
      setup: { permissions: 'warn', integrity: 'ok', virtualization: 'warn', linux: 'failed', completed: false },
      linux: { installed: false, method: 'wsl', message: '浏览器预览模式：未连接桌面服务' },
    };
    window.Molv = {
      platform: 'browser', arch: 'x64', isDesktop: false, isAndroid: false, versions: {},
      async invoke(action, payload) {
        if (action === 'app.info') return { version: '0.1.0', config: mockConfig, variants: {}, summary: {}, admin: false, platform: 'browser', packaged: false, dataDir: '/preview' };
        if (action === 'app.bootstrap') return {
          config: mockConfig, app: { version: '0.1.0', platform: 'browser', admin: false, packaged: false },
          integrity: { ok: true, state: 'preview', checked: 0, total: 0, message: '浏览器预览模式' },
          permissions: { items: [], admin: false },
          virtualization: { supported: true, enabled: false, detail: '浏览器预览模式' },
          linux: mockConfig.linux,
          android: { devices: [], message: '浏览器预览模式' },
          variants: {},
        };
        if (action === 'scan.roots') return [{ path: '/home/demo', label: '示例目录', type: 'home' }];
        if (action === 'scan.policy') return { extensions: ['.exe'], sensitiveExtensions: ['.pem'], names: ['secret'], contentKeywords: [], largeFileMB: 512, includeHidden: false };
        if (action === 'github.status') return { mirrors: [], active: { name: '预览' }, lastTest: null, git: { installed: false } };
        if (action === 'compilers.list') return { scope: 'device', compilers: [] };
        if (action === 'usb.disks') return [];
        if (action === 'server.status') return { running: false, port: 8787 };
        if (action === 'tasks.list') return { processes: [], stats: { cpu: 0, memory: { percent: 0, used: 0, total: 1 }, cores: 4, uptime: 0 } };
        return null;
      },
      on() { return () => {}; },
      windowControl() { return Promise.resolve({}); },
    };
  }
})();
