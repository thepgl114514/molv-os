'use strict';

const fs = require('fs');
const path = require('path');
const { tarGz } = require('./tar');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const src = path.join(dist, 'linux-unpacked');
const work = path.join(dist, 'deb-build');
const stage = path.join(work, 'data');
const controlDir = path.join(work, 'control');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const out = path.join(dist, `molv-os_${pkg.version}_amd64.deb`);

if (!fs.existsSync(path.join(src, 'molv-os'))) {
  throw new Error('dist/linux-unpacked 不存在，请先构建 Linux 包');
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'opt'), { recursive: true });
fs.mkdirSync(path.join(stage, 'usr', 'bin'), { recursive: true });
fs.mkdirSync(path.join(stage, 'usr', 'share', 'applications'), { recursive: true });
fs.mkdirSync(path.join(stage, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps'), { recursive: true });
fs.mkdirSync(controlDir, { recursive: true });
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(stage, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps', 'molv-os.png'));

fs.cpSync(src, path.join(stage, 'opt', 'MolvOS'), { recursive: true });

const launcher = `#!/bin/sh
exec /opt/MolvOS/molv-os "$@"
`;
fs.writeFileSync(path.join(stage, 'usr', 'bin', 'molv-os'), launcher, { mode: 0o755 });

fs.writeFileSync(path.join(stage, 'usr', 'share', 'applications', 'molv-os.desktop'), `[Desktop Entry]
Name=墨绿OS
Name[en]=MolvOS
Comment=Cross-platform Linux workspace
Comment[zh_CN]=跨平台 Linux 工作台
Exec=/opt/MolvOS/molv-os
Icon=molv-os
Terminal=false
Type=Application
Categories=Development;Utility;
StartupWMClass=MolvOS
`, 'utf8');

const installedSize = (() => {
  let total = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) total += fs.statSync(f).size;
    }
  };
  walk(stage);
  return Math.ceil(total / 1024);
})();

const control = `Package: molv-os
Version: ${pkg.version}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: MolvOS Contributors <hello@molv.os>
Installed-Size: ${installedSize}
Depends: libgtk-3-0, libnss3, libasound2, libgbm1, libx11-xcb1
Recommends: xdg-utils
Homepage: https://github.com/molvos/molv-os
Description: MolvOS cross-platform Linux workspace
 墨绿OS 是一个跨平台工作台，提供 Linux 环境、编译工具链、
 任务管理器、合规扫描、只读文件服务器与启动盘制作器。
 本包为桌面端 Electron 应用；Linux 运行时使用系统原生 shell。
`;
fs.writeFileSync(path.join(controlDir, 'control'), control, 'utf8');

const postinst = `#!/bin/sh
set -e
if [ -f /opt/MolvOS/chrome-sandbox ]; then
  chmod 4755 /opt/MolvOS/chrome-sandbox || true
fi
exit 0
`;
fs.writeFileSync(path.join(controlDir, 'postinst'), postinst, { mode: 0o755 });

function packTar(source, outFile) {
  tarGz(source, outFile, {
    executable: (rel) => rel === 'opt/MolvOS/molv-os' || rel === 'usr/bin/molv-os' || rel.endsWith('.sh') || rel.endsWith('postinst'),
  });
}

packTar(controlDir, path.join(work, 'control.tar.gz'));
packTar(stage, path.join(work, 'data.tar.gz'));

function arMember(name, file) {
  const data = fs.readFileSync(file);
  const header = Buffer.alloc(60, 0x20);
  const put = (s, off, len) => { Buffer.from(s).copy(header, off, 0, Math.min(Buffer.byteLength(s), len)); };
  put(name, 0, 16);
  put(String(Math.floor(Date.now() / 1000)), 16, 12);
  put('0', 28, 6);
  put('0', 34, 6);
  put('100644', 40, 8);
  put(String(data.length), 48, 10);
  header.write('`\n', 58, 2, 'ascii');
  return Buffer.concat([header, data, data.length % 2 ? Buffer.from('\n') : Buffer.alloc(0)]);
}

const deb = Buffer.concat([
  Buffer.from('!<arch>\n', 'ascii'),
  arMember('debian-binary', (() => {
    const f = path.join(work, 'debian-binary');
    fs.writeFileSync(f, '2.0\n');
    return f;
  })()),
  arMember('control.tar.gz', path.join(work, 'control.tar.gz')),
  arMember('data.tar.gz', path.join(work, 'data.tar.gz')),
]);
fs.writeFileSync(out, deb);
console.log(`deb: ${out} (${(deb.length / 1024 / 1024).toFixed(1)} MB, installed ${installedSize} KB)`);
