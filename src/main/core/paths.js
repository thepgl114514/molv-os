'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

let electronApp = null;
try {
  // Electron is optional so the CLI can use these helpers too.
  electronApp = require('electron').app || null;
} catch (_) {
  electronApp = null;
}

function isPackaged() {
  return Boolean(electronApp && electronApp.isPackaged);
}

function appRoot() {
  if (isPackaged()) return path.join(process.resourcesPath, 'app.asar');
  return path.resolve(__dirname, '..', '..', '..');
}

function resourcesRoot() {
  if (isPackaged()) return process.resourcesPath;
  return appRoot();
}

function dataRoot() {
  if (electronApp) return electronApp.getPath('userData');
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'MolvOS');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'MolvOS');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'molv-os');
}

function p(...parts) {
  return path.join(...parts);
}

function toolsRoot() {
  return p(resourcesRoot(), 'tools');
}

function docsRoot() {
  return p(resourcesRoot(), 'docs');
}

function integrityFile() {
  return p(resourcesRoot(), 'integrity.json');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dirs() {
  const base = dataRoot();
  return {
    base,
    logs: p(base, 'logs'),
    vault: p(base, 'vault'),
    linux: p(base, 'linux'),
    downloads: p(base, 'downloads'),
    config: p(base, 'config.json'),
    state: p(base, 'state.json'),
    backups: p(base, 'backups'),
    sessions: p(base, 'sessions'),
    reports: p(base, 'reports'),
  };
}

function ensureDataDirs() {
  const d = dirs();
  for (const key of ['base', 'logs', 'vault', 'linux', 'downloads', 'backups', 'sessions', 'reports']) {
    ensureDir(d[key]);
  }
  return d;
}

module.exports = {
  isPackaged,
  appRoot,
  resourcesRoot,
  dataRoot,
  toolsRoot,
  docsRoot,
  integrityFile,
  dirs,
  ensureDataDirs,
  ensureDir,
  p,
};
