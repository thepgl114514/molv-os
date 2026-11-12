'use strict';

(function () {
  const UI = window.MolvUI;
  const { state, action, call, icon, esc, fmtBytes, toast, modal, setBusy } = UI;

  async function refreshBoot() {
    state.boot = await call('app.bootstrap');
    state.config = state.boot.config || state.config;
    UI.updateChrome();
  }

  action('variant-select', async (el) => {
    const id = el.dataset.variant;
    const restore = setBusy(el, true, '保存中…');
    try {
      await call('variant.set', { variant: id });
      state.config.variant = id;
      document.querySelectorAll('[data-variant]').forEach((x) => x.classList.toggle('active', x.dataset.variant === id));
      UI.updateChrome();
      toast('安装包规格已保存', 'ok');
    } finally { restore(); }
  });

  action('complete-setup', async () => {
    await call('app.completeSetup');
    state.config.setup = { ...(state.config.setup || {}), completed: true };
    toast('已标记为完成，可以随时回到安装向导补充环境', 'ok');
    UI.navigate('dashboard');
  });

  action('run-checks', async (btn) => {
    const restore = setBusy(btn, true, '检查中…');
    try {
      const [perms, integrity, virt] = await Promise.all([call('permissions.check'), call('integrity.verify'), call('virt.check')]);
      state.boot.permissions = perms;
      state.boot.integrity = integrity;
      state.boot.virtualization = virt;
      UI.updateChrome();
      toast('环境检查完成', 'ok');
      UI.render();
    } finally { restore(); }
  });

  action('setup-perms', async () => {
    const p = state.boot.permissions || {};
    const items = p.items || [];
    await modal({
      title: '权限与环境检查',
      desc: '这些项目由操作系统管理，墨绿OS 只会打开对应设置页，不会替你修改系统策略。',
      body: `<div class="stack">${items.map((i) => `<div class="kv"><span>${esc(i.label)}</span><b>${UI.statusPill(i.level === 'ok' ? 'ok' : i.level === 'missing' ? 'bad' : 'warn', i.level === 'ok' ? '正常' : i.level === 'missing' ? '缺失' : '建议')}</b></div><div class="hint" style="margin:-4px 0 8px">${esc(i.detail || '')}</div>`).join('')}</div><div class="btn-row mt"><button class="btn soft" data-action="open-windows-features">打开 Windows 功能</button><button class="btn ghost" data-action="elevate-app">以管理员重启</button></div>`,
      okText: '关闭', showCancel: false,
    });
  });

  action('setup-integrity', async () => {
    const r = await call('integrity.verify');
    state.boot.integrity = r;
    await modal({ title: r.ok ? '完整性校验通过' : '完整性校验异常', desc: r.message, body: `<div class="kv"><span>检查文件</span><b>${r.checked} / ${r.total}</b></div><div class="kv"><span>清单生成</span><b>${esc(r.generatedAt || '—')}</b></div>${r.missing && r.missing.length ? `<div class="notice danger mt"><span class="ico">${icon('alert', 16)}</span><div>缺失：<br>${r.missing.slice(0, 10).map(esc).join('<br>')}</div></div>` : ''}${r.mismatch && r.mismatch.length ? `<div class="notice danger mt"><span class="ico">${icon('alert', 16)}</span><div>不一致：<br>${r.mismatch.slice(0, 10).map((m) => esc(m.file)).join('<br>')}</div></div>` : ''}`, okText: '关闭', showCancel: false });
    UI.updateChrome();
  });

  action('setup-virt', async () => {
    const v = await call('virt.check');
    state.boot.virtualization = v;
    await modal({ title: '虚拟化检测', desc: v.detail, body: `<div class="kv"><span>平台</span><b>${esc(v.platform)}</b></div><div class="kv"><span>方法</span><b>${esc(v.method || '—')}</b></div><div class="kv"><span>硬件虚拟化</span><b>${v.supported ? '支持' : '未检测到'}</b></div><div class="kv"><span>已启用</span><b>${v.enabled ? '是' : '否'}</b></div>${v.wslDistros ? `<div class="kv"><span>WSL 发行版</span><b>${esc(v.wslDistros.join(', ') || '无')}</b></div>` : ''}`, okText: '关闭', showCancel: false });
    UI.render();
  });

  action('open-windows-features', async () => { await call('permissions.open', { kind: 'open-windows-features' }); toast('已打开 Windows 可选功能设置', 'ok'); });
  action('elevate-app', async () => { const r = await call('permissions.elevate'); toast(r.message || '已请求管理员权限', 'ok'); });

  action('install-linux', async (btn) => {
    if (state.busy.linuxInstall) return;
    state.busy.linuxInstall = true;
    const restores = Array.from(document.querySelectorAll('[data-action="install-linux"]')).map((b) => setBusy(b, true, '安装中…'));
    const wrap = document.querySelector('#setupProgressWrap') || document.querySelector('#linuxProgressWrap');
    if (wrap) wrap.classList.remove('hide');
    try {
      const result = await call('linux.install', { variant: state.config.variant || 'slim' });
      if (result && result.ok === false) {
        if (result.code === 'WSL_MISSING') {
          const yes = await modal({
            title: '需要启用 WSL2',
            desc: '安装 Linux 环境需要 Windows 的“适用于 Linux 的 Windows 子系统”。这需要管理员权限，可能要求重启。',
            body: `<div class="notice warn"><span class="ico">${icon('alert', 16)}</span><div>${(result.instructions || []).map((x) => `<div>· ${esc(x)}</div>`).join('')}</div></div>`,
            okText: '以管理员安装 WSL2', cancelText: '稍后手动安装',
          });
          if (yes) {
            const r = await call('linux.install', { variant: state.config.variant || 'slim', elevate: true });
            if (r && r.needsReboot) await modal({ title: '请重启电脑', desc: 'WSL2 组件安装命令已完成。重启后回到墨绿OS，再次点击“安装 Linux 环境”。', okText: '知道了', showCancel: false });
          }
        } else if (result.needsReboot) {
          await modal({ title: '请重启电脑', desc: result.message, okText: '知道了', showCancel: false });
        } else {
          toast(result.message || 'Linux 安装未完成', 'err');
        }
      } else {
        state.boot.linux = await call('linux.status');
        await call('app.completeSetup').catch(() => {});
        state.config.setup = { ...(state.config.setup || {}), completed: true };
        toast('Linux 环境安装完成', 'ok');
      }
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      state.busy.linuxInstall = false;
      restores.forEach((r) => r());
      UI.render();
    }
  });

  action('refresh-linux', async () => {
    state.boot.linux = await call('linux.status');
    toast('Linux 状态已刷新', 'ok');
    UI.render();
  });

  action('linux-manual', async () => {
    await modal({
      title: '手动安装 Linux 环境',
      desc: '如果自动安装失败，可以按下面的步骤操作。墨绿OS 使用独立发行版名称 MolvOS，不覆盖默认发行版。',
      body: `<div class="log-view" style="max-height:320px"># 1. 以管理员身份打开 PowerShell
wsl --install --no-distribution
# 2. 重启电脑
# 3. 回到墨绿OS，点击“安装 Linux 环境”
# 或手动导入：
wsl --import MolvOS "$env:APPDATA\\MolvOS\\linux\\wsl" "alpine-minirootfs.tar.gz" --version 2
wsl -d MolvOS -u root</div><div class="hint mt">Android：需要 root，使用 chroot；非 root 设备可安装 Termux 作为兼容路径。Linux：直接使用原生 shell，可选安装 Alpine rootfs。</div>`,
      okText: '知道了', showCancel: false,
    });
  });

  action('linux-pkg', async (btn) => {
    const pkgs = btn.dataset.pkg;
    const restore = setBusy(btn, true, '安装中…');
    try {
      const r = await call('linux.packages', { packages: pkgs.split(/\s+/) });
      toast(r.ok ? `已安装：${pkgs}` : (r.error || '安装失败'), r.ok ? 'ok' : 'err');
    } finally { restore(); }
  });

  action('term-clear', () => { if (state.terminal) state.terminal.xterm.clear(); });
  action('term-reconnect', () => { if (state.terminal) { call('linux.terminal.close', { id: state.terminal.id }).catch(() => {}); state.terminal.xterm.dispose(); state.terminal = null; } UI.render(); });
  action('term-close', () => { if (state.terminal) { call('linux.terminal.close', { id: state.terminal.id }).catch(() => {}); state.terminal.xterm.dispose(); state.terminal = null; } UI.render(); });
  action('term-command', (btn) => {
    const cmd = btn.dataset.cmd;
    if (!state.terminal) return toast('终端尚未连接', 'err');
    state.terminal.xterm.write(`${cmd}\r\n`);
    UI.terminalSend(`${cmd}\n`);
  });

  action('compiler-scope', async (btn) => {
    const scope = btn.dataset.scope;
    if (scope === state.compilerScope) return;
    await call('compilers.setScope', { scope });
    state.compilerScope = scope;
    state.config.compilers = { ...(state.config.compilers || {}), scope };
    UI.render();
  });

  action('refresh-compilers', async () => { await UI.loadCompilers(); toast('工具链状态已刷新', 'ok'); });

  action('compiler-toggle', async (btn) => {
    const id = btn.dataset.id;
    const item = (state.compilers || []).find((c) => c.id === id);
    if (!item) return;
    const next = !item.enabled;
    await call('compilers.setEnabled', { id, enabled: next });
    item.enabled = next;
    btn.classList.toggle('on', next);
    const card = btn.closest('.compiler'); if (card) card.classList.toggle('off', !next);
    toast(`${item.name} 已${next ? '启用' : '停用'}`, 'ok');
  });

  action('compiler-install', async (btn) => {
    const id = btn.dataset.id;
    const item = (state.compilers || []).find((c) => c.id === id);
    if (!item) return;
    const scope = state.compilerScope;
    const ok = await modal({ title: `安装 ${item.name}`, desc: scope === 'linux' ? '将安装到墨绿 Linux 环境，不影响宿主机。' : `将使用系统包管理器安装到${window.Molv.platform === 'win32' ? '整台 Windows 设备' : '当前系统'}，可能需要管理员授权。`, body: `<div class="kv"><span>包/来源</span><b class="mono">${esc(scope === 'linux' ? item.apk : item.winget)}</b></div><div class="notice warn mt"><span class="ico">${icon('alert', 16)}</span><div>安装过程可能持续数分钟，请保持网络连接。</div></div>`, okText: '开始安装' });
    if (!ok) return;
    const restore = setBusy(btn, true, '安装中…');
    try {
      const r = await call('compilers.install', { id, scope });
      if (r && r.ok === false && r.manual) {
        await modal({ title: '需要手动执行', desc: r.message, body: `<div class="log-view">${esc(r.command)}</div>`, okText: '关闭', showCancel: false });
      } else {
        await modal({ title: '安装命令已完成', desc: r.message || '如新终端中仍不可用，请重启终端或应用。', body: r.output ? `<div class="log-view" style="max-height:260px">${esc(String(r.output).slice(-3000))}</div>` : '', okText: '关闭', showCancel: false });
      }
      await UI.loadCompilers();
    } finally { restore(); }
  });

  action('compiler-verify', async (btn) => {
    const id = btn.dataset.id;
    const r = await call('compilers.verify', { id, scope: state.compilerScope });
    toast(r.ok ? `${id}：${r.version}` : `${id}：未检测到可用版本`, r.ok ? 'ok' : 'err');
  });

  action('compiler-site', (btn) => {
    const item = (state.compilers || []).find((c) => c.id === btn.dataset.id);
    if (item && item.website) call('shell.openExternal', { url: item.website }).catch((e) => toast(e.message, 'err'));
  });

  action('apps-tab', (btn) => { state.appTab = btn.dataset.tab; UI.render(); });

  action('android-choose', async (btn) => {
    const restore = setBusy(btn, true, '读取中…');
    try {
      const apk = await call('android.chooseApk');
      if (!apk) return;
      const ok = await modal({
        title: '安装 Android 应用', desc: `即将把 ${apk.name} 安装到已连接的设备。`,
        body: `<div class="kv"><span>应用</span><b>${esc(apk.label || apk.name)}</b></div><div class="kv"><span>包名</span><b class="mono">${esc(apk.packageName || '未知')}</b></div><div class="kv"><span>版本</span><b>${esc(apk.version || '未知')}</b></div><div class="kv"><span>大小</span><b>${fmtBytes(apk.size)}</b></div><div class="notice warn mt"><span class="ico">${icon('alert', 16)}</span><div>只安装你信任的 APK。侧载应用拥有其声明的全部权限。</div></div>`,
        okText: '安装到设备',
      });
      if (!ok) return;
      const r = await call('android.installApk', { path: apk.path, grant: false });
      toast(r.message || 'APK 安装完成', 'ok');
      state.androidLoaded = false;
    } finally { restore(); }
  });

  action('android-adb-start', async () => { const r = await call('android.startAdb'); toast(r.ok ? 'adb 服务已启动' : (r.output || '启动失败'), r.ok ? 'ok' : 'err'); state.androidLoaded = false; UI.render(); });
  action('android-emulator', async (btn) => { const restore = setBusy(btn, true, '启动中…'); try { const r = await call('android.emulator'); toast(r.message || '模拟器启动中', 'ok'); } finally { restore(); } });
  action('android-studio', async (btn) => { const ok = await modal({ title: '安装 Android Studio', desc: '将通过 winget 下载并安装 Android Studio（约 1 GB），用于创建模拟器和管理 SDK。', okText: '开始安装' }); if (!ok) return; const restore = setBusy(btn, true, '安装中…'); try { const r = await call('android.installStudio'); toast(r.message || '安装完成', 'ok'); } finally { restore(); } });
  action('android-wsa', async () => { const r = await call('android.wsa'); toast(r.installed ? 'Windows Subsystem for Android 已安装' : (r.message || '未安装 WSA'), r.installed ? 'ok' : 'err'); });
  action('apps-refresh', async () => { state.androidLoaded = false; UI.render(); });

  action('open-winlator', async () => { await call('shell.openExternal', { url: 'https://github.com/brunodev85/winlator' }); toast('已打开 Winlator 项目页；请从 Releases 下载并安装', 'ok'); });

  action('check-root', async () => {
    if (window.Molv.isAndroid) {
      try {
        const r = await call('android.root');
        await modal({ title: 'root 状态', desc: r.rooted ? '已获得 root 权限，可以使用 chroot 安装 Linux 环境。' : '未检测到 root。非 root 设备可使用 Termux 作为兼容路径。', body: r.detail ? `<div class="log-view">${esc(r.detail)}</div>` : '', okText: '关闭', showCancel: false });
      } catch (err) { toast(err.message, 'err'); }
    } else {
      const admin = state.boot && state.boot.app && state.boot.app.admin;
      await modal({ title: '权限状态', desc: admin ? '当前以管理员身份运行。' : '当前为普通权限。安装 WSL2 与制作启动盘时需要管理员权限。', okText: '关闭', showCancel: false });
    }
  });

  action('android-grant', async () => {
    if (!window.Molv.isAndroid) return toast('该操作仅在 Android 端可用', 'err');
    try { const r = await call('android.permissions'); toast(r.message || '已打开权限设置', 'ok'); } catch (err) { toast(err.message, 'err'); }
  });

  action('task-refresh', () => { UI.loadTasks(); toast('已刷新进程列表', 'ok'); });
  action('task-monitor', async () => { try { const r = await call('tasks.openMonitor'); if (r && r.ok === false) toast(r.error || '未找到系统监视器', 'err'); } catch (e) { toast(e.message, 'err'); } });
  action('task-kill', async (btn) => {
    const pid = btn.dataset.pid; const name = btn.dataset.name;
    const ok = await modal({ title: '结束进程', desc: `确定结束 ${name}（PID ${pid}）吗？未保存的数据可能丢失。`, body: `<div class="notice danger"><span class="ico">${icon('alert', 16)}</span><div>该操作会向进程发送强制终止信号。系统关键进程会受到保护。</div></div>`, okText: '结束进程', danger: true });
    if (!ok) return;
    try { const r = await call('tasks.kill', { pid: Number(pid), confirmed: true }); toast(r.message || '已发送终止请求', r.ok ? 'ok' : 'err'); UI.loadTasks(); } catch (e) { toast(e.message, 'err'); }
  });

  action('quick-scan', async () => {
    try {
      const [roots, policy] = await Promise.all([call('scan.roots'), call('scan.policy')]);
      const home = roots.find((r) => r.type === 'home') || roots[0];
      state.scan = { roots, policy, selected: home ? [home.path] : [], results: [], running: false };
      UI.navigate('scan');
      setTimeout(() => { action('scan-start')(document.querySelector('[data-action="scan-start"]')); }, 250);
    } catch (e) { toast(e.message, 'err'); }
  });

  action('scan-start', async (btn) => {
    const selected = (state.scan && state.scan.selected) || [];
    if (!selected.length) return toast('请先选择扫描范围', 'err');
    const restore = setBusy(btn, true, '启动中…');
    try {
      const r = await call('scan.start', { roots: selected, policy: state.scan.policy });
      state.scan.running = Boolean(r && r.results === undefined);
      state.scan.id = r.id;
      if (r && Array.isArray(r.results)) {
        state.scan.results = r.results;
        state.scan.running = false;
      }
      UI.render();
      toast(r && r.results ? `扫描完成：${r.results.length} 项命中` : '扫描已开始，可随时停止', 'ok');
    } finally { restore(); }
  });

  action('scan-cancel', async () => { try { await call('scan.cancel', {}); state.scan.running = false; toast('已请求停止扫描', 'ok'); } catch (e) { toast(e.message, 'err'); } });

  action('scan-root', (btn) => {
    if (!state.scan) return;
    const p = btn.dataset.path;
    const set = new Set(state.scan.selected || []);
    if (set.has(p)) set.delete(p); else set.add(p);
    state.scan.selected = Array.from(set);
    btn.classList.toggle('on', set.has(p));
    const count = document.querySelector('.card-title .right'); // not reliable; leave
  });

  action('scan-add-root', async () => {
    const r = await call('dialog.chooseFolder', { title: '选择要扫描的文件夹' });
    if (!r || r.canceled) return;
    state.scan.roots = [...(state.scan.roots || []), { path: r.path, label: '自定义目录', type: 'custom' }];
    state.scan.selected = Array.from(new Set([...(state.scan.selected || []), r.path]));
    UI.render();
  });

  action('scan-select-home', () => {
    const home = (state.scan.roots || []).find((r) => r.type === 'home');
    if (home) { state.scan.selected = [home.path]; UI.render(); }
  });
  action('scan-select-all', () => { state.scan.selected = (state.scan.roots || []).map((r) => r.path); UI.render(); });
  action('scan-clear', () => { state.scan.selected = []; UI.render(); });

  action('scan-policy-save', async () => {
    const val = (id) => (document.querySelector(id) || {}).value || '';
    const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const policy = {
      extensions: list(val('#policyExt')),
      sensitiveExtensions: list(val('#policySensitive')),
      names: list(val('#policyNames')),
      contentKeywords: list(val('#policyContent')),
      largeFileMB: Number(val('#policyLarge')) || 512,
      maxResults: Number(val('#policyMax')) || 2000,
    };
    const saved = await call('scan.policy.set', { policy });
    state.scan.policy = saved;
    toast('扫描策略已保存', 'ok');
  });

  action('scan-export', async () => { try { const r = await call('scan.report'); toast(`报告已导出：${r.file}`, 'ok'); } catch (e) { toast(e.message, 'err'); } });

  action('scan-select-results', () => {
    const boxes = Array.from(document.querySelectorAll('[data-scan-path]'));
    const anyUnchecked = boxes.some((b) => !b.checked);
    boxes.forEach((b) => { b.checked = anyUnchecked; });
    const c = document.querySelector('#scanSelectedCount'); if (c) c.textContent = anyUnchecked ? `已选择 ${boxes.length} 项` : '未选择';
  });

  action('scan-quarantine', async () => {
    const paths = Array.from(document.querySelectorAll('[data-scan-path]:checked')).map((b) => b.dataset.scanPath);
    if (!paths.length) return toast('请先勾选要隔离的文件', 'err');
    const ok = await modal({ title: '隔离所选文件', desc: `将把 ${paths.length} 个文件移动到墨绿OS 隔离区（vault），不会直接删除。`, body: `<div class="notice warn"><span class="ico">${icon('alert', 16)}</span><div>请确认这些文件不是系统运行所必需的。隔离后应用可能无法启动，可在数据目录中恢复。</div></div>`, okText: '移动到隔离区', danger: true });
    if (!ok) return;
    try {
      const r = await call('scan.quarantine', { paths, confirmed: true });
      toast(`已隔离 ${r.count} 个文件，位置：${r.vault}`, r.ok ? 'ok' : 'err');
      if (state.scan) state.scan.results = (state.scan.results || []).filter((x) => !paths.includes(x.path));
      UI.render();
    } catch (e) { toast(e.message, 'err'); }
  });

  action('server-start', async (btn) => {
    const root = (document.querySelector('#serverRoot') || {}).value || '';
    const port = Number((document.querySelector('#serverPort') || {}).value || 8787);
    const bind = (document.querySelector('#serverBind') || {}).value || '0.0.0.0';
    const upnp = Boolean(state.config.server && state.config.server.upnp);
    if (!root) return toast('请先选择共享文件夹', 'err');
    const restore = setBusy(btn, true, '启动中…');
    try {
      const srv = await call('server.start', { root, port, bind, upnp });
      state.server = srv;
      if (srv.upnpResult && srv.upnpResult.ok === false) toast(`服务器已启动，但端口映射失败：${srv.upnpResult.error}`, 'err');
      else toast('服务器已启动', 'ok');
      UI.render();
    } finally { restore(); }
  });

  action('server-stop', async (btn) => {
    const restore = setBusy(btn, true, '停止中…');
    try { await call('server.stop'); state.server = { running: false }; toast('服务器已停止', 'ok'); UI.render(); } finally { restore(); }
  });

  action('server-open', async () => { try { await call('server.open'); } catch (e) { toast(e.message, 'err'); } });
  action('server-choose-root', async () => { const r = await call('server.chooseRoot'); if (r && r.path) { const input = document.querySelector('#serverRoot'); if (input) input.value = r.path; state.config.server = { ...(state.config.server || {}), root: r.path }; } });
  action('server-map', async (btn) => { const restore = setBusy(btn, true, '映射中…'); try { const r = await call('server.map', { port: Number((document.querySelector('#serverPort') || {}).value || 8787) }); toast(`端口映射成功：${r.externalPort}（${r.gateway || 'UPnP'}）`, 'ok'); await UI.refreshServer(); } catch (e) { toast(e.message, 'err'); } finally { restore(); } });
  action('server-upnp-toggle', async (btn) => { const next = !(state.config.server && state.config.server.upnp); await call('config.set', { key: 'server.upnp', value: next }); state.config.server = { ...(state.config.server || {}), upnp: next }; btn.classList.toggle('on', next); });

  action('github-test', async (btn) => { const restore = setBusy(btn, true, '测速中…'); try { const r = await call('github.test'); state.github = { ...(state.github || {}), ...r, lastTest: r }; toast(r.fastest ? `最快：${r.fastest.name}（${r.fastest.ms} ms）` : '所有镜像均不可用', r.fastest ? 'ok' : 'err'); UI.render(); } finally { restore(); } });
  action('github-refresh', async () => { state.github = null; UI.render(); });
  action('github-set', async (el) => { const r = await call('github.set', { mirror: el.dataset.mirror }); toast(`已切换到 ${r.name}`, 'ok'); state.github = null; UI.render(); });
  action('github-set-custom', async () => { const v = (document.querySelector('#githubCustom') || {}).value || ''; const r = await call('github.set', { mirror: 'custom', custom: v }); toast(`自定义镜像已保存：${r.prefix || '空'}`, 'ok'); state.github = null; UI.render(); });
  action('github-rewrite', async () => { const url = (document.querySelector('#githubUrl') || {}).value || ''; try { const r = await call('github.rewrite', { url }); const out = document.querySelector('#githubRewriteOut'); if (out) out.textContent = r.url; out.dataset.url = r.url; } catch (e) { toast(e.message, 'err'); } });
  action('github-copy-rewrite', () => { const out = document.querySelector('#githubRewriteOut'); if (out && out.dataset.url) UI.copyText(out.dataset.url); else toast('先生成加速链接', 'err'); });
  action('github-git-config', async (btn) => {
    const next = !(state.config.github && state.config.github.configureGit);
    try {
      const r = await call('github.gitConfig', { enabled: next });
      state.config.github = { ...(state.config.github || {}), configureGit: next };
      btn.classList.toggle('on', next);
      toast(r.message || 'Git 配置已更新', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  action('usb-refresh', async () => { state.usb = { ...(state.usb || {}), disks: null }; UI.render(); });
  action('usb-select', (el) => { state.usb = { ...(state.usb || {}), selectedDisk: Number(el.dataset.disk) }; UI.render(); });
  action('usb-choose-iso', async () => { const iso = await call('usb.chooseIso'); if (iso) { state.usb = { ...(state.usb || {}), iso }; UI.render(); } });
  action('usb-mode', (el) => { state.usb = { ...(state.usb || {}), mode: el.dataset.mode }; UI.render(); });
  action('usb-write', async (btn) => {
    const u = state.usb || {};
    const confirm = (document.querySelector('#usbConfirm') || {}).value || '';
    if (!u.selectedDisk || !u.iso) return toast('请选择磁盘和镜像', 'err');
    const expected = `ERASE ${u.selectedDisk}`;
    if (confirm !== expected) return toast(`请输入确认短语：${expected}`, 'err');
    const ok = await modal({ title: '最后确认：擦除磁盘', desc: `磁盘 ${u.selectedDisk} 上的所有数据将被永久擦除，并写入 ${u.iso.name}。`, body: `<div class="notice danger"><span class="ico">${icon('alert', 17)}</span><div>此操作不可撤销。请确认没有选择移动硬盘或系统盘。</div></div>`, okText: '我已知晓，开始写入', danger: true });
    if (!ok) return;
    const restore = setBusy(btn, true, '写入中…');
    try {
      const r = await call('usb.write', { diskNumber: u.selectedDisk, isoPath: u.iso.path, mode: u.mode || 'copy', confirm });
      toast(r.message || '写入完成', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { restore(); }
  });
  action('usb-cancel', async () => { const r = await call('usb.cancel'); toast(r.message || '已请求取消', 'ok'); });
  action('usb-docs', async () => { await modal({ title: '启动盘制作说明', desc: '请按顺序操作，避免选错磁盘。', body: `<div class="stack"><div><b>1. 备份</b><p class="hint">目标 U 盘中的所有分区与文件都会被清除。</p></div><div><b>2. 选择镜像</b><p class="hint">支持 .iso / .img。墨绿OS Live 镜像可由 GitHub Releases 获取。</p></div><div><b>3. 写入</b><p class="hint">RAW 模式使用物理磁盘直写；文件复制模式先格式化为 FAT32。</p></div><div><b>4. 启动</b><p class="hint">重启后在固件启动菜单中选择 USB；关闭 Secure Boot（如镜像未签名）。</p></div></div>`, okText: '关闭', showCancel: false }); });

  action('theme-set', async (el) => {
    const theme = el.dataset.theme;
    const map = {
      ink: { accent: '#54d6a4', accent2: '#8ff0c8', accent3: '#1f8a63' },
      pine: { accent: '#6fbf9b', accent2: '#b7e6cf', accent3: '#3f7f68' },
      deep: { accent: '#5bc8c2', accent2: '#a9f0ea', accent3: '#2c7f7a' },
    }[theme] || {};
    for (const [k, v] of Object.entries(map)) document.documentElement.style.setProperty(`--${k}`, v);
    await call('config.set', { key: 'theme', value: theme });
    state.config.theme = theme;
    toast('主题强调色已更新', 'ok');
  });

  action('settings-data-dir', async () => { await call('app.openDataDir'); });
  action('settings-export', async () => { const r = await call('config.export'); if (r && r.path) toast(`配置已导出：${r.path}`, 'ok'); });
  action('settings-import', async () => { const r = await call('config.import'); if (r && r.config) { await refreshBoot(); toast('配置已导入', 'ok'); UI.render(); } });
  action('settings-logs', async () => { const r = await call('logs.tail', { scope: 'main', lines: 200 }); await modal({ title: '运行日志', desc: '主进程最近 200 行日志', body: `<div class="log-view" style="max-height:440px">${esc(r.lines || '暂无日志')}</div>`, okText: '关闭', showCancel: false }); });
  action('settings-reset', async () => { const ok = await modal({ title: '重置配置', desc: '将恢复默认设置。Linux rootfs、隔离区与日志不会被删除。', okText: '重置', danger: true }); if (!ok) return; await call('config.reset', { confirmed: true }); await refreshBoot(); toast('配置已重置', 'ok'); UI.render(); });
  action('settings-autostart', async (btn) => { const next = !(state.config.autostart); try { const r = await call('app.autostart', { enabled: next }); state.config.autostart = next; btn.classList.toggle('on', next); toast(r.message || '开机自启已更新', 'ok'); } catch (e) { toast(e.message, 'err'); } });
  action('settings-tray', async (btn) => { const next = !state.config.minimizeToTray; await call('config.set', { key: 'minimizeToTray', value: next }); state.config.minimizeToTray = next; btn.classList.toggle('on', next); });

  action('about-docs', async () => { try { await call('app.openDocs'); } catch (e) { toast(e.message, 'err'); } });
  action('about-github', async () => { await call('shell.openExternal', { url: 'https://github.com/molvos/molv-os' }); });
})();
