'use strict';

window.MolvUI = (function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    boot: null,
    config: {},
    page: 'dashboard',
    cleanup: [],
    terminal: null,
    eventHooks: [],
    tasks: null,
    taskFilter: '',
    compilers: null,
    compilerScope: 'device',
    scan: null,
    server: null,
    github: null,
    usb: null,
    appTab: 'android',
    busy: {},
  };

  const PAGES = [
    { id: 'dashboard', label: '总览', group: '工作台', icon: 'grid' },
    { id: 'setup', label: '安装向导', group: '工作台', icon: 'wand' },
    { id: 'linux', label: 'Linux 环境', group: '系统', icon: 'terminal' },
    { id: 'compilers', label: '编译环境', group: '系统', icon: 'code' },
    { id: 'apps', label: '应用兼容', group: '系统', icon: 'apps' },
    { id: 'tasks', label: '任务管理器', group: '工具', icon: 'activity' },
    { id: 'scan', label: '合规扫描', group: '工具', icon: 'shield' },
    { id: 'server', label: '文件服务器', group: '工具', icon: 'server' },
    { id: 'github', label: 'GitHub 加速', group: '工具', icon: 'github' },
    { id: 'usb', label: '启动盘制作', group: '工具', icon: 'usb' },
    { id: 'settings', label: '设置', group: '其他', icon: 'settings' },
    { id: 'about', label: '关于', group: '其他', icon: 'info' },
  ];

  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    wand: '<path d="M15 4V2M15 10V8M12 6H10M20 6h-2M6 18l9-9M5 14l5 5"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9l3 3-3 3M13 15h4"/>',
    code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
    apps: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 17.5h7M17.5 14v7"/>',
    activity: '<path d="M3 12h4l2.5-7 5 14 2.5-7H21"/>',
    shield: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
    github: '<path d="M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5c0-1 .1-1.6-.5-2.2 3-.3 6-1.5 6-6a4.8 4.8 0 00-1.3-3.3 4.4 4.4 0 00-.1-3.3s-1-.3-3.4 1.3a11.6 11.6 0 00-6.2 0C7 2.4 6 2.7 6 2.7a4.4 4.4 0 00-.1 3.3A4.8 4.8 0 004.5 9.3c0 4.5 3 5.7 6 6-.4.4-.6.9-.6 1.5V21"/>',
    usb: '<path d="M12 21V7M12 3v4M9 7l3-4 3 4"/><rect x="7" y="21" width="10" height="2" rx="1"/><path d="M12 11l-4 3v2M12 15l4-3v-2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    alert: '<path d="M12 3l9 17H3z"/><path d="M12 9v5M12 17h.01"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    folder: '<path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 6M20 4v7h-7"/>',
    refresh2: '<path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5M21 12a9 9 0 01-15 6.7L3 16M3 21v-5h5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
    book: '<path d="M4 4h7a3 3 0 013 3v13a3 3 0 00-3-3H4zM20 4h-7a3 3 0 00-3 3v13a3 3 0 013-3h7z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2 2M14 9l2 2"/>',
    package: '<path d="M21 8l-9 5-9-5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    windows: '<path d="M3 5l8-1v8H3zM13 4l8-1v9h-8zM3 13h8v8l-8-1zM13 13h8v9l-8-1z"/>',
    linux: '<path d="M12 3c-2 0-3 2-3 5v2c-2 2-3 5-3 7 0 2 2 4 6 4s6-2 6-4c0-2-1-5-3-7V8c0-3-1-5-3-5z"/><path d="M9 15h.01M15 15h.01M10 18h4"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/>',
    network: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5M12 12l-6 5M12 12l6 5"/>',
    power: '<path d="M12 3v9M6.5 6.5a8 8 0 1011 0"/>',
    rocket: '<path d="M14 4c3-1 6 0 6 0s1 3 0 6c-1 3-4 6-4 6l-3-3s3-3 6-3M7 13l-3 3 4 4 3-3M4 20l3-3M9 15l-1 4 4-1"/>',
    layers: '<path d="M12 2l9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5"/>',
  };

  function icon(name, size = 18) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
  }

  function esc(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtBytes(n, digits = 1) {
    n = Number(n);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return `${n.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
  }

  function fmtDuration(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d) return `${d} 天 ${h} 小时`;
    if (h) return `${h} 小时 ${m} 分`;
    return `${m} 分钟`;
  }

  function fmtTime(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleString('zh-CN', { hour12: false }); } catch (_) { return String(value); }
  }

  function pct(part, total) {
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
  }

  function toast(message, kind = '') {
    const root = $('#toasts');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `<span class="ti">${kind === 'err' ? icon('alert', 15) : kind === 'ok' ? icon('check', 15) : icon('info', 15)}</span><div>${esc(message)}</div>`;
    root.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, kind === 'err' ? 6200 : 3800);
  }

  function modal({ title, desc = '', body = '', okText = '确认', cancelText = '取消', danger = false, showCancel = true }) {
    return new Promise((resolve) => {
      const root = $('#modalRoot');
      root.innerHTML = `<div class="modal-mask" data-close="1"></div>
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-head"><div><h3>${esc(title)}</h3>${desc ? `<p>${esc(desc)}</p>` : ''}</div><button class="modal-x" data-close="1" aria-label="关闭">×</button></div>
          ${body ? `<div class="modal-body">${body}</div>` : ''}
          <div class="modal-foot">${showCancel ? `<button class="btn ghost" data-close="1">${esc(cancelText)}</button>` : ''}<button class="btn ${danger ? 'danger' : 'primary'}" data-ok="1">${esc(okText)}</button></div>
        </div>`;
      root.classList.add('open');
      const done = (value) => { root.classList.remove('open'); root.innerHTML = ''; resolve(value); };
      $$('[data-close]', root).forEach((el) => el.addEventListener('click', () => done(showCancel ? false : null)));
      $('[data-ok]', root).addEventListener('click', () => done(true));
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); done(false); }
      });
    });
  }

  async function call(action, payload) {
    return window.Molv.invoke(action, payload || {});
  }

  async function safeCall(action, payload, options = {}) {
    try { return await call(action, payload); }
    catch (err) {
      if (!options.silent) toast(err.message || '操作失败', 'err');
      if (options.throw) throw err;
      return null;
    }
  }

  function setBusy(btn, busy, text) {
    if (!btn) return () => {};
    const old = btn.innerHTML;
    btn.disabled = Boolean(busy);
    if (busy) btn.innerHTML = `<span class="spinner"></span><span>${esc(text || '处理中…')}</span>`;
    return () => { btn.innerHTML = old; btn.disabled = false; };
  }

  function statusPill(level, text) {
    const cls = level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : level === 'bad' ? 'bad' : 'info';
    return `<span class="pill ${cls}"><i></i>${esc(text)}</span>`;
  }

  function emptyState(text, iconName = 'layers') {
    return `<div class="empty"><div class="e-ico">${icon(iconName, 20)}</div>${esc(text)}</div>`;
  }

  function pageHead(eyebrow, title, lede, actions = '') {
    return `<div class="page-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p class="lede">${esc(lede)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
  }

  function cleanupAdd(fn) {
    if (typeof fn === 'function') state.cleanup.push(fn);
  }

  function onEvent(fn) {
    if (typeof fn !== 'function') return () => {};
    state.eventHooks.push(fn);
    return () => { const i = state.eventHooks.indexOf(fn); if (i >= 0) state.eventHooks.splice(i, 1); };
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板', 'ok')).catch(() => fallbackCopy(text));
    } else fallbackCopy(text);
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      toast('已复制到剪贴板', 'ok');
    } catch (_) { toast('复制失败，请手动选择文本', 'err'); }
  }

  const routes = {};
  const actions = {};

  function register(id, page) { routes[id] = page; }
  function action(name, fn) { actions[name] = fn; }

  function navigate(page) {
    if (!PAGES.some((p) => p.id === page)) page = 'dashboard';
    if (location.hash === `#/${page}`) { state.page = page; render(); return; }
    location.hash = `#/${page}`;
  }

  function renderNav() {
    const groups = {};
    for (const p of PAGES) { if (!groups[p.group]) groups[p.group] = []; groups[p.group].push(p); }
    $('#nav').innerHTML = Object.entries(groups).map(([group, items]) => `
      <div class="nav-group">${esc(group)}</div>
      ${items.map((p) => `<button class="nav-item ${state.page === p.id ? 'active' : ''}" data-nav="${p.id}">${icon(p.icon, 18)}<span>${esc(p.label)}</span></button>`).join('')}
    `).join('');
  }

  function updateChrome() {
    const config = state.config || {};
    const labels = { full: '全量版', slim: '精简版', minimal: '极简版' };
    const chip = $('#variantChip');
    if (chip) chip.textContent = labels[config.variant] || '精简版';
    const ver = $('#verText');
    if (ver && state.boot && state.boot.app) ver.textContent = state.boot.app.version || '0.1.0';
    const plat = $('#platformText');
    if (plat) plat.textContent = window.Molv.isAndroid ? 'Android' : window.Molv.platform === 'win32' ? 'Windows' : window.Molv.platform === 'linux' ? 'Linux' : window.Molv.platform;
    const dot = $('#miniDot'); const title = $('#miniTitle'); const sub = $('#miniSub');
    if (!dot || !state.boot) return;
    const integrity = state.boot.integrity || {};
    const linux = state.boot.linux || {};
    if (integrity.state === 'damaged' || integrity.state === 'invalid-manifest') {
      dot.className = 'dot bad'; title.textContent = '安装文件异常'; sub.textContent = '建议重新安装或校验';
    } else if (linux.installed) {
      dot.className = 'dot ok'; title.textContent = '环境就绪'; sub.textContent = linux.method === 'wsl' ? 'WSL2 · Linux 可用' : 'Linux 可用';
    } else {
      dot.className = 'dot'; title.textContent = '等待配置'; sub.textContent = '安装 Linux 环境';
    }
  }

  function clearPage() {
    if (state.terminal) {
      try { state.terminal.dispose(); } catch (_) {}
      state.terminal = null;
    }
    for (const fn of state.cleanup.splice(0)) { try { fn(); } catch (_) {} }
    state.eventHooks = [];
    if (state.taskTimer) { clearInterval(state.taskTimer); state.taskTimer = null; }
    if (state.scanTimer) { clearInterval(state.scanTimer); state.scanTimer = null; }
    if (state.serverTimer) { clearInterval(state.serverTimer); state.serverTimer = null; }
  }

  function render() {
    clearPage();
    const view = $('#view');
    const page = routes[state.page] || routes.dashboard;
    if (!page) { view.innerHTML = `<div class="page">${emptyState('页面正在加载…')}</div>`; return; }
    try {
      view.innerHTML = `<div class="page">${page.render()}</div>`;
      view.scrollTop = 0;
      if (page.mount) page.mount();
    } catch (err) {
      console.error(err);
      view.innerHTML = `<div class="page">${emptyState(`页面渲染失败：${err.message}`, 'alert')}</div>`;
      toast(`页面渲染失败：${err.message}`, 'err');
    }
    renderNav();
    updateChrome();
  }

  function route() {
    const raw = (location.hash || '').replace(/^#\/?/, '') || (state.config && state.config.lastPage) || 'dashboard';
    state.page = PAGES.some((p) => p.id === raw) ? raw : 'dashboard';
    const meta = PAGES.find((p) => p.id === state.page);
    const crumb = $('#crumbPage'); if (crumb) crumb.textContent = meta ? meta.label : '总览';
    if (!state.boot) return;
    render();
  }

  function handleEvent(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'config:change') {
      state.config = msg.data || state.config;
      updateChrome();
      return;
    }
    for (const fn of state.eventHooks.slice()) { try { fn(msg); } catch (err) { console.error(err); } }
  }

  async function start() {
    renderNav();
    window.Molv.on(handleEvent);
    try {
      const boot = await call('app.bootstrap');
      state.boot = boot;
      state.config = boot.config || {};
      state.compilerScope = (boot.config && boot.config.compilers && boot.config.compilers.scope) || 'device';
      updateChrome();
      $('#boot').classList.add('hide');
      $('#app').classList.add('ready');
      $('#app').setAttribute('aria-hidden', 'false');
      route();
      setTimeout(() => { const b = $('#boot'); if (b) b.remove(); }, 600);
    } catch (err) {
      const hint = $('#bootHint');
      if (hint) hint.textContent = `启动失败：${err.message}`;
      $('#boot').classList.remove('hide');
      toast(`启动失败：${err.message}`, 'err');
      console.error(err);
    }
  }

  function handleClick(event) {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      navigate(nav.dataset.nav);
      return;
    }
    const act = event.target.closest('[data-action]');
    if (act) {
      event.preventDefault();
      const fn = actions[act.dataset.action];
      if (!fn) { toast(`功能尚未接入：${act.dataset.action}`, 'err'); return; }
      Promise.resolve(fn(act, event)).catch((err) => toast(err.message || '操作失败', 'err'));
      return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) { event.preventDefault(); copyText(copy.dataset.copy); return; }
    const cmd = event.target.closest('[data-cmd]');
    if (cmd) { event.preventDefault(); const fn = actions['term-command']; if (fn) Promise.resolve(fn(cmd, event)).catch((err) => toast(err.message, 'err')); return; }
    const pkg = event.target.closest('[data-pkg]');
    if (pkg) { event.preventDefault(); const fn = actions['linux-pkg']; if (fn) Promise.resolve(fn(pkg, event)).catch((err) => toast(err.message, 'err')); }
  }

  function bind() {
    document.addEventListener('click', handleClick);
    window.addEventListener('hashchange', route);
    $('#variantChip').addEventListener('click', () => navigate('setup'));
    $('#btnRefresh').addEventListener('click', async () => {
      const btn = $('#btnRefresh');
      btn.disabled = true;
      try {
        const boot = await call('app.bootstrap');
        state.boot = boot; state.config = boot.config || {};
        updateChrome();
        if (state.page === 'dashboard') render();
        toast('环境状态已刷新', 'ok');
      } catch (err) { toast(err.message, 'err'); }
      finally { btn.disabled = false; }
    });
    $('#btnBell').addEventListener('click', async () => {
      const logs = await safeCall('logs.tail', { scope: 'main', lines: 120 });
      await modal({ title: '运行日志', desc: '最近 120 行主进程日志', body: `<div class="log-view" style="max-height:420px">${esc((logs && logs.lines) || '暂无日志')}</div>`, okText: '关闭', showCancel: false });
    });
  }

  return {
    state, PAGES, routes, actions, register, action, start, bind, navigate, render, renderNav, route,
    icon, esc, fmtBytes, fmtDuration, fmtTime, pct, toast, modal, call, safeCall, setBusy,
    statusPill, emptyState, pageHead, cleanupAdd, onEvent, copyText, updateChrome,
  };
})();
