'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const upnp = require('./upnp');
const { Logger } = require('./logger');

const log = new Logger('server');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.apk': 'application/vnd.android.package-archive',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.iso': 'application/x-iso9660-image',
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        out.push({ name, address: net.address });
      }
    }
  }
  return out;
}

class StaticServer extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.server = null;
    this.options = null;
    this.mapping = null;
    this.requests = [];
  }

  async start(input = {}) {
    if (this.server) throw new Error('服务器已在运行');
    const root = path.resolve(input.root || this.store.get('server.root', '') || os.homedir());
    let stat;
    try { stat = fs.statSync(root); } catch (_) { throw new Error(`目录不存在：${root}`); }
    if (!stat.isDirectory()) throw new Error('服务器根路径必须是文件夹');
    const port = Number(input.port || this.store.get('server.port', 8787));
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口必须是 1024–65535 之间的整数');
    const bind = input.bind || '0.0.0.0';
    const useUpnp = Boolean(input.upnp);

    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.on('clientError', (err, socket) => {
      try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) {}
    });
    await new Promise((resolve, reject) => {
      const onError = (err) => {
        this.server = null;
        if (err.code === 'EADDRINUSE') reject(new Error(`端口 ${port} 已被占用，请更换端口`));
        else if (err.code === 'EACCES') reject(new Error(`没有权限监听端口 ${port}，请改用 1024 以上端口`));
        else reject(err);
      };
      this.server.once('error', onError);
      this.server.listen(port, bind, () => {
        this.server.removeListener('error', onError);
        resolve();
      });
    });

    this.options = { root, port, bind, upnp: useUpnp };
    let upnpResult = null;
    if (useUpnp) {
      try {
        upnpResult = await upnp.addMapping({ port, description: 'MolvOS Static Server', lease: 0 });
        this.mapping = upnpResult;
      } catch (err) {
        upnpResult = { ok: false, error: err.message };
      }
    }
    this.store.patch({
      server: {
        root, port, upnp: useUpnp,
        lastStartedAt: new Date().toISOString(),
        mappings: upnpResult && upnpResult.ok ? [upnpResult] : [],
      },
    });
    this.emit('started', this.status());
    return this.status(upnpResult);
  }

  handle(req, res) {
    const started = Date.now();
    const remote = req.socket.remoteAddress;
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      res.end('405 Method Not Allowed');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (_) {
      res.writeHead(400); res.end('Bad Request'); return;
    }
    const root = this.options.root;
    const resolved = path.resolve(root, `.${pathname}`);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }
    let stat;
    try { stat = fs.statSync(resolved); } catch (_) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      this.logRequest(remote, req.method, pathname, 404, started);
      return;
    }
    if (stat.isDirectory()) {
      const index = path.join(resolved, 'index.html');
      if (fs.existsSync(index)) {
        this.sendFile(req, res, index, started, remote, pathname);
      } else {
        this.sendListing(req, res, resolved, pathname, started, remote);
      }
      return;
    }
    this.sendFile(req, res, resolved, started, remote, pathname);
  }

  sendFile(req, res, file, started, remote, pathname) {
    let stat;
    try { stat = fs.statSync(file); } catch (_) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        let start = m[1] ? Number(m[1]) : 0;
        let end = m[2] ? Number(m[2]) : stat.size - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          res.end();
          return;
        }
        end = Math.min(end, stat.size - 1);
        res.writeHead(206, {
          'Content-Type': type, 'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'X-Content-Type-Options': 'nosniff',
        });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(file, { start, end }).pipe(res);
        this.logRequest(remote, req.method, pathname, 206, started);
        return;
      }
    }
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
    this.logRequest(remote, req.method, pathname, 200, started);
  }

  sendListing(req, res, dir, pathname, started, remote) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    const parent = pathname === '/' ? null : path.posix.dirname(pathname.replace(/\/$/, '')) || '/';
    const rows = entries.map((e) => {
      const name = e.name + (e.isDirectory() ? '/' : '');
      const href = `${pathname.replace(/\/$/, '')}/${encodeURIComponent(e.name)}${e.isDirectory() ? '/' : ''}`;
      let size = '';
      try { size = e.isDirectory() ? '—' : `${(fs.statSync(path.join(dir, e.name)).size / 1024).toFixed(1)} KB`; } catch (_) {}
      return `<tr><td><a href="${esc(href)}">${esc(name)}</a></td><td>${esc(size)}</td></tr>`;
    }).join('\n');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>墨绿OS · ${esc(pathname)}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#07130f;color:#e4f5ec;font:15px/1.6 "Microsoft YaHei UI","PingFang SC",system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:42px 22px 80px}.brand{display:flex;align-items:center;gap:12px;margin-bottom:6px}
