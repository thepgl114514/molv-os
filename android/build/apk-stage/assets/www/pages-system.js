'use strict';

(function () {
  const UI = window.MolvUI;
  const { state, esc, icon, fmtBytes, fmtDuration, fmtTime, pct, statusPill, emptyState, pageHead, register, action, call } = UI;

  function setupStatus() {
    const b = state.boot || {};
    const perms = b.permissions || {};
    const integrity = b.integrity || {};
    const virt = b.virtualization || {};
    const linux = b.linux || {};
    const missing = (perms.items || []).filter((i) => i.level === 'missing').length;
    return {
      permissions: missing ? 'warn' : (perms.items && perms.items.length ? 'ok' : 'warn'),
      integrity: integrity.state === 'valid' ? 'ok' : integrity.state === 'missing-manifest' ? 'warn' : 'bad',
      virtualization: virt.enabled ? 'ok' : virt.supported ? 'warn' : 'bad',
      linux: linux.installed ? 'ok' : 'warn',
    };
  }
  UI.setupStatus = setupStatus;

  UI.updateLinuxProgress = function (d) {
    const wrap = document.querySelector('#setupProgressWrap') || document.querySelector('#linuxProgressWrap');
    if (!wrap) return;
    wrap.classList.remove('hide');
    const pctVal = Math.max(0, Math.min(100, Number(d.percent) || 0));
    const bar = document.querySelector('#setupProgressBar') || document.querySelector('#linuxProgressBar');
    const text = document.querySelector('#setupProgressText') || document.querySelector('#linuxProgressText');
    const p = document.querySelector('#setupProgressPct') || document.querySelector('#linuxProgressPct');
    if (bar) bar.style.width = `${pctVal}%`;
    if (text) text.textContent = d.text || d.stage || '处理中…';
    if (p) p.textContent = `${pctVal}%`;
  };

  register('dashboard', {
    render() {
      const b = state.boot || {};
      const integrity = b.integrity || {};
      const linux = b.linux || {};
      const virt = b.virtualization || {};
      const perms = b.permissions || {};
      const permBad = (perms.items || []).filter((i) => i.level === 'missing').length;
      const integrityLevel = integrity.state === 'valid' || integrity.state === 'preview' ? 'ok' : integrity.state === 'missing-manifest' ? 'warn' : 'bad';
      const integrityText = integrityLevel === 'ok' ? '完整' : integrityLevel === 'warn' ? '开发模式' : '异常';
      const virtLevel = virt.enabled ? 'ok' : virt.supported ? 'warn' : 'bad';
      const virtText = virt.enabled ? '已启用' : virt.supported ? '可启用' : '不支持';
      const linuxLevel = linux.installed ? 'ok' : 'warn';
      const linuxText = linux.installed ? '已就绪' : '未安装';
      const readyCount = [permBad === 0, integrityLevel !== 'bad', virt.enabled, linux.installed].filter(Boolean).length;
      const readiness = Math.round((readyCount / 4) * 100);
      const variant = (b.variants || {})[state.config.variant] || {};
      return `
        ${pageHead('MOLV OS · WORKSPACE', '安静、克制、可持续的开发工作台', '把 Linux、编译环境与常用工具收进一个界面；需要时再开启，不让系统一直负重。', `<button class="btn soft" data-nav="setup">${icon('wand', 15)} 安装向导</button><button class="btn primary" data-nav="linux">${icon('terminal', 15)} 打开 Linux</button>`)}
        <div class="card hero">
          <div class="hero-grid">
            <div>
              <div class="eyebrow" style="color:#6fd3ae">墨绿OS · ${esc(variant.name || '精简版')}</div>
              <h1>你的系统，<span>只在你需要时生长。</span></h1>
              <p class="lede">以墨绿为底色的跨平台工作台：Windows 上运行 Android 应用，Android 上连接 Windows 兼容层；Linux 环境与八种编译工具链，按需开启。</p>
              <div class="hero-actions">
                <button class="btn primary lg" data-nav="setup">${icon('rocket', 16)} ${b.setup && b.setup.completed ? '查看安装状态' : '开始配置墨绿OS'}</button>
                <button class="btn ghost" data-action="quick-scan">${icon('shield', 16)} 一键合规扫描</button>
                <button class="btn ghost" data-nav="github">${icon('github', 16)} GitHub 加速</button>
              </div>
              <div class="hero-stats">
                <div><b>${readiness}%</b><small>系统就绪度</small></div>
                <div><b>${linux.installed ? 'Linux' : '—'}</b><small>${linux.installed ? esc(linux.method || '环境') + ' 运行中' : '等待安装'}</small></div>
                <div><b>${(b.android && b.android.online) || 0}</b><small>已连接 Android 设备</small></div>
              </div>
            </div>
            <div class="hero-orbit">
              <div class="orbit-ring r3"></div><div class="orbit-ring r2"></div><div class="orbit-ring r1"></div>
              <div class="orbit-core">墨</div><i class="orbit-dot a"></i><i class="orbit-dot b"></i><i class="orbit-dot c"></i>
            </div>
          </div>
        </div>

        <div class="grid grid-4 mt">
          <div class="card click status-card" data-nav="setup">
            <div class="top"><div class="title">${icon('lock')} 权限与完整性</div>${statusPill(permBad ? 'warn' : 'ok', permBad ? `${permBad} 项待处理` : '已检查')}</div>
            <div class="value">${integrityText}</div>
            <div class="detail">${esc(integrity.message || '启动时自动校验安装文件，缺失或损坏会给出提示。')}</div>
            <div class="foot"><span class="tiny">权限 ${permBad ? '建议补充' : '基本完整'}</span><span class="tiny">查看 →</span></div>
          </div>
          <div class="card click status-card" data-nav="linux">
            <div class="top"><div class="title">${icon('linux')} Linux 环境</div>${statusPill(linuxLevel, linuxText)}</div>
            <div class="value">${linux.installed ? esc((linux.method || 'linux').toUpperCase()) : '未安装'}</div>
            <div class="detail">${esc(linux.message || '安装 Alpine / WSL2 环境，获得完整 Linux 终端与软件包管理。')}</div>
            <div class="foot"><span class="tiny">${linux.installed ? '终端可用' : '约 3–8 分钟'}</span><span class="tiny">进入 →</span></div>
          </div>
          <div class="card click status-card" data-nav="setup">
            <div class="top"><div class="title">${icon('chip')} 虚拟化</div>${statusPill(virtLevel, virtText)}</div>
            <div class="value">${virt.enabled ? 'Ready' : virt.supported ? 'Available' : 'Limited'}</div>
            <div class="detail">${esc(virt.detail || '检测 CPU 虚拟化与 WSL2 / KVM 支持。')}</div>
            <div class="foot"><span class="tiny">${esc(virt.method || '检测中')}</span><span class="tiny">查看 →</span></div>
          </div>
          <div class="card click status-card" data-nav="compilers">
            <div class="top"><div class="title">${icon('code')} 编译环境</div>${statusPill('info', '按需开启')}</div>
            <div class="value">8 <small>种语言</small></div>
            <div class="detail">C/C++、Python、Java、Node.js、Go、Rust、PHP、Ruby；可作用于整机或 Linux 环境。</div>
            <div class="foot"><span class="tiny">${esc(state.config.compilers ? (state.config.compilers.scope === 'linux' ? 'Linux 内' : '整机') : '整机')}</span><span class="tiny">管理 →</span></div>
          </div>
        </div>

        <div class="grid grid-2 mt" style="grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr)">
          <div class="card">
            <div class="card-title"><div class="ico">${icon('zap')}</div><h3>快捷入口</h3><span class="right">常用操作</span></div>
            <div class="quick-grid">
              <button class="quick" data-nav="linux">${icon('terminal')}<span>Linux 终端</span><small>命令行 / 中文环境</small></button>
              <button class="quick" data-nav="compilers">${icon('code')}<span>编译环境</span><small>八种语言</small></button>
              <button class="quick" data-nav="tasks">${icon('activity')}<span>任务管理器</span><small>进程与资源</small></button>
              <button class="quick" data-nav="scan">${icon('shield')}<span>合规扫描</span><small>本地规则</small></button>
              <button class="quick" data-nav="server">${icon('server')}<span>文件服务器</span><small>局域网共享</small></button>
              <button class="quick" data-nav="usb">${icon('usb')}<span>启动盘</span><small>一键制作</small></button>
            </div>
          </div>
          <div class="card">
            <div class="card-title"><div class="ico">${icon('activity')}</div><h3>实时资源</h3><span class="right" id="dashUpdated">—</span></div>
            <div class="stack" style="gap:14px">
              <div><div class="between"><span class="tiny">CPU</span><b class="mono" id="dashCpu">—</b></div><div class="progress sm mt" style="margin-top:6px"><span id="dashCpuBar" style="width:0"></span></div></div>
              <div><div class="between"><span class="tiny">内存</span><b class="mono" id="dashMem">—</b></div><div class="progress sm" style="margin-top:6px"><span id="dashMemBar" style="width:0"></span></div></div>
              <div class="kv"><span>运行时间</span><b id="dashUptime">—</b></div>
              <div class="kv"><span>逻辑核心</span><b id="dashCores">—</b></div>
              <div class="kv"><span>安装包</span><b>${esc(variant.name || '精简版')}</b></div>
            </div>
          </div>
        </div>

        <div class="card mt">
          <div class="card-title"><div class="ico">${icon('book')}</div><h3>从这里开始</h3><span class="right">3 步完成配置</span></div>
          <div class="grid grid-3">
            <div class="variant" data-nav="setup" style="cursor:pointer"><div class="v-top"><b>01 · 检查环境</b>${statusPill(integrityLevel === 'bad' ? 'bad' : 'ok', integrityLevel === 'bad' ? '待修复' : '已检查')}</div><p>校验安装文件，检查权限、虚拟化与 WSL2/KVM 支持。</p></div>
            <div class="variant" data-nav="linux" style="cursor:pointer"><div class="v-top"><b>02 · 安装 Linux</b>${statusPill(linux.installed ? 'ok' : 'warn', linux.installed ? '完成' : '待安装')}</div><p>下载 Alpine rootfs 或导入 WSL2，获得可用的 Linux 终端。</p></div>
            <div class="variant" data-nav="compilers" style="cursor:pointer"><div class="v-top"><b>03 · 开启工具链</b>${statusPill('info', '按需')}</div><p>只启用你正在使用的语言，避免无意义的磁盘与内存占用。</p></div>
          </div>
        </div>`;
    },
    mount() {
      let alive = true;
      const tick = async () => {
        if (!alive) return;
        try {
          const s = await call('system.stats');
          if (!alive) return;
          document.querySelector('#dashCpu').textContent = `${s.cpu}%`;
          document.querySelector('#dashCpuBar').style.width = `${s.cpu}%`;
          document.querySelector('#dashMem').textContent = `${s.memory.percent}% · ${fmtBytes(s.memory.used)}`;
          document.querySelector('#dashMemBar').style.width = `${s.memory.percent}%`;
          document.querySelector('#dashUptime').textContent = fmtDuration(s.uptime);
          document.querySelector('#dashCores').textContent = s.cores;
          document.querySelector('#dashUpdated').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        } catch (_) {}
      };
      tick();
      const timer = setInterval(tick, 3500);
      UI.cleanupAdd(() => { alive = false; clearInterval(timer); });
    },
  });

  const SETUP_STEPS = [
    { key: 'permissions', title: '权限检查', desc: '检查管理员权限、WSL2/KVM、磁盘空间等运行条件。' },
    { key: 'integrity', title: '文件完整性', desc: '校验核心文件哈希，确认安装包没有缺失或损坏。' },
    { key: 'virtualization', title: '虚拟化与 Linux 运行时', desc: '检测硬件虚拟化；Windows 使用 WSL2，Linux 使用 KVM/chroot。' },
    { key: 'linux', title: '安装 Linux 环境', desc: '下载 Alpine rootfs（约 3 MB）并安装基础工具链。' },
  ];

  register('setup', {
    render() {
      const b = state.boot || {};
      const status = setupStatus();
      const perms = b.permissions || {};
      const integrity = b.integrity || {};
      const virt = b.virtualization || {};
      const linux = b.linux || {};
      const variants = b.variants || {};
      const stepEl = SETUP_STEPS.map((s, idx) => {
        const st = status[s.key];
        const detail = s.key === 'permissions'
          ? ((perms.items || []).length ? `${(perms.items || []).filter((i) => i.level === 'ok').length}/${(perms.items || []).length} 项正常` : '尚未检查')
          : s.key === 'integrity' ? (integrity.message || '尚未校验')
            : s.key === 'virtualization' ? (virt.detail || '尚未检测')
              : (linux.message || '尚未安装');
        return `<div class="step ${st === 'ok' ? 'ok' : st === 'bad' ? 'bad' : 'warn'}">
          <div class="step-no">${st === 'ok' ? icon('check', 14) : idx + 1}</div>
          <div><h3>${esc(s.title)} ${statusPill(st === 'ok' ? 'ok' : st === 'bad' ? 'bad' : 'warn', st === 'ok' ? '完成' : st === 'bad' ? '需处理' : '待配置')}</h3><p>${esc(detail)}</p></div>
          <div class="step-actions">
            ${s.key === 'permissions' ? `<button class="btn sm ghost" data-action="setup-perms">查看</button>` : ''}
            ${s.key === 'integrity' ? `<button class="btn sm ghost" data-action="setup-integrity">校验</button>` : ''}
            ${s.key === 'virtualization' ? `<button class="btn sm ghost" data-action="setup-virt">检测</button>` : ''}
            ${s.key === 'linux' ? `<button class="btn sm ${linux.installed ? 'ghost' : 'soft'}" data-action="install-linux">${linux.installed ? '查看' : '安装'}</button>` : ''}
          </div>
        </div>`;
      }).join('');
      return `
        ${pageHead('ONBOARDING', '第一次运行，先把地基打好', '墨绿OS 不会在后台偷偷安装组件。每一步都告诉你将要发生什么，并允许稍后继续。', `<button class="btn ghost" data-action="complete-setup">跳过，先进入工作台</button>`)}
        <div class="notice warn mb"><span class="ico">${icon('alert', 17)}</span><div><b>关于这台设备：</b>当前检测到 ${esc(b.app ? (b.app.platform === 'win32' ? 'Windows' : b.app.platform) : '未知平台')}${b.app && b.app.admin ? '，已具备管理员权限。' : '，当前为普通权限。安装 WSL2、制作启动盘时会请求管理员权限。'} Linux 环境是独立运行时，不会替换或修改你的现有系统。</div></div>
        <div class="setup-grid">
          <div class="card">
            <div class="card-title"><div class="ico">${icon('wand')}</div><h3>安装步骤</h3><span class="right">${SETUP_STEPS.filter((s) => status[s.key] === 'ok').length}/4 完成</span></div>
            <div class="stepper">${stepEl}</div>
            <div class="between mt" style="border-top:1px solid var(--line-soft);padding-top:14px">
              <div class="tiny">${linux.installed ? '核心环境已就绪，可以开始使用。' : '建议至少完成前两步，再安装 Linux。'}</div>
              <div class="btn-row">
                <button class="btn ghost" data-action="run-checks">${icon('refresh2', 14)} 一键检查</button>
                <button class="btn primary" data-action="install-linux" ${linux.installed ? 'disabled' : ''}>${icon('download', 14)} ${linux.installed ? 'Linux 已安装' : '安装 Linux 环境'}</button>
              </div>
            </div>
            <div id="setupProgressWrap" class="mt hide">
              <div class="between mb" style="margin-bottom:6px"><span class="tiny" id="setupProgressText">准备中…</span><span class="tiny mono" id="setupProgressPct">0%</span></div>
              <div class="progress"><span id="setupProgressBar"></span></div>
            </div>
            <div id="setupLog" class="log-view mt hide"></div>
          </div>
          <div class="stack">
            <div class="card">
              <div class="card-title"><div class="ico">${icon('package')}</div><h3>选择安装包规格</h3></div>
              <div class="stack" id="variantList">
                ${Object.entries(variants).map(([id, v]) => `<div class="variant ${state.config.variant === id ? 'active' : ''}" data-action="variant-select" data-variant="${id}"><div class="check">${icon('check', 10)}</div><div class="v-top"><b>${esc(v.name)}</b><span class="price">${esc(v.size)}</span></div><p>${esc(v.desc)}</p><ul>${(v.components || []).slice(0, 4).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>`).join('') || emptyState('安装包信息未加载')}
              </div>
              <div class="hint mt">选择只影响首次安装时预置的组件；之后仍可在设置中调整。当前版本不会在安装时静默安装第三方应用。</div>
            </div>
            <div class="card">
              <div class="card-title"><div class="ico">${icon('shield')}</div><h3>安全与隐私</h3></div>
              <div class="kv"><span>数据目录</span><b class="mono" style="font-size:10px">${esc((b.app && b.app.dataDir) || '—')}</b></div>
              <div class="kv"><span>上传遥测</span><b>关闭</b></div>
              <div class="kv"><span>扫描结果</span><b>仅保存在本机</b></div>
              <div class="hint mt">完整性校验使用 SHA-256 清单，能发现文件缺失或损坏，但不替代代码签名。公开发布包应附带校验和。</div>
            </div>
          </div>
        </div>`;
    },
    mount() {
      UI.onEvent((msg) => { if (msg.type === 'linux:install-progress') UI.updateLinuxProgress(msg.data); });
    },
  });

  register('linux', {
    render() {
      const s = (state.boot && state.boot.linux) || {};
      const installed = Boolean(s.installed);
      const pkg = s.packages || {};
      const methodLabel = { wsl: 'WSL2', chroot: 'chroot', proot: 'proot', native: '原生 Linux', kvm: 'KVM' }[s.method] || s.method || '未配置';
      return `
        ${pageHead('LINUX RUNTIME', 'Linux 环境', '一个不打扰宿主的 Linux 运行时：Windows 使用 WSL2，Android 使用 root + chroot，Linux 直接使用原生内核。', `<button class="btn ghost" data-action="refresh-linux">${icon('refresh2', 14)} 刷新状态</button><button class="btn primary" data-action="install-linux" ${installed ? 'disabled' : ''}>${icon('download', 14)} ${installed ? '已安装' : '安装环境'}</button>`)}
        <div class="grid grid-4">
          <div class="card status-card"><div class="top"><div class="title">${icon('linux')} 运行方式</div>${statusPill(installed ? 'ok' : 'warn', installed ? '可用' : '待安装')}</div><div class="value">${esc(methodLabel)}</div><div class="detail">${esc(s.message || '尚未检测')}</div></div>
          <div class="card status-card"><div class="top"><div class="title">${icon('package')} 基础包</div>${statusPill(installed ? 'ok' : 'info', installed ? 'Alpine' : '—')}</div><div class="value" style="font-size:15px">${esc((pkg.slim || []).slice(0, 3).join(' · ') || 'bash · git · curl')}</div><div class="detail">可在 Linux 内使用 apk 安装更多软件包。</div></div>
          <div class="card status-card"><div class="top"><div class="title">${icon('terminal')} 终端会话</div>${statusPill('info', 'xterm')}</div><div class="value">${state.terminal ? '1' : '0'}<small> 个</small></div><div class="detail">支持中文、颜色与常见控制序列；非 TTY 模式下行编辑为本地回显。</div></div>
          <div class="card status-card"><div class="top"><div class="title">${icon('folder')} rootfs</div>${statusPill(installed ? 'ok' : 'info', installed ? '已就绪' : '未下载')}</div><div class="value" style="font-size:14px;word-break:break-all">${esc(s.version || 'Alpine minirootfs')}</div><div class="detail">${esc(s.rootfs || '将安装到墨绿OS 数据目录')}</div></div>
        </div>

        ${!installed ? `
          <div class="card mt">
            <div class="card-title"><div class="ico">${icon('rocket')}</div><h3>安装 Linux 环境</h3><span class="right">约 3–8 分钟</span></div>
            <div class="grid grid-3">
              <div class="variant"><div class="v-top"><b>1. 获取 rootfs</b></div><p>从 Alpine 官方源下载 minirootfs，并用 SHA-256 校验，避免被篡改。</p></div>
              <div class="variant"><div class="v-top"><b>2. 导入运行时</b></div><p>Windows 导入 WSL2 发行版；Android root 设备解压后 chroot；Linux 解压到数据目录。</p></div>
              <div class="variant"><div class="v-top"><b>3. 安装基础包</b></div><p>bash、git、curl 与所选规格对应的工具链。可随时用 apk 扩展。</p></div>
            </div>
            <div class="notice warn mt"><span class="ico">${icon('alert', 17)}</span><div><b>Windows 需要 WSL2。</b> 如果尚未启用，安装会请求管理员权限，并可能要求重启。墨绿OS 不会修改你的默认 WSL 发行版，也不会替换系统组件。</div></div>
            <div id="linuxProgressWrap" class="mt hide">
              <div class="between mb" style="margin-bottom:6px"><span class="tiny" id="linuxProgressText">准备中…</span><span class="tiny mono" id="linuxProgressPct">0%</span></div>
              <div class="progress"><span id="linuxProgressBar"></span></div>
            </div>
            <div class="btn-row mt"><button class="btn primary" data-action="install-linux">${icon('download', 15)} 开始安装</button><button class="btn ghost" data-action="linux-manual">手动安装说明</button></div>
          </div>
        ` : `
          <div class="card mt">
            <div class="card-title"><div class="ico">${icon('terminal')}</div><h3>Linux 终端</h3><span class="right">${esc(s.method === 'wsl' ? 'WSL2 · root' : 'Alpine · root')}</span></div>
            <div class="term-wrap">
              <div class="term-bar"><div class="lights"><i></i><i></i><i></i></div><span class="t-title" id="termTitle">molv@linux — bash</span><div class="t-actions"><button data-action="term-clear">清屏</button><button data-action="term-reconnect">重连</button><button data-action="term-close">关闭</button></div></div>
              <div class="terminal" id="terminal"></div>
              <div class="term-hint"><span>Enter 执行 · Ctrl+C 中断 · 方向键在非 TTY 模式下不可用</span><div class="quick-cmds"><button data-cmd="uname -a">uname</button><button data-cmd="apk update">apk update</button><button data-cmd="python3 --version">python</button><button data-cmd="g++ --version">g++</button><button data-cmd="df -h">df</button><button data-cmd="top -b -n 1 | head -n 12">top</button></div></div>
            </div>
            <div class="hint mt">提示：安装语言工具链后，可直接在终端运行 <code class="mono">g++</code>、<code class="mono">python3</code>、<code class="mono">go</code> 等命令。终端以 root 运行在隔离环境中，请勿在其中执行不可信脚本。</div>
          </div>
        `}

        <div class="grid grid-2 mt">
          <div class="card">
            <div class="card-title"><div class="ico">${icon('package')}</div><h3>按需扩展</h3></div>
            <div class="row">
              <button class="btn sm soft" data-pkg="python3 py3-pip">Python</button>
              <button class="btn sm soft" data-pkg="build-base">C/C++</button>
              <button class="btn sm soft" data-pkg="openjdk17-jdk">Java</button>
              <button class="btn sm soft" data-pkg="go">Go</button>
              <button class="btn sm soft" data-pkg="nodejs npm">Node.js</button>
              <button class="btn sm soft" data-pkg="rust cargo">Rust</button>
              <button class="btn sm soft" data-pkg="git curl nano">Git / 编辑器</button>
            </div>
            <div class="hint mt">点击后通过 <code class="mono">apk add</code> 安装到 Linux 环境，不会改动 Windows 侧的工具链。</div>
          </div>
          <div class="card">
            <div class="card-title"><div class="ico">${icon('info')}</div><h3>环境说明</h3></div>
            <div class="kv"><span>平台</span><b>${esc(s.platform || '—')}</b></div>
            <div class="kv"><span>发行版</span><b>${esc(s.distro || 'MolvOS / Alpine')}</b></div>
            <div class="kv"><span>需要管理员</span><b>${s.needsAdmin ? '安装时需要' : '否'}</b></div>
            <div class="kv"><span>检查时间</span><b>${esc(fmtTime(s.checkedAt))}</b></div>
            ${s.instructions ? `<div class="notice warn mt"><span class="ico">${icon('alert', 16)}</span><div>${s.instructions.map((x) => `<div>· ${esc(x)}</div>`).join('')}</div></div>` : ''}
          </div>
        </div>`;
    },
    mount() {
      UI.onEvent((msg) => {
        if (msg.type === 'linux:install-progress') UI.updateLinuxProgress(msg.data);
        if (msg.type === 'linux:terminal' && state.terminal) {
          const d = msg.data || {};
          if (d.id !== state.terminal.id) return;
          if (d.type === 'data') state.terminal.xterm.write(d.data);
          if (d.type === 'exit') state.terminal.xterm.writeln(`\r\n\x1b[38;5;244m[会话已结束，退出码 ${d.data}]\x1b[0m`);
        }
      });
      const s = (state.boot && state.boot.linux) || {};
      if (s.installed) initTerminal();
    },
  });

  async function initTerminal() {
    const el = document.querySelector('#terminal');
    if (!el || !window.Terminal) return;
    try {
      const xterm = new window.Terminal({
        fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
        fontSize: 12.5, lineHeight: 1.25, cursorBlink: true, scrollback: 4000, convertEol: false,
        theme: {
          background: '#04100c', foreground: '#c9e8d9', cursor: '#8ff0c8', selectionBackground: '#1f5c45',
          black: '#08140f', red: '#ff7b72', green: '#79e2b3', yellow: '#e8c468', blue: '#7dc4ff',
          magenta: '#c7a7ff', cyan: '#71dfe2', white: '#e7f5ee', brightBlack: '#5d7d70', brightRed: '#ff9e98',
          brightGreen: '#a9ffdb', brightYellow: '#f4dda0', brightBlue: '#a7d7ff', brightMagenta: '#ddc9ff',
          brightCyan: '#a5f4f6', brightWhite: '#ffffff',
        },
      });
      const fit = new window.FitAddon.FitAddon();
      xterm.loadAddon(fit);
      xterm.open(el);
      requestAnimationFrame(() => { try { fit.fit(); } catch (_) {} });
      xterm.writeln('\x1b[38;5;79m墨绿OS Linux\x1b[0m \x1b[38;5;244m正在连接…\x1b[0m');
      const session = await call('linux.terminal.open');
      state.terminal = { xterm, fit, id: session.id, line: '', session };
      document.querySelector('#termTitle').textContent = `${session.label} — ${session.method || 'linux'}`;
      xterm.onData((data) => {
        const st = state.terminal;
        if (!st || st.id !== session.id) return;
        for (const ch of data) {
          if (ch === '\r') {
            xterm.write('\r\n');
            call('linux.terminal.write', { id: session.id, data: '\n' }).catch(() => {});
            st.line = '';
          } else if (ch === '\x7f') {
            if (st.line.length) {
              st.line = st.line.slice(0, -1);
              xterm.write('\b \b');
              call('linux.terminal.write', { id: session.id, data: '\x7f' }).catch(() => {});
            }
          } else if (ch === '\x03') {
            xterm.write('^C\r\n');
            call('linux.terminal.write', { id: session.id, data: '\x03' }).catch(() => {});
            st.line = '';
          } else if (ch === '\x0c') {
            xterm.clear();
            call('linux.terminal.write', { id: session.id, data: '\x0c' }).catch(() => {});
          } else if (ch === '\t') {
            xterm.write('  ');
            call('linux.terminal.write', { id: session.id, data: '\t' }).catch(() => {});
          } else if (ch >= ' ' && ch !== '\x1b') {
            st.line += ch;
            xterm.write(ch);
            call('linux.terminal.write', { id: session.id, data: ch }).catch(() => {});
          }
        }
      });
      const resize = () => { try { fit.fit(); } catch (_) {} };
      window.addEventListener('resize', resize);
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      UI.cleanupAdd(() => {
        window.removeEventListener('resize', resize);
        ro.disconnect();
        if (state.terminal && state.terminal.id === session.id) {
          call('linux.terminal.close', { id: session.id }).catch(() => {});
          state.terminal.xterm.dispose();
          state.terminal = null;
        }
      });
    } catch (err) {
      el.innerHTML = `<div class="empty">终端连接失败：${esc(err.message)}</div>`;
      UI.toast(`终端连接失败：${err.message}`, 'err');
    }
  }

  UI.initTerminal = initTerminal;
  UI.terminalSend = function (data) {
    if (!state.terminal) return;
    call('linux.terminal.write', { id: state.terminal.id, data }).catch((err) => UI.toast(err.message, 'err'));
  };

  register('compilers', {
    render() {
      const scope = state.compilerScope || 'device';
      const linuxReady = Boolean(state.boot && state.boot.linux && state.boot.linux.installed);
      return `
        ${pageHead('TOOLCHAINS', '编译环境', '不是所有语言都要常驻。选择作用域，按需开启；切换只影响新启动的终端与会话。', `<div class="tabs"><button class="tab ${scope === 'device' ? 'active' : ''}" data-action="compiler-scope" data-scope="device">整机</button><button class="tab ${scope === 'linux' ? 'active' : ''}" data-action="compiler-scope" data-scope="linux">Linux 内</button></div><button class="btn ghost" data-action="refresh-compilers">${icon('refresh2', 14)} 重新检测</button>`)}
        ${scope === 'linux' && !linuxReady ? `<div class="notice warn mb"><span class="ico">${icon('alert', 17)}</span><div><b>Linux 环境尚未安装。</b> 先完成 Linux 安装，才能在隔离环境中安装与检测工具链。<button class="btn sm soft" data-nav="linux" style="margin-left:8px">去安装</button></div></div>` : ''}
        <div class="grid grid-3 mb">
          <div class="card tight"><div class="between"><div><div class="tiny">当前作用域</div><div style="font-size:16px;font-weight:600">${scope === 'linux' ? 'Linux 环境内' : '整台设备'}</div></div><span class="pill info"><i></i>${scope === 'linux' ? '隔离' : '全局 PATH'}</span></div></div>
          <div class="card tight"><div class="between"><div><div class="tiny">已启用</div><div style="font-size:16px;font-weight:600" id="compilerEnabledCount">—</div></div>${icon('zap', 22)}</div></div>
          <div class="card tight"><div class="between"><div><div class="tiny">已检测到</div><div style="font-size:16px;font-weight:600" id="compilerInstalledCount">—</div></div>${icon('check', 22)}</div></div>
        </div>
        <div class="compiler-grid" id="compilerGrid"><div class="card">${emptyState('正在检测工具链…', 'code')}</div></div>
        <div class="notice mt"><span class="ico">${icon('info', 17)}</span><div><b>作用域说明：</b>“整机”会使用 Windows / 宿主机 PATH 中的工具链，适合直接在本机编译；“Linux 内”只在 Alpine / WSL 环境安装，不污染宿主机。已安装但未启用的语言不会出现在墨绿OS 的默认环境面板中。</div></div>`;
    },
    mount() { loadCompilers(); },
  });

  async function loadCompilers() {
    const grid = document.querySelector('#compilerGrid');
    if (!grid) return;
    try {
      const data = await call('compilers.list', { scope: state.compilerScope });
      state.compilers = data.compilers || [];
      renderCompilers();
    } catch (err) {
      grid.innerHTML = `<div class="card">${emptyState(`检测失败：${err.message}`, 'alert')}</div>`;
    }
  }

  function renderCompilers() {
    const grid = document.querySelector('#compilerGrid');
    if (!grid) return;
    const list = state.compilers || [];
    if (!list.length) { grid.innerHTML = `<div class="card">${emptyState('没有可用的编译环境数据', 'code')}</div>`; return; }
    grid.innerHTML = list.map((c) => `
      <div class="compiler ${c.enabled ? '' : 'off'}">
        <div class="c-head"><div style="display:flex;gap:9px;align-items:center"><div class="c-icon" style="background:${esc(c.color || '#54d6a4')}">${esc(c.short || c.name.slice(0, 2))}</div><div><div class="c-name">${esc(c.name)}</div><div class="tiny">${esc(c.id)}</div></div></div><button class="switch ${c.enabled ? 'on' : ''}" data-action="compiler-toggle" data-id="${esc(c.id)}" aria-label="启用 ${esc(c.name)}"></button></div>
        <div class="c-desc">${esc(c.desc)}</div>
        <div class="c-meta"><span class="c-ver" title="${esc(c.version || '')}">${c.installed ? esc(c.version || '已安装') : '未安装'}</span>${c.installed ? statusPill('ok', c.portable ? '内置' : '可用') : '<span class="pill warn"><i></i>缺失</span>'}</div>
        <div class="btn-row" style="margin-top:9px">${c.installed ? `<button class="btn sm ghost" data-action="compiler-verify" data-id="${esc(c.id)}">验证</button>` : `<button class="btn sm soft" data-action="compiler-install" data-id="${esc(c.id)}">安装</button>`}<button class="btn sm ghost" data-action="compiler-site" data-id="${esc(c.id)}" title="官网">${icon('external', 12)}</button></div>
      </div>
    `).join('');
    const enabled = list.filter((c) => c.enabled).length;
    const installed = list.filter((c) => c.installed).length;
    const e = document.querySelector('#compilerEnabledCount'); if (e) e.textContent = `${enabled} / ${list.length}`;
    const i = document.querySelector('#compilerInstalledCount'); if (i) i.textContent = String(installed);
  }

  UI.renderCompilers = renderCompilers;

  register('apps', {
    render() {
      const android = (state.boot && state.boot.android) || {};
      const isAndroid = window.Molv.isAndroid;
      const tab = state.appTab || 'android';
      const devices = android.devices || [];
      return `
        ${pageHead('APP COMPATIBILITY', '应用兼容', 'Windows 与 Android 之间没有魔法，只有运行时。墨绿OS 负责检测、安装与一键跳转，并明确告诉你每一步的边界。', '')}
        <div class="tabs mb"><button class="tab ${tab === 'android' ? 'active' : ''}" data-action="apps-tab" data-tab="android">${isAndroid ? 'Windows 应用' : '在 Windows 运行 APK'}</button><button class="tab ${tab === 'windows' ? 'active' : ''}" data-action="apps-tab" data-tab="windows">${isAndroid ? 'Android 本机' : '在 Android 运行 Windows 程序'}</button></div>
        ${tab === 'android' ? (isAndroid ? renderWindowsOnAndroid() : renderApkOnWindows(android, devices)) : (isAndroid ? renderAndroidNative(android) : renderWindowsOnAndroid())}
      `;
    },
    mount() {
      if (!window.Molv.isAndroid && !state.androidLoaded) refreshAndroid();
    },
  });

  function renderApkOnWindows(android, devices) {
    return `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title"><div class="ico">${icon('phone')}</div><h3>Android 运行环境</h3><span class="right">${android.adb ? 'adb 已就绪' : '未配置'}</span></div>
          <div class="kv"><span>adb</span><b class="mono" style="font-size:10px">${esc(android.adb ? android.adb.path : '未找到')}</b></div>
          <div class="kv"><span>在线设备</span><b>${devices.filter((d) => d.online).length} 台</b></div>
          <div class="kv"><span>模拟器</span><b>${android.emulator ? `${android.emulator.avds.length} 个 AVD` : '未安装'}</b></div>
          <div class="kv"><span>原生 APK 支持</span><b style="color:#f0d58d">不支持，需要 Android 运行时</b></div>
          <p class="hint mt">${esc(android.message || '连接 Android 手机并开启 USB 调试，或安装 Android Studio 创建模拟器。')}</p>
          <div class="btn-row mt"><button class="btn primary" data-action="android-choose">${icon('plus', 14)} 选择 APK 并安装</button><button class="btn ghost" data-action="android-emulator">${icon('play', 14)} 启动模拟器</button><button class="btn ghost" data-action="android-studio">${icon('download', 14)} 安装 Android Studio</button></div>
        </div>
        <div class="card">
          <div class="card-title"><div class="ico">${icon('monitor')}</div><h3>设备与运行</h3><span class="right">USB / 模拟器</span></div>
          ${devices.length ? `<div class="table-wrap"><table><thead><tr><th>序列号</th><th>状态</th><th>型号</th><th></th></tr></thead><tbody>${devices.map((d) => `<tr><td class="mono">${esc(d.serial)}</td><td>${statusPill(d.online ? 'ok' : 'warn', d.state)}</td><td>${esc(d.model || '—')}</td><td><button class="btn sm ghost" data-action="android-adb-start">刷新</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('尚未连接 Android 设备', 'phone')}
          <div class="notice warn mt"><span class="ico">${icon('alert', 16)}</span><div>“在 Windows 运行 APK”依赖 adb + Android 设备/模拟器，不是把 APK 变成原生 Windows 程序。微软已停止 WSA，建议使用真机调试或 Android Studio 模拟器。</div></div>
        </div>
      </div>
      <div class="card mt">
        <div class="card-title"><div class="ico">${icon('shield')}</div><h3>安全提示</h3></div>
        <div class="grid grid-3"><div class="variant"><b>只安装可信 APK</b><p>侧载 APK 拥有其声明的全部权限。墨绿OS 会显示包名、版本与大小，但不会替你做安全判断。</p></div><div class="variant"><b>USB 调试有风险</b><p>开启 USB 调试后，连接的电脑可以执行较高权限操作。完成后建议关闭调试。</p></div><div class="variant"><b>模拟器隔离更好</b><p>不确定来源的应用优先在模拟器中运行；真机测试前先备份数据。</p></div></div>
      </div>`;
  }

  function renderWindowsOnAndroid() {
    return `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title"><div class="ico">${icon('windows')}</div><h3>Windows 程序兼容层</h3><span class="right">Android / root</span></div>
          <p class="muted" style="font-size:12px">Android 内核不能直接执行 Windows PE 程序。可行路径是使用 Wine + Box64/Box86 兼容层（如 Winlator），并在 root 设备上获得更好的文件与图形性能。</p>
          <div class="kv"><span>推荐方案</span><b>Winlator（开源）</b></div>
          <div class="kv"><span>需要 root</span><b>建议，但不是所有功能必需</b></div>
          <div class="kv"><span>墨绿OS 角色</span><b>检测安装、一键跳转、共享目录</b></div>
          <div class="btn-row mt"><button class="btn primary" data-action="open-winlator">${icon('external', 14)} 打开 / 获取 Winlator</button><button class="btn ghost" data-action="check-root">${icon('key', 14)} 检查 root</button></div>
        </div>
        <div class="card">
          <div class="card-title"><div class="ico">${icon('info')}</div><h3>诚实的能力边界</h3></div>
          <div class="notice warn"><span class="ico">${icon('alert', 16)}</span><div>墨绿OS 不是 Windows 模拟器，也不会把 .exe 转译成 Android 原生代码。它负责把 Winlator / Termux / root 环境连接起来；实际的 Windows API 兼容由 Wine 项目完成。</div></div>
          <div class="hint mt">如果你需要 100% 的 Windows 兼容性，远程桌面到一台 Windows 主机通常比本地兼容层更可靠。墨绿OS 的文件服务器与端口映射可以配合这种用法。</div>
        </div>
      </div>`;
  }

  function renderAndroidNative(android) {
    return `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title"><div class="ico">${icon('phone')}</div><h3>本机 Android</h3><span class="right">MolvOS Mobile</span></div>
          <div class="kv"><span>运行模式</span><b>WebView + 原生桥接</b></div>
          <div class="kv"><span>Linux</span><b>root + chroot / Termux</b></div>
          <div class="kv"><span>设备</span><b>${esc(android.message || '当前设备')}</b></div>
          <p class="hint mt">在 Android 端，Linux 安装、任务管理、扫描与文件服务器由原生 Java 服务执行；界面与桌面端保持一致。</p>
          <div class="btn-row mt"><button class="btn primary" data-nav="linux">${icon('terminal', 14)} 打开 Linux</button><button class="btn ghost" data-nav="tasks">${icon('activity', 14)} 任务管理器</button></div>
        </div>
        <div class="card">
          <div class="card-title"><div class="ico">${icon('shield')}</div><h3>权限与 root</h3></div>
          <div class="kv"><span>存储权限</span><b>按需申请</b></div>
          <div class="kv"><span>root</span><b>可选，用于 chroot 与系统级操作</b></div>
          <div class="kv"><span>Termux</span><b>非 root 的兼容路径</b></div>
          <div class="btn-row mt"><button class="btn soft" data-action="android-grant">${icon('lock', 14)} 申请权限</button><button class="btn ghost" data-action="check-root">${icon('key', 14)} 检查 root</button></div>
        </div>
      </div>`;
  }

  async function refreshAndroid() {
    try {
      const data = await call('android.status');
      state.androidLoaded = true;
      if (state.boot) state.boot.android = data;
      if (state.page === 'apps') UI.render();
    } catch (_) {}
  }
})();
