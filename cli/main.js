#!/usr/bin/env node
'use strict';

/**
 * molv — 墨绿OS 命令行工具
 * 用法：molv <status|doctor|scan|serve|usb|github|linux|version>
 */

const fs = require('fs');
const path = require('path');
const { Store } = require('../src/main/core/store');
const { dirs } = require('../src/main/core/paths');

const VERSION = '0.1.0';
const args = process.argv.slice(2);
const cmd = args[0] || 'help';

function out(s = '') { process.stdout.write(`${s}\n`); }
function json(v) { out(JSON.stringify(v, null, 2)); }

async function status() {
  const store = new Store();
  const platform = require('../src/main/core/platform');
  const { LinuxManager } = require('../src/main/core/linux');
  const linux = await new LinuxManager(store).status();
  const cfg = store.get();
  out('');
  out('  墨绿OS · MolvOS  ' + VERSION);
  out('  ─────────────────────────────');
  out(`  平台       ${process.platform} / ${process.arch}`);
  out(`  数据目录   ${dirs().base}`);
  out(`  安装规格   ${cfg.variant}`);
  out(`  Linux      ${linux.installed ? (linux.method + ' · ' + (linux.version || 'ready')) : '未安装'}`);
  out(`  虚拟化     ${linux.message}`);
  out(`  完整性     ${cfg.setup && cfg.setup.integrity || '未检查'}`);
  out(`  编译作用域 ${cfg.compilers && cfg.compilers.scope || 'device'}`);
  out('');
}

async function doctor() {
  const platform = require('../src/main/core/platform');
  const { verify } = require('../src/main/core/integrity');
  const [perms, virt, integ] = await Promise.all([platform.permissions(), platform.virtualization(), verify()]);
  out('\n  权限与环境');
  out('  ─────────────────────────────');
  for (const i of perms.items || []) out(`  [${i.level === 'ok' ? 'OK' : i.level === 'missing' ? '!!' : '--'}] ${i.label}: ${i.detail}`);
  out(`\n  虚拟化: ${virt.detail}`);
  out(`  完整性: ${integ.ok ? '通过' : '异常'} (${integ.checked}/${integ.total})`);
  out('');
}

async function scan() {
  const target = args[1] ? path.resolve(args[1]) : process.cwd();
  if (!fs.existsSync(target)) { out(`路径不存在：${target}`); process.exitCode = 2; return; }
  const { Scanner } = require('../src/main/core/scanner');
  const scanner = new Scanner(new Store());
  let last = 0;
  scanner.on('progress', (p) => {
    if (Date.now() - last > 800) { last = Date.now(); process.stdout.write(`\r  扫描 ${p.files} 个文件，命中 ${p.matched}…`); }
  });
  const done = new Promise((resolve) => scanner.once('done', resolve));
  await scanner.start({ roots: [target] });
  const r = await done;
  out(`\n  完成：${r.files} 个文件，命中 ${r.matched}，错误 ${r.errors}`);
  for (const hit of (r.results || []).slice(0, 30)) out(`  [${hit.level}] ${hit.path}  ← ${hit.reasons.join(' / ')}`);
  if ((r.results || []).length > 30) out(`  … 其余 ${r.results.length - 30} 项请使用 GUI 导出报告`);
  out('');
}

async function serve() {
  const root = path.resolve(args[1] || process.cwd());
  const portIndex = args.indexOf('--port');
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8787;
  const { StaticServer } = require('../src/main/core/server');
  const server = new StaticServer(new Store());
  const s = await server.start({ root, port, bind: '0.0.0.0', upnp: false });
  out(`\n  墨绿OS 文件服务器已启动\n  ${s.urls.join('\n  ')}\n  Ctrl+C 停止\n`);
  process.on('SIGINT', async () => { await server.stop(); process.exit(0); });
}

async function usb() {
  if (process.platform !== 'win32') { out('启动盘写入的图形界面仅支持 Windows；Linux 可使用 dd。'); return; }
  const { UsbWriter } = require('../src/main/core/usb');
  const disks = await new UsbWriter(new Store()).listDisks();
  if (!disks.length) { out('未检测到磁盘。'); return; }
  out('\n  #   名称                              容量        类型      可写');
  out('  ────────────────────────────────────────────────────────────────');
  for (const d of disks) out(`  ${String(d.number).padEnd(3)} ${String(d.name).slice(0, 32).padEnd(34)} ${String(d.sizeText).padEnd(10)} ${String(d.bus).padEnd(8)} ${d.safe && d.removable ? '是' : '否'}`);
  out('');
}

async function github() {
  const { GithubAccelerator } = require('../src/main/core/github');
  const gh = new GithubAccelerator(new Store());
  if (args[1] === 'test') {
    out('  正在测速…');
    const r = await gh.testAll();
    for (const x of r.results) out(`  ${x.ok ? 'OK ' : 'ERR'} ${x.name.padEnd(12)} ${String(x.ms).padStart(6)} ms  ${x.error || ''}`);
    out(`\n  最快：${r.fastest ? r.fastest.name : '无'}`);
  } else {
    out(`当前镜像：${gh.active().name} (${gh.active().prefix || '直连'})`);
  }
}

async function linux() {
  const { LinuxManager } = require('../src/main/core/linux');
  const lm = new LinuxManager(new Store());
  if (args[1] === 'install') {
    const r = await lm.install({ variant: 'slim' });
    json(r);
  } else {
    json(await lm.status());
  }
}

function help() {
  out(`
  墨绿OS · MolvOS ${VERSION}

  molv status              查看工作台状态
  molv doctor              检查权限、虚拟化、完整性
  molv scan [目录]          合规扫描（本地规则）
  molv serve [目录] --port 8787
                           启动只读文件服务器
  molv usb                 列出磁盘（Windows）
  molv github [test]       GitHub 加速状态 / 测速
  molv linux [install]     Linux 环境状态 / 安装
  molv version             版本

  GUI：在应用内打开，或运行 MolvOS 桌面程序。
`);
}

(async () => {
  try {
    switch (cmd) {
      case 'status': await status(); break;
      case 'doctor': await doctor(); break;
      case 'scan': await scan(); break;
      case 'serve': await serve(); break;
      case 'usb': await usb(); break;
      case 'github': await github(); break;
      case 'linux': await linux(); break;
      case 'version': case '--version': case '-v': out(VERSION); break;
      default: help();
    }
  } catch (err) {
    process.stderr.write(`\n  错误：${err.message}\n`);
    process.exitCode = 1;
  }
})();
