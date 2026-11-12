'use strict';

/**
 * 使用 isomorphic-git 初始化本地仓库并提交源码（不需要系统安装 git）。
 * 不会自动推送；推送需要你自己的 GitHub 凭据。
 */

const fs = require('fs');
const path = require('path');
const git = require('isomorphic-git');

const root = path.resolve(__dirname, '..');

const SKIP = new Set([
  '.git', 'node_modules', 'dist', '.sdk', '.electron-win', '.electron-linux',
  '.userdata', '.molv-data', 'android/build', 'tmp',
]);
const SKIP_FILE = /(^|\/)(integrity\.json|boot\.log|.*\.log|.*\.zip|.*\.7z|.*\.deb|.*\.tar\.gz)$/i;

function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (SKIP_FILE.test(r)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, r));
    else if (entry.isFile()) out.push(r);
  }
  return out;
}

(async () => {
  await git.init({ fs, dir: root, defaultBranch: 'main' });
  const files = walk(root).filter((f) => !f.startsWith('docs/assets/') || /\.png$/i.test(f));
  for (const filepath of files) {
    await git.add({ fs, dir: root, filepath });
  }
  const sha = await git.commit({
    fs,
    dir: root,
    message: '墨绿OS 0.1.0 青岚：跨平台工作台、Linux 环境与编译工具链',
    author: { name: 'MolvOS Contributors', email: 'hello@molv.os' },
  });
  console.log(`git: ${files.length} files, commit ${sha.slice(0, 12)}`);
  console.log('push: git remote add origin <your-repo> && git push -u origin main');
})();
