'use strict';

(function () {
  const UI = window.MolvUI;
  const { state, esc, icon, fmtTime, statusPill, emptyState, pageHead, register, call } = UI;

  register('settings', {
    render() {
      const c = state.config || {};
      const app = (state.boot && state.boot.app) || {};
      const variants = (state.boot && state.boot.variants) || {};
      return `
        ${pageHead('PREFERENCES', '设置', '所有设置都会写入本地配置文件，并在下次启动时恢复。墨绿OS 默认不联网、不上传遥测。', `<button class="btn ghost" data-action="settings-data-dir">${icon('folder', 14)} 数据目录</button><button class="btn soft" data-action="settings-export">${icon('download', 14)} 导出配置</button>`)}
        <div class="grid grid-2">
          <div class="stack">
            <div class="card">
              <div class="card-title"><div class="ico">${icon('package')}</div><h3>安装包规格</h3></div>
              <div class="stack">${Object.entries(variants).map(([id, v]) => `<div class="variant ${c.variant === id ? 'active' : ''}" data-action="variant-select" data-variant="${id}"><div class="check">${icon('check', 10)}</div><div class="v-top"><b>${esc(v.name)}</b><span class="price">${esc(v.size)}</span></div><p>${esc(v.desc)}</p></div>`).join('') || emptyState('安装包信息未加载')}</div>
              <div class="hint mt">该选择会记录在配置中，并影响后续 Linux 环境安装的软件包集合。</div>
            </div>
            <div class="card">
              <div class="card-title"><div class="ico">${icon('layers')}</div><h3>外观与启动</h3></div>
              <div class="between" style="padding:8px 0"><div><b style="font-size:12px">主题</b><div class="tiny">墨绿是唯一主题；强调色可调整</div></div><div class="row"><button class="btn sm soft" data-action="theme-set" data-theme="ink">墨绿</button><button class="btn sm ghost" data-action="theme-set" data-theme="pine">松针</button><button class="btn sm ghost" data-action="theme-set" data-theme="deep">深海</button></div></div>
              <div class="between" style="padding:8px 0;border-top:1px solid var(--line-soft)"><div><b style="font-size:12px">开机自启</b><div class="tiny">登录系统后自动打开墨绿OS</div></div><button class="switch ${c.autostart ? 'on' : ''}" data-action="settings-autostart"></button></div>
              <div class="between" style="padding:8px 0;border-top:1px solid var(--line-soft)"><div><b style="font-size:12px">关闭窗口时最小化到托盘</b><div class="tiny">保留后台服务器与终端会话</div></div><button class="switch ${c.minimizeToTray ? 'on' : ''}" data-action="settings-tray"></button></div>
            </div>
          </div>
          <div class="stack">
            <div class="card">
              <div class="card-title"><div class="ico">${icon('database')}</div><h3>数据与持久化</h3></div>
              <div class="kv"><span>配置目录</span><b class="mono" style="font-size:10px">${esc(app.dataDir || '—')}</b></div>
              <div class="kv"><span>配置文件</span><b>config.json + config.json.bak</b></div>
              <div class="kv"><span>写入方式</span><b>临时文件 + 原子替换</b></div>
              <div class="kv"><span>日志</span><b>自动轮转，保留 3 份</b></div>
              <div class="kv"><span>扫描隔离区</span><b>数据目录 / vault</b></div>
              <div class="btn-row mt"><button class="btn sm ghost" data-action="settings-import">${icon('download', 14)} 导入配置</button><button class="btn sm ghost" data-action="settings-logs">${icon('file', 14)} 查看日志</button><button class="btn sm ghost" data-action="settings-data-dir">${icon('folder', 14)} 打开目录</button></div>
            </div>
            <div class="card">
              <div class="card-title"><div class="ico">${icon('shield')}</div><h3>安全</h3></div>
              <div class="between" style="padding:8px 0"><div><b style="font-size:12px">破坏性操作二次确认</b><div class="tiny">启动盘写入、进程结束、隔离文件</div></div><span class="pill ok"><i></i>始终开启</span></div>
              <div class="between" style="padding:8px 0;border-top:1px solid var(--line-soft)"><div><b style="font-size:12px">隔离而不是删除</b><div class="tiny">扫描命中文件移动到 vault，可人工恢复</div></div><span class="pill ok"><i></i>开启</span></div>
              <div class="between" style="padding:8px 0;border-top:1px solid var(--line-soft)"><div><b style="font-size:12px">权限最小化</b><div class="tiny">不申请相机、麦克风、定位</div></div><span class="pill ok"><i></i>开启</span></div>
              <div class="notice warn mt"><span class="ico">${icon('alert', 16)}</span><div>重置会清空配置，但不会删除 Linux rootfs、隔离区或日志。需要彻底清理时请手动打开数据目录。</div></div>
              <div class="btn-row mt"><button class="btn danger" data-action="settings-reset">${icon('trash', 14)} 重置配置</button></div>
            </div>
          </div>
        </div>
        <div class="card mt">
          <div class="card-title"><div class="ico">${icon('info')}</div><h3>当前状态</h3></div>
          <div class="grid grid-4">
            <div><div class="tiny">版本</div><b>v${esc(app.version || '0.1.0')}</b></div>
            <div><div class="tiny">平台</div><b>${esc(app.platform || '—')} / ${esc(app.arch || '—')}</b></div>
            <div><div class="tiny">安装形态</div><b>${app.packaged ? '已打包' : '开发模式'}</b></div>
            <div><div class="tiny">首次运行</div><b>${state.config.firstRun ? '是' : '否'}</b></div>
          </div>
        </div>`;
    },
    mount() {},
  });

  register('about', {
    render() {
      const app = (state.boot && state.boot.app) || {};
      const integrity = (state.boot && state.boot.integrity) || {};
      const integrityLabel = integrity.ok ? '校验通过' : integrity.state === 'missing-manifest' ? '开发模式（无清单）' : integrity.state === 'damaged' ? '文件异常' : '未校验';
      return `
        ${pageHead('ABOUT', '关于墨绿OS', '一个以墨绿为视觉语言的跨平台开发工作台。它不是从零编写的 Linux 内核或发行版，而是把已有的运行时、工具链与安全边界组织成一个更安静的产品。', `<button class="btn ghost" data-action="about-docs">${icon('book', 14)} 使用说明书</button><button class="btn soft" data-action="about-github">${icon('github', 14)} GitHub</button>`)}
        <div class="card hero">
          <div class="grid grid-2" style="align-items:center">
            <div><div class="about-logo">墨</div><h1 style="font-size:30px;margin:18px 0 6px">墨绿OS <span style="font-size:16px;color:var(--muted);font-weight:400">MolvOS</span></h1><p class="lede">把 Linux、编译环境与常用工具，收进一个安静的工作台。</p><div class="btn-row mt"><span class="pill ok"><i></i>v${esc(app.version || '0.1.0')}</span><span class="pill info"><i></i>MIT License</span><span class="pill"><i></i>${esc(app.platform || '—')} / ${esc(app.arch || '—')}</span></div></div>
            <div><div class="kv"><span>完整性</span><b>${esc(integrityLabel)}</b></div><div class="kv"><span>校验文件</span><b>${integrity.checked || 0} / ${integrity.total || 0}</b></div><div class="kv"><span>生成时间</span><b>${esc(fmtTime(integrity.generatedAt))}</b></div><div class="kv"><span>Electron</span><b>${esc(app.electron || (window.Molv.versions && window.Molv.versions.electron) || '—')}</b></div></div>
          </div>
        </div>
        <div class="grid grid-2 mt">
          <div class="card">
            <div class="card-title"><div class="ico">${icon('book')}</div><h3>设计原则</h3></div>
            <div class="stack">
              <div><b style="font-size:12px">安静</b><p class="hint">默认不打扰。没有弹窗广告，没有后台挖矿，没有未经同意的安装。</p></div>
              <div><b style="font-size:12px">可解释</b><p class="hint">每个“一键”操作都展示将要做的事、影响范围与失败原因。</p></div>
              <div><b style="font-size:12px">可恢复</b><p class="hint">配置有备份，扫描文件进隔离区，启动盘写入必须输入确认短语。</p></div>
              <div><b style="font-size:12px">不假装</b><p class="hint">Android 不能原生运行 .exe，Windows 不能原生运行 APK；我们明确说明依赖的运行时，而不是承诺魔法。</p></div>
            </div>
          </div>
          <div class="card">
            <div class="card-title"><div class="ico">${icon('layers')}</div><h3>技术组成</h3></div>
            <div class="credits">
              <div><b>Electron</b> 桌面壳</div><div><b>Node.js</b> 本地服务</div><div><b>xterm.js</b> 终端</div><div><b>Alpine Linux</b> minirootfs</div><div><b>WSL2</b> Windows 运行时</div><div><b>proot / chroot</b> Android 隔离</div><div><b>UPnP</b> 端口映射</div><div><b>Winlator / Wine</b> Windows 兼容层</div><div><b>MIT License</b> 开源许可</div>
            </div>
            <div class="notice warn mt"><span class="ico">${icon('alert', 16)}</span><div>本项目的“墨绿OS Live”是基于 Alpine Linux 的定制 Live 环境，不包含自研内核。桌面应用与 Android 应用共享同一套界面与配置模型，但各平台能力由本地服务实现。</div></div>
          </div>
        </div>
        <div class="card mt">
          <div class="card-title"><div class="ico">${icon('info')}</div><h3>免责声明</h3></div>
          <div class="hint" style="line-height:1.9">墨绿OS 按“现状”提供，不承诺适销性或特定用途适用性。安装第三方软件、启用 root、制作启动盘、向公网暴露文件服务器均可能造成数据丢失或安全风险，请自行评估并备份。合规扫描仅基于本地规则匹配，不构成法律意见。GitHub 加速依赖第三方社区镜像，墨绿OS 不对其可用性、隐私或安全性负责。Windows / Android / Linux 是其各自权利人的商标，本项目与 Microsoft、Google、Linux 基金会无隶属关系。</div>
        </div>`;
    },
    mount() {},
  });
})();
