'use strict';

(function () {
  const UI = window.MolvUI;
  const { state, esc, icon, fmtBytes, fmtDuration, fmtTime, statusPill, emptyState, pageHead, register, call } = UI;

  // ------------------------------------------------------------------- tasks
  register('tasks', {
    render() {
      return `
        ${pageHead('PROCESS MONITOR', '任务管理器', '查看当前进程与资源占用。结束进程前会再次确认；系统关键进程由内核保护，墨绿OS 不会尝试绕过。', `<button class="btn ghost" data-action="task-monitor">${icon('external', 14)} 系统监视器</button><button class="btn soft" data-action="task-refresh">${icon('refresh2', 14)} 刷新</button>`)}
        <div class="grid grid-3 mb">
          <div class="card tight"><div class="between"><div><div class="tiny">CPU 总占用</div><div style="font-size:22px;font-weight:600" id="taskCpu">—</div></div>${icon('cpu', 24)}</div><div class="progress sm mt"><span id="taskCpuBar" style="width:0"></span></div></div>
          <div class="card tight"><div class="between"><div><div class="tiny">内存占用</div><div style="font-size:22px;font-weight:600" id="taskMem">—</div></div>${icon('layers', 24)}</div><div class="progress sm mt"><span id="taskMemBar" style="width:0"></span></div></div>
          <div class="card tight"><div class="between"><div><div class="tiny">进程 / 运行时间</div><div style="font-size:18px;font-weight:600" id="taskMeta">—</div></div>${icon('activity', 24)}</div><div class="tiny mt" id="taskUpdated">等待采样…</div></div>
        </div>
        <div class="card flush">
          <div class="between" style="padding:13px 14px"><div class="inline"><input class="input" id="taskSearch" placeholder="搜索进程名或 PID" style="width:250px" value="${esc(state.taskFilter)}"><button class="btn sm ghost" data-action="task-refresh">刷新</button></div><span class="tiny" id="taskCount">—</span></div>
          <div id="taskTable">${emptyState('正在读取进程列表…', 'activity')}</div>
        </div>
        <div class="hint mt">CPU 百分比为两次采样之间的增量，首次打开可能显示 0%。结束进程可能导致未保存的数据丢失。</div>`;
    },
    mount() {
      const search = document.querySelector('#taskSearch');
      if (search) search.addEventListener('input', (e) => { state.taskFilter = e.target.value; renderTaskTable(); });
      loadTasks();
      state.taskTimer = setInterval(loadTasks, 3000);
      UI.cleanupAdd(() => { if (state.taskTimer) clearInterval(state.taskTimer); });
    },
  });

  async function loadTasks() {
    try {
      const data = await call('tasks.list');
      state.tasks = data;
      const s = data.stats || {};
      const cpu = document.querySelector('#taskCpu'); if (cpu) cpu.textContent = `${s.cpu || 0}%`;
      const cpuBar = document.querySelector('#taskCpuBar'); if (cpuBar) cpuBar.style.width = `${s.cpu || 0}%`;
      const mem = document.querySelector('#taskMem'); if (mem) mem.textContent = `${s.memory ? s.memory.percent : 0}% · ${fmtBytes(s.memory ? s.memory.used : 0)}`;
      const memBar = document.querySelector('#taskMemBar'); if (memBar) memBar.style.width = `${s.memory ? s.memory.percent : 0}%`;
      const meta = document.querySelector('#taskMeta'); if (meta) meta.textContent = `${(data.processes || []).length} 个 · ${fmtDuration(s.uptime)}`;
      const upd = document.querySelector('#taskUpdated'); if (upd) upd.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
      renderTaskTable();
    } catch (err) {
      const el = document.querySelector('#taskTable');
      if (el) el.innerHTML = emptyState(`读取进程失败：${err.message}`, 'alert');
    }
  }

  function renderTaskTable() {
    const el = document.querySelector('#taskTable');
    if (!el) return;
    const data = state.tasks;
    if (!data || !data.processes) { el.innerHTML = emptyState('正在读取进程列表…', 'activity'); return; }
    const q = (state.taskFilter || '').toLowerCase().trim();
    const rows = data.processes.filter((p) => !q || String(p.pid).includes(q) || String(p.name).toLowerCase().includes(q)).slice(0, 300);
    const count = document.querySelector('#taskCount'); if (count) count.textContent = `${rows.length} / ${data.processes.length} 个进程`;
    if (!rows.length) { el.innerHTML = emptyState('没有匹配的进程', 'search'); return; }
    el.innerHTML = `<div class="table-wrap" style="border:0;border-radius:0"><table><thead><tr><th>PID</th><th>进程</th><th class="num">CPU</th><th class="num">内存</th><th>状态</th><th></th></tr></thead><tbody>${rows.map((p) => `<tr>
      <td class="mono">${p.pid}</td><td>${esc(p.name)}</td><td class="num">${Number(p.cpu || 0).toFixed(1)}%</td><td class="num">${fmtBytes(p.memory)}</td><td>${p.protected ? statusPill('warn', '系统保护') : statusPill('ok', '可结束')}</td>
      <td style="text-align:right"><button class="btn sm ghost" data-action="task-kill" data-pid="${p.pid}" data-name="${esc(p.name)}" ${p.protected ? 'disabled' : ''}>结束</button></td>
    </tr>`).join('')}</tbody></table></div>`;
  }

  UI.loadTasks = loadTasks;

  // -------------------------------------------------------------------- scan
  register('scan', {
    render() {
      const s = state.scan || {};
      const roots = s.roots || [];
      const selected = s.selected || [];
      const running = Boolean(s.running);
      const results = s.results || [];
      return `
        ${pageHead('COMPLIANCE SCAN', '合规扫描', '按本地策略检索敏感文件、可执行脚本与超大文件。它不会上传文件，也不会替法律做判断；所有结果都可以人工复核。', `<button class="btn ghost" data-action="scan-export">${icon('download', 14)} 导出报告</button><button class="btn primary" data-action="scan-start" ${running ? 'disabled' : ''}>${icon('shield', 14)} 一键扫描</button>`)}
        <div class="notice warn mb"><span class="ico">${icon('alert', 17)}</span><div><b>请先阅读：</b>“违规文件”不是一个可以由扩展名或关键词可靠判断的概念。本功能只做<b>本地规则匹配</b>，用于隐私自查、清理与合规准备，不构成违法性认定。隔离会移动文件而不是删除，可在数据目录的 vault 中恢复。</div></div>
        <div class="grid grid-2" style="grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr)">
          <div class="card">
            <div class="card-title"><div class="ico">${icon('folder')}</div><h3>扫描范围</h3><span class="right">${selected.length} 个位置</span></div>
            <div class="scan-root" id="scanRoots">${roots.map((r) => `<button class="root-chip ${selected.includes(r.path) ? 'on' : ''}" data-action="scan-root" data-path="${esc(r.path)}">${esc(r.label)} <span class="mono" style="opacity:.6">${esc(r.path)}</span></button>`).join('') || emptyState('正在读取磁盘…', 'folder')}</div>
            <div class="btn-row mt"><button class="btn sm ghost" data-action="scan-add-root">${icon('plus', 13)} 自定义文件夹</button><button class="btn sm ghost" data-action="scan-select-home">${icon('folder', 13)} 用户目录</button><button class="btn sm ghost" data-action="scan-select-all">全选</button><button class="btn sm ghost" data-action="scan-clear">清空</button></div>
            <div class="mt">
              <div class="between mb" style="margin-bottom:6px"><span class="tiny" id="scanProgressText">等待开始</span><span class="tiny mono" id="scanProgressPct">0%</span></div>
              <div class="progress"><span id="scanProgressBar" style="width:0"></span></div>
              <div class="between mt"><span class="tiny" id="scanStats">—</span><span class="tiny" id="scanElapsed">—</span></div>
            </div>
            <div class="btn-row mt"><button class="btn ${running ? 'danger' : 'primary'}" data-action="${running ? 'scan-cancel' : 'scan-start'}">${icon(running ? 'stop' : 'play', 14)} ${running ? '停止扫描' : '开始扫描'}</button><button class="btn ghost" data-action="scan-policy-save">${icon('settings', 14)} 保存策略</button></div>
          </div>
          <div class="card">
            <div class="card-title"><div class="ico">${icon('sliders')}</div><h3>策略</h3><span class="right">本地生效</span></div>
            ${renderPolicyEditor(s.policy || {})}
          </div>
        </div>
        <div class="card mt">
          <div class="card-title"><div class="ico">${icon('file')}</div><h3>扫描结果</h3><span class="right" id="scanResultCount">${results.length} 项</span></div>
          <div class="btn-row mb"><button class="btn sm ghost" data-action="scan-select-results">全选结果</button><button class="btn sm danger" data-action="scan-quarantine" ${results.length ? '' : 'disabled'}>${icon('lock', 13)} 隔离所选</button><span class="tiny" id="scanSelectedCount">未选择</span></div>
          <div id="scanResults">${renderScanResults(results)}</div>
        </div>`;
    },
    mount() {
      if (!state.scan || !state.scan.roots) loadScan();
      UI.onEvent((msg) => {
        if (msg.type === 'scan:progress') updateScanProgress(msg.data);
        if (msg.type === 'scan:done') {
          state.scan = { ...(state.scan || {}), running: false, results: msg.data.results || [], summary: msg.data };
          if (state.page === 'scan') UI.render();
        }
      });
    },
  });

  function renderPolicyEditor(policy) {
    return `
      <div class="field mb"><label>高风险扩展名（逗号分隔）</label><textarea class="input" id="policyExt" rows="2">${esc((policy.extensions || []).join(', '))}</textarea></div>
      <div class="field mb"><label>敏感凭据扩展名</label><textarea class="input" id="policySensitive" rows="2">${esc((policy.sensitiveExtensions || []).join(', '))}</textarea></div>
      <div class="field mb"><label>文件名关键词</label><textarea class="input" id="policyNames" rows="2">${esc((policy.names || []).join(', '))}</textarea></div>
      <div class="field mb"><label>文本内容关键词（仅扫描 ≤ 2 MB 的文本）</label><textarea class="input" id="policyContent" rows="2">${esc((policy.contentKeywords || []).join(', '))}</textarea></div>
      <div class="grid grid-2"><div class="field"><label>超大文件阈值 (MB)</label><input class="input" id="policyLarge" type="number" min="1" value="${esc(policy.largeFileMB || 512)}"></div><div class="field"><label>结果上限</label><input class="input" id="policyMax" type="number" min="10" value="${esc(policy.maxResults || 2000)}"></div></div>
      <div class="hint mt">内容关键词只用于文本文件；不会读取二进制文件内容。扫描会跳过回收站、系统卷信息、node_modules 等目录。</div>`;
  }

  function renderScanResults(results) {
    if (!results || !results.length) return emptyState('还没有扫描结果。选择范围后点击“开始扫描”。', 'shield');
    return `<div class="table-wrap"><table><thead><tr><th style="width:34px"></th><th>文件</th><th>原因</th><th>级别</th><th class="num">大小</th></tr></thead><tbody>${results.slice(0, 500).map((r) => `<tr>
      <td><input type="checkbox" data-scan-path="${esc(r.path)}" ${r.selected ? 'checked' : ''}></td>
      <td><div style="max-width:520px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.path)}">${esc(r.name)}</div><div class="tiny" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.path)}">${esc(r.path)}</div></div></td>
      <td><div class="tiny">${r.reasons.map((x) => esc(x)).join(' · ')}</div></td>
      <td><span class="result-level ${r.level}">${r.level === 'high' ? '高' : r.level === 'medium' ? '中' : '低'}</span></td>
      <td class="num">${esc(r.sizeText)}</td>
    </tr>`).join('')}</tbody></table></div>${results.length > 500 ? `<div class="hint" style="padding:10px">仅展示前 500 项，导出报告包含全部 ${results.length} 项。</div>` : ''}`;
  }

  async function loadScan() {
    try {
      const [roots, policy, status] = await Promise.all([call('scan.roots'), call('scan.policy'), call('scan.status')]);
      const prev = state.scan || {};
      state.scan = { ...prev, roots, policy, selected: prev.selected || [], results: prev.results || [], running: Boolean(status.running) };
      if (state.page === 'scan') UI.render();
    } catch (err) { UI.toast(err.message, 'err'); }
  }

  function updateScanProgress(d) {
    const pctVal = d.percent === null || d.percent === undefined ? 0 : d.percent;
    const bar = document.querySelector('#scanProgressBar'); if (bar) bar.style.width = `${pctVal}%`;
    const t = document.querySelector('#scanProgressText'); if (t) t.textContent = d.current ? `扫描：${d.current}` : '扫描中…';
    const p = document.querySelector('#scanProgressPct'); if (p) p.textContent = d.percent == null ? `${d.files || 0} 个文件` : `${pctVal}%`;
    const s = document.querySelector('#scanStats'); if (s) s.textContent = `${d.files || 0} 文件 · 命中 ${d.matched || 0} · 错误 ${d.errors || 0}`;
    const e = document.querySelector('#scanElapsed'); if (e) e.textContent = `${Math.round((d.elapsedMs || 0) / 1000)} 秒`;
  }

  UI.loadScan = loadScan;
  UI.updateScanProgress = updateScanProgress;
  UI.renderScanResults = renderScanResults;

  // ------------------------------------------------------------------ server
  register('server', {
    render() {
      const srv = state.server || {};
      const running = Boolean(srv.running);
      const config = state.config.server || {};
      return `
        ${pageHead('LOCAL SERVER', '文件服务器', '把一个文件夹变成局域网可访问的只读站点，并可选申请路由器端口映射。默认只读，不暴露写接口。', `<button class="btn ghost" data-action="server-open" ${running ? '' : 'disabled'}>${icon('external', 14)} 在浏览器打开</button><button class="btn ${running ? 'danger' : 'primary'}" data-action="${running ? 'server-stop' : 'server-start'}">${icon(running ? 'stop' : 'play', 14)} ${running ? '停止服务器' : '启动服务器'}</button>`)}
        <div class="grid grid-2" style="grid-template-columns:minmax(0,1fr) minmax(320px,.7fr)">
          <div class="card">
            <div class="card-title"><div class="ico">${icon('server')}</div><h3>服务配置</h3>${statusPill(running ? 'ok' : 'info', running ? '运行中' : '未启动')}</div>
            <div class="field mb"><label>共享文件夹</label><div class="inline"><input class="input mono" id="serverRoot" value="${esc(srv.root || config.root || '')}" placeholder="选择一个文件夹" readonly><button class="btn sm ghost" data-action="server-choose-root">${icon('folder', 13)} 选择</button></div></div>
            <div class="grid grid-3"><div class="field"><label>端口</label><input class="input" id="serverPort" type="number" min="1024" max="65535" value="${esc(srv.port || config.port || 8787)}"></div><div class="field"><label>监听</label><select class="select" id="serverBind"><option value="0.0.0.0">所有网卡</option><option value="127.0.0.1">仅本机</option></select></div><div class="field"><label>端口映射</label><div class="inline" style="height:35px"><button class="switch ${config.upnp ? 'on' : ''}" id="serverUpnp" data-action="server-upnp-toggle"></button><span class="tiny">UPnP</span></div></div></div>
            <div class="btn-row mt"><button class="btn primary" data-action="server-start" ${running ? 'disabled' : ''}>${icon('play', 14)} 启动</button><button class="btn ghost" data-action="server-map" ${running ? '' : 'disabled'}>${icon('network', 14)} 申请端口映射</button></div>
            <div class="notice mt"><span class="ico">${icon('shield', 16)}</span><div>服务器只提供 GET/HEAD 只读访问与目录索引，不提供上传接口。请勿把包含密钥、身份证件或私人照片的目录长期暴露在公网。</div></div>
          </div>
          <div class="card">
            <div class="card-title"><div class="ico">${icon('globe')}</div><h3>访问地址</h3><span class="right">${running ? '在线' : '离线'}</span></div>
            ${running && srv.urls ? `<div class="stack">${srv.urls.map((u) => `<div class="copy-row"><input class="input" value="${esc(u)}" readonly><button class="btn sm ghost" data-copy="${esc(u)}">${icon('copy', 12)}</button></div>`).join('')}</div>` : emptyState('启动后显示本机与局域网地址', 'globe')}
            ${srv.mapping ? `<div class="notice ok mt"><span class="ico">${icon('check', 16)}</span><div>路由器已映射端口 ${srv.mapping.externalPort}（${esc(srv.mapping.gateway || 'UPnP')}），外部 IP 请在路由器中查看。</div></div>` : srv.upnpResult && srv.upnpResult.ok === false ? `<div class="notice warn mt"><span class="ico">${icon('alert', 16)}</span><div>端口映射失败：${esc(srv.upnpResult.error || '路由器不支持 UPnP')}。服务器仍在局域网内可用。</div></div>` : ''}
            <div class="kv mt"><span>请求数</span><b>${(srv.requests || []).length}</b></div>
            <div class="kv"><span>启动时间</span><b>${esc(fmtTime(srv.startedAt))}</b></div>
          </div>
        </div>
        <div class="card mt">
          <div class="card-title"><div class="ico">${icon('activity')}</div><h3>最近请求</h3></div>
          ${(srv.requests || []).length ? `<div class="table-wrap"><table><thead><tr><th>时间</th><th>来源</th><th>方法</th><th>路径</th><th class="num">状态</th></tr></thead><tbody>${srv.requests.map((r) => `<tr><td class="mono">${esc(new Date(r.at).toLocaleTimeString('zh-CN', { hour12: false }))}</td><td class="mono">${esc(r.remote)}</td><td>${esc(r.method)}</td><td class="mono">${esc(r.path)}</td><td class="num">${r.status}</td></tr>`).join('')}</tbody></table></div>` : emptyState('暂无请求', 'activity')}
        </div>`;
    },
    mount() { refreshServer(); state.serverTimer = setInterval(refreshServer, 4000); UI.cleanupAdd(() => { if (state.serverTimer) clearInterval(state.serverTimer); }); },
  });

  async function refreshServer() {
    try {
      const srv = await call('server.status');
      state.server = srv;
      if (state.page === 'server') {
        const openBtn = document.querySelector('[data-action="server-open"]');
        if (openBtn) openBtn.disabled = !srv.running;
      }
    } catch (_) {}
  }
  UI.refreshServer = refreshServer;

  // ------------------------------------------------------------------ github
  register('github', {
    render() {
      const g = state.github || {};
      const active = g.active || {};
      const mirrors = g.mirrors || [];
      return `
        ${pageHead('GITHUB ACCELERATOR', 'GitHub 加速', '为 release、raw 与仓库归档选择一条可用的社区镜像。镜像不是官方服务，可能失效或记录访问；涉及私有仓库时请使用直连。', `<button class="btn ghost" data-action="github-test">${icon('activity', 14)} 测速</button><button class="btn soft" data-action="github-refresh">${icon('refresh2', 14)} 刷新</button>`)}
        <div class="notice warn mb"><span class="ico">${icon('alert', 17)}</span><div><b>安全边界：</b>加速仅适用于公开的 GitHub 下载链接；不会代理登录、GitHub API 或私有仓库凭据。使用社区镜像前请自行评估其可信度。</div></div>
        <div class="grid grid-2" style="grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr)">
          <div class="card">
            <div class="card-title"><div class="ico">${icon('github')}</div><h3>镜像线路</h3><span class="right">当前：${esc(active.name || '—')}</span></div>
            <div class="stack" id="githubMirrors">${mirrors.map((m) => `<div class="variant ${m.id === active.id ? 'active' : ''}" data-action="github-set" data-mirror="${esc(m.id)}"><div class="v-top"><b>${esc(m.name)}</b>${m.id === active.id ? statusPill('ok', '使用中') : `<span class="tiny">${esc(m.note || '')}</span>`}</div><div class="tiny mono" style="word-break:break-all">${esc(m.prefix || 'https://github.com/（直连）')}</div></div>`).join('') || emptyState('正在读取镜像列表…', 'github')}</div>
            <div class="field mt"><label>自定义镜像前缀（以 / 结尾）</label><div class="inline"><input class="input mono" id="githubCustom" value="${esc((mirrors.find((m) => m.id === 'custom') || {}).prefix || '')}" placeholder="https://your-mirror.example/"><button class="btn sm ghost" data-action="github-set-custom">保存</button></div></div>
          </div>
          <div class="stack">
            <div class="card">
              <div class="card-title"><div class="ico">${icon('link')}</div><h3>链接改写测试</h3></div>
              <div class="field mb"><label>原始 GitHub 链接</label><input class="input mono" id="githubUrl" placeholder="https://github.com/user/repo/releases/download/v1/file.zip"></div>
              <div class="btn-row"><button class="btn soft" data-action="github-rewrite">${icon('zap', 14)} 生成加速链接</button><button class="btn ghost" data-action="github-copy-rewrite">${icon('copy', 14)} 复制</button></div>
              <div class="log-view mt" id="githubRewriteOut" style="max-height:100px">等待输入…</div>
            </div>
            <div class="card">
              <div class="card-title"><div class="ico">${icon('settings')}</div><h3>Git 客户端</h3></div>
              <div class="kv"><span>Git</span><b>${g.git && g.git.installed ? esc(g.git.version) : '未安装'}</b></div>
              <div class="inline mt"><button class="switch ${state.config.github && state.config.github.configureGit ? 'on' : ''}" data-action="github-git-config"></button><span class="tiny">写入全局 git insteadOf 配置</span></div>
              <div class="hint mt">该选项会修改 <code class="mono">~/.gitconfig</code>，只影响 GitHub HTTPS 地址。可随时关闭并恢复。</div>
            </div>
          </div>
        </div>
        <div class="card mt">
          <div class="card-title"><div class="ico">${icon('clock')}</div><h3>测速结果</h3><span class="right">${g.lastTest ? esc(fmtTime(g.lastTest.at)) : '尚未测试'}</span></div>
          ${g.lastTest && g.lastTest.results ? `<div class="table-wrap"><table><thead><tr><th>镜像</th><th>状态</th><th class="num">延迟</th><th>说明</th></tr></thead><tbody>${g.lastTest.results.map((r) => `<tr><td>${esc(r.name)}</td><td>${statusPill(r.ok ? 'ok' : 'bad', r.ok ? '可用' : '失败')}</td><td class="num">${r.ms} ms</td><td class="tiny">${esc(r.error || `HTTP ${r.status || 200}`)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('点击“测速”检测各线路延迟', 'activity')}
        </div>`;
    },
    mount() { if (!state.github) loadGithub(); },
  });

  async function loadGithub() {
    try {
      state.github = await call('github.status');
      if (state.page === 'github') UI.render();
    } catch (err) { UI.toast(err.message, 'err'); }
  }
  UI.loadGithub = loadGithub;

  // --------------------------------------------------------------------- usb
  register('usb', {
    render() {
      const isWindows = window.Molv.platform === 'win32';
      const u = state.usb || {};
      const disks = u.disks || [];
      const iso = u.iso;
      const selected = u.selectedDisk;
      const mode = u.mode || 'copy';
      const expected = selected ? `ERASE ${selected}` : '';
      return `
        ${pageHead('BOOT MEDIA', '启动盘制作', '把墨绿OS Live 或任意 Linux 镜像写入 USB。RAW 模式会完全擦除目标磁盘；每一步都必须人工确认。', `<button class="btn ghost" data-action="usb-docs">${icon('book', 14)} 制作说明</button><button class="btn soft" data-action="usb-refresh">${icon('refresh2', 14)} 重新检测</button>`)}
        <div class="notice danger mb"><span class="ico">${icon('alert', 18)}</span><div><b>会丢失数据。</b> 写入将永久擦除目标 USB/SD 卡上的全部分区与文件。请先备份；不要选择移动硬盘、系统盘或唯一的数据盘。墨绿OS 会拒绝系统盘与非可移动磁盘，但无法替你的数据做最终决定。</div></div>
        ${!isWindows ? `<div class="card">${emptyState(window.Molv.isAndroid ? '启动盘制作请在 Windows / Linux 桌面端完成；Android OTG 写入风险较高，未开放。' : '当前平台请使用 dd 命令制作启动盘；Windows 安装包提供图形化 RAW 写入。', 'usb')}</div>` : `
        <div class="grid grid-2" style="grid-template-columns:minmax(0,1fr) minmax(320px,.8fr)">
          <div class="card">
            <div class="card-title"><div class="ico">${icon('usb')}</div><h3>目标磁盘</h3><span class="right">${disks.length} 个磁盘</span></div>
            <div style="border:1px solid var(--line-soft);border-radius:12px;overflow:hidden">${disks.length ? disks.map((d) => `<div class="disk-row"><div class="radio ${String(selected) === String(d.number) ? 'on' : ''}" data-action="usb-select" data-disk="${d.number}"></div><div><div class="d-name">磁盘 ${d.number} · ${esc(d.name)}</div><div class="d-sub">${esc(d.bus)} · ${esc(d.partitionStyle || '')} · ${d.volumes && d.volumes.length ? d.volumes.map((v) => esc(v.letter)).join(' ') : '无盘符'}</div></div><div class="mono">${esc(d.sizeText)}</div><div>${d.system || d.boot ? statusPill('bad', '系统盘') : d.removable ? statusPill('ok', '可移动') : statusPill('warn', '非 USB')}</div><div>${d.safe && d.removable ? '<span class="pill ok"><i></i>可选</span>' : '<span class="pill bad"><i></i>禁止</span>'}</div></div>`).join('') : emptyState('未检测到可移动磁盘', 'usb')}</div>
            <div class="hint mt">如果没有显示 U 盘，请重新插拔并以管理员身份运行墨绿OS。</div>
          </div>
          <div class="stack">
            <div class="card">
              <div class="card-title"><div class="ico">${icon('file')}</div><h3>镜像</h3></div>
              <div class="field mb"><label>ISO / IMG 文件</label><div class="inline"><input class="input mono" value="${esc(iso ? iso.path : '')}" placeholder="选择镜像" readonly><button class="btn sm ghost" data-action="usb-choose-iso">${icon('folder', 13)} 选择</button></div></div>
              ${iso ? `<div class="kv"><span>文件</span><b>${esc(iso.name)}</b></div><div class="kv"><span>大小</span><b>${esc(iso.sizeText)}</b></div>` : ''}
              <div class="field mt"><label>写入模式</label><div class="tabs" style="width:100%"><button class="tab ${mode === 'copy' ? 'active' : ''}" data-action="usb-mode" data-mode="copy" style="flex:1">文件复制（FAT32）</button><button class="tab ${mode === 'raw' ? 'active' : ''}" data-action="usb-mode" data-mode="raw" style="flex:1">RAW 直写</button></div></div>
              <div class="hint mt">${mode === 'raw' ? 'RAW 直写兼容性最好，但会完全覆盖磁盘分区表。' : '文件复制模式会格式化目标盘为 FAT32，部分 ISO 可能无法引导；不确定时优先 RAW。'}</div>
            </div>
            <div class="confirm-box">
              <div class="tiny mb">请输入确认短语以解锁写入：<code>${esc(expected || 'ERASE <磁盘号>')}</code></div>
              <input class="input mono" id="usbConfirm" placeholder="${esc(expected)}" autocomplete="off">
              <div class="btn-row mt"><button class="btn danger" data-action="usb-write" ${selected && iso ? '' : 'disabled'}>${icon('alert', 14)} 擦除并写入</button><button class="btn ghost" data-action="usb-cancel">取消</button></div>
              <div class="progress mt"><span id="usbProgressBar" style="width:0"></span></div>
              <div class="tiny mt" id="usbProgressText">等待操作</div>
            </div>
          </div>
        </div>`}
        <div class="card mt">
          <div class="card-title"><div class="ico">${icon('book')}</div><h3>墨绿OS Live 说明</h3></div>
          <div class="grid grid-3">
            <div class="variant"><b>1. 下载镜像</b><p>从 GitHub Releases 下载 MolvOS Live ISO，并用 SHA-256 校验。当前桌面端支持写入任意 Linux ISO。</p></div>
            <div class="variant"><b>2. RAW 写入</b><p>选择 U 盘与 ISO，输入 <code class="mono">ERASE 磁盘号</code>，确认后写入。需要管理员权限。</p></div>
            <div class="variant"><b>3. 从 USB 启动</b><p>重启进入固件启动菜单，选择 USB。Live 环境不会自动安装到硬盘。</p></div>
          </div>
        </div>`;
    },
    mount() { if (!state.usb || !state.usb.disks) loadUsb(); },
  });

  async function loadUsb() {
    try {
      const disks = await call('usb.disks');
      state.usb = { ...(state.usb || {}), disks: disks || [] };
      if (state.page === 'usb') UI.render();
    } catch (err) { UI.toast(err.message, 'err'); }
  }
  UI.loadUsb = loadUsb;
})();
