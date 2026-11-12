'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { ensureDataDirs } = require('./paths');

const SCHEMA = 1;

function defaults() {
  return {
    schema: SCHEMA,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    locale: 'zh-CN',
    theme: 'ink',
    variant: 'slim',
    firstRun: true,
    lastPage: 'dashboard',
    setup: {
      permissions: 'pending',
      integrity: 'pending',
      virtualization: 'pending',
      linux: 'pending',
      compilers: 'pending',
      completed: false,
      completedAt: null,
    },
    install: {
      selectedAt: null,
      installedAt: null,
      components: [],
    },
    window: {
      width: 1280,
      height: 840,
      x: null,
      y: null,
      maximized: false,
    },
    autostart: false,
    minimizeToTray: true,
    linux: {
      method: 'auto',
      distro: 'MolvOS',
      installed: false,
      installedAt: null,
      rootfs: null,
      lastCheck: null,
    },
    compilers: {
      scope: 'device',
      enabled: {
        cpp: true,
        python: true,
        java: true,
        node: true,
        go: false,
        rust: false,
        php: false,
        ruby: false,
      },
      installed: {},
      lastCheck: null,
    },
    android: {
      lastApk: null,
      autoLaunch: false,
    },
    github: {
      enabled: true,
      mirror: 'ghproxy',
      custom: '',
      lastTest: null,
      configureGit: false,
    },
    server: {
      port: 8787,
      root: '',
      upnp: false,
      lastStartedAt: null,
      lastStoppedAt: null,
      mappings: [],
    },
    scan: {
      roots: [],
      policy: {
        extensions: ['.exe', '.dll', '.scr', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.jar', '.apk', '.iso', '.torrent'],
        sensitiveExtensions: ['.pem', '.key', '.pfx', '.p12', '.kdbx', '.env', '.ovpn'],
        names: ['password', 'passwd', 'secret', 'token', 'credentials', 'id_rsa', 'wallet.dat'],
        contentKeywords: ['BEGIN RSA PRIVATE KEY', 'BEGIN OPENSSH PRIVATE KEY', 'api_key', 'access_token'],
        largeFileMB: 512,
        includeHidden: false,
        followSymlinks: false,
        maxResults: 2000,
      },
      lastScan: null,
    },
    usb: {
      lastImage: null,
      mode: 'copy',
      requireConfirm: true,
    },
    security: {
      requireConfirmDestructive: true,
      quarantineBeforeDelete: true,
    },
    updates: {
      channel: 'stable',
      lastCheck: null,
    },
  };
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, patch) {
  if (!isObject(patch)) return patch;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (isObject(v) && isObject(out[k])) out[k] = merge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

class Store extends EventEmitter {
  constructor(file) {
    super();
    const d = ensureDataDirs();
    this.file = file || d.config;
    this.backup = `${this.file}.bak`;
    this.data = defaults();
    this.timer = null;
    this.load();
  }

  load() {
    const tryRead = (file) => {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!isObject(parsed)) throw new Error('配置不是对象');
      return parsed;
    };
    try {
      if (fs.existsSync(this.file)) {
        const parsed = tryRead(this.file);
        this.data = merge(defaults(), parsed);
      } else if (fs.existsSync(this.backup)) {
        this.data = merge(defaults(), tryRead(this.backup));
      }
    } catch (err) {
      try {
        if (fs.existsSync(this.backup)) {
          this.data = merge(defaults(), tryRead(this.backup));
        }
      } catch (_) {
        this.data = defaults();
      }
      this.emit('recovered', { error: err.message });
    }
    this.data.schema = SCHEMA;
    this.data.updatedAt = new Date().toISOString();
  }

  get(key, fallback) {
    if (!key) return clone(this.data);
    const parts = String(key).split('.');
    let cur = this.data;
    for (const part of parts) {
      if (cur == null || !(part in cur)) return fallback;
      cur = cur[part];
    }
    return cur === undefined ? fallback : clone(cur);
  }

  set(key, value, options = {}) {
    const parts = String(key).split('.');
    let cur = this.data;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!isObject(cur[parts[i]])) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    this.data.updatedAt = new Date().toISOString();
    this.data.firstRun = false;
    if (!options.silent) this.scheduleSave();
    return clone(value);
  }

  patch(partial, options = {}) {
    this.data = merge(this.data, partial);
    this.data.schema = SCHEMA;
    this.data.updatedAt = new Date().toISOString();
    this.data.firstRun = false;
    if (!options.silent) this.scheduleSave();
    return clone(this.data);
  }

  reset() {
    this.data = defaults();
    this.data.firstRun = false;
    this.saveNow();
    this.emit('change', this.get());
    return this.get();
  }

  scheduleSave() {
    this.emit('change', this.get());
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 180);
  }

  saveNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const text = `${JSON.stringify(this.data, null, 2)}\n`;
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text, 'utf8');
      if (fs.existsSync(this.file)) {
        try { fs.copyFileSync(this.file, this.backup); } catch (_) {}
      }
      fs.renameSync(tmp, this.file);
      return true;
    } catch (_) {
      return false;
    }
  }

  export() {
    return {
      product: 'MolvOS',
      exportedAt: new Date().toISOString(),
      schema: SCHEMA,
      config: this.get(),
    };
  }

  import(payload) {
    const config = payload && payload.config ? payload.config : payload;
    if (!isObject(config)) throw new Error('导入文件格式不正确');
    this.data = merge(defaults(), config);
    this.data.schema = SCHEMA;
    this.data.firstRun = false;
    this.saveNow();
    this.emit('change', this.get());
    return this.get();
  }
}

module.exports = { Store, defaults, merge };
