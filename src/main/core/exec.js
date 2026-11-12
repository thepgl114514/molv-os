'use strict';

const { execFile, spawn } = require('child_process');
const { Logger } = require('./logger');

const log = new Logger('exec');
const DEFAULT_TIMEOUT = 30000;
const MAX_BUFFER = 8 * 1024 * 1024;

function cleanEnv(extra = {}) {
  return {
    ...process.env,
    LANG: process.env.LANG || 'C.UTF-8',
    LC_ALL: process.platform === 'win32' ? undefined : 'C.UTF-8',
    PYTHONIOENCODING: 'utf-8',
    ...extra,
  };
}

function run(file, args = [], options = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: cleanEnv(options.env),
        timeout: options.timeout ?? DEFAULT_TIMEOUT,
        maxBuffer: options.maxBuffer ?? MAX_BUFFER,
        windowsHide: true,
        encoding: 'utf8',
        shell: false,
      },
      (error, stdout, stderr) => {
        const result = {
          ok: !error,
          code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: error ? error.message : null,
          durationMs: Date.now() - started,
          command: `${file} ${args.join(' ')}`.trim(),
        };
        if (error && error.killed) result.error = '命令超时或已被终止';
        resolve(result);
      },
    );
    child.on('error', (err) => {
      resolve({
        ok: false,
        code: -1,
        stdout: '',
        stderr: '',
        error: err.message,
        durationMs: Date.now() - started,
        command: `${file} ${args.join(' ')}`.trim(),
      });
    });
  });
}

function which(command) {
  return run(process.platform === 'win32' ? 'where.exe' : 'which', [command], { timeout: 5000 });
}

const PS_PREAMBLE = [
  '$ErrorActionPreference = "Stop"',
  '$ProgressPreference = "SilentlyContinue"',
  'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}',
  '$OutputEncoding = [System.Text.Encoding]::UTF8',
  'try { $PSStyle.OutputRendering = "PlainText" } catch {}',
].join('; ');

function powershell(script, options = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, code: -1, stdout: '', stderr: 'PowerShell 仅在 Windows 上可用', error: 'not windows' });
      return;
    }
    const started = Date.now();
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true, env: cleanEnv(options.env) },
    );
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        try { child.kill(); } catch (_) {}
      }
    }, options.timeout ?? DEFAULT_TIMEOUT);
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr, error: err.message, durationMs: Date.now() - started });
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        error: code === 0 ? null : (stderr.trim() || `PowerShell 退出码 ${code}`),
        durationMs: Date.now() - started,
      });
    });
    try {
      child.stdin.write(`${PS_PREAMBLE}\n${script}\n`);
      child.stdin.end();
    } catch (err) {
      stderr += err.message;
    }
  });
}

function spawnStream(file, args, options = {}) {
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: cleanEnv(options.env),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return child;
}

function openDetached(file, args = [], options = {}) {
  try {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: cleanEnv(options.env),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (err) {
    log.warn('openDetached failed', err);
    return { ok: false, error: err.message };
  }
}

async function existsCommand(cmd) {
  const r = await which(cmd);
  return r.ok && r.stdout.trim().length > 0;
}

module.exports = { run, powershell, spawnStream, openDetached, which, existsCommand, log };
