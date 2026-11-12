'use strict';

const fs = require('fs');
const path = require('path');
const { dirs, ensureDataDirs } = require('./paths');

const MAX_BYTES = 1.5 * 1024 * 1024;
const KEEP = 3;

class Logger {
  constructor(scope = 'main') {
    this.scope = scope;
    this.file = path.join(ensureDataDirs().logs, `${scope}.log`);
    this.rotate();
    this.stream = fs.createWriteStream(this.file, { flags: 'a' });
    this.stream.on('error', () => {});
  }

  rotate() {
    try {
      if (!fs.existsSync(this.file)) return;
      const size = fs.statSync(this.file).size;
      if (size < MAX_BYTES) return;
      for (let i = KEEP - 1; i >= 1; i -= 1) {
        const from = `${this.file}.${i}`;
        const to = `${this.file}.${i + 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.renameSync(this.file, `${this.file}.1`);
    } catch (_) {}
  }

  write(level, args) {
    const text = args
      .map((a) => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (_) { return String(a); }
      })
      .join(' ');
    const line = `${new Date().toISOString()} [${level}] [${this.scope}] ${text}\n`;
    try { this.stream.write(line); } catch (_) {}
    if (!process.env.MOLV_QUIET) {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(`[molv:${this.scope}] ${text}`);
    }
  }

  info(...args) { this.write('info', args); }
  warn(...args) { this.write('warn', args); }
  error(...args) { this.write('error', args); }
  debug(...args) { if (process.env.MOLV_DEBUG) this.write('debug', args); }
}

function tailLogs(scope = 'main', lines = 200) {
  const file = path.join(dirs().logs, `${scope}.log`);
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.split(/\r?\n/).slice(-lines).join('\n');
  } catch (e) {
    return `（暂无日志：${e.message}）`;
  }
}

module.exports = { Logger, tailLogs };