.logo{width:38px;height:38px;border-radius:12px;background:linear-gradient(145deg,#1c5a43,#0a2a1f);border:1px solid #2fbf8f;display:grid;place-items:center;color:#8ff0c8;font-weight:700}
h1{font-size:20px;margin:0;font-weight:600}.sub{color:#87a99a;font-size:13px;margin:0 0 26px 50px}
table{width:100%;border-collapse:collapse;background:#0c1f18;border:1px solid #1d4536;border-radius:14px;overflow:hidden}
td{padding:11px 16px;border-bottom:1px solid #173328}tr:last-child td{border:0}tr:hover td{background:#102a20}
a{color:#7ee2b8;text-decoration:none}a:hover{text-decoration:underline}td:last-child{text-align:right;color:#89a89a;font-size:12px;white-space:nowrap}
.foot{margin-top:18px;color:#658477;font-size:12px}
</style></head><body><main>
<div class="brand"><div class="logo">墨</div><h1>墨绿OS 文件服务</h1></div>
<p class="sub">${esc(pathname)} · 只读静态文件 · ${lanAddresses().map((a) => esc(a.address)).join(' / ')}</p>
<table><tbody>${parent ? `<tr><td><a href="${esc(parent)}">../</a></td><td></td></tr>` : ''}${rows}</tbody></table>
<div class="foot">由墨绿OS 内置服务器提供 · 请勿在公网暴露敏感文件</div>
</main></body></html>`;
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length, 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') res.end(); else res.end(buf);
    this.logRequest(remote, req.method, pathname, 200, started);
  }

  logRequest(remote, method, pathname, status, started) {
    const item = { at: new Date().toISOString(), remote, method, path: pathname, status, ms: Date.now() - started };
    this.requests.unshift(item);
    this.requests = this.requests.slice(0, 60);
    this.emit('request', item);
  }

  status(upnpResult) {
    if (!this.server || !this.options) {
      return { running: false, ...this.store.get('server'), lan: lanAddresses(), requests: this.requests.slice(0, 20), mapping: this.mapping };
    }
    const urls = [`http://127.0.0.1:${this.options.port}/`];
    for (const a of lanAddresses()) urls.push(`http://${a.address}:${this.options.port}/`);
    return {
      running: true,
      root: this.options.root,
      port: this.options.port,
      bind: this.options.bind,
      upnp: this.options.upnp,
      urls,
      lan: lanAddresses(),
      mapping: this.mapping,
      upnpResult: upnpResult || (this.mapping ? { ok: true, ...this.mapping } : null),
      requests: this.requests.slice(0, 20),
      startedAt: this.store.get('server.lastStartedAt'),
    };
  }

  async stop() {
    if (!this.server) return { ok: true, running: false };
    const port = this.options ? this.options.port : null;
    await new Promise((resolve) => {
      try { this.server.close(() => resolve()); } catch (_) { resolve(); }
      setTimeout(resolve, 3000);
    });
    this.server = null;
    let unmapped = null;
    if (this.mapping) {
      try {
        unmapped = await upnp.removeMapping({ port: this.mapping.externalPort, protocol: this.mapping.protocol || 'TCP' });
      } catch (err) {
        unmapped = { ok: false, error: err.message };
      }
    }
    this.mapping = null;
    this.options = null;
    this.store.patch({ server: { lastStoppedAt: new Date().toISOString(), mappings: [] } });
    this.emit('stopped');
    return { ok: true, running: false, port, unmapped };
  }

  async mapPort(port) {
    const p = Number(port || (this.options && this.options.port));
    if (!p) throw new Error('服务器尚未启动');
    const result = await upnp.addMapping({ port: p, description: 'MolvOS Server', lease: 0 });
    this.mapping = result;
    this.store.patch({ server: { mappings: [result] } });
    return result;
  }

  cleanup() {
    if (this.server) {
      try { this.server.close(); } catch (_) {}
      this.server = null;
    }
  }
}

module.exports = { StaticServer, lanAddresses, localAddress: upnp.localAddress };
