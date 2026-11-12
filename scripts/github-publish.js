'use strict';

/**
 * Publish the source tree to GitHub using the GitHub REST API.
 * Token is read from GITHUB_TOKEN and is never printed.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/github-publish.js [owner] [repo]
 */

const fs = require('fs');
const path = require('path');

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

const owner = process.argv[2] || 'thepgl114514';
const repo = process.argv[3] || 'molv-os';
const root = path.resolve(__dirname, '..');
const apiBase = 'https://api.github.com';
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'MolvOS-Publisher',
  'Content-Type': 'application/json',
};

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', '.sdk', '.electron-win', '.electron-linux',
  '.userdata', '.molv-data', 'android/build', 'tmp', 'tools',
]);
const SKIP_FILES = /(^|\/)(integrity\.json|boot\.log|.*\.log|.*\.zip|.*\.7z|.*\.deb|.*\.tar\.gz|.*\.exe|.*\.apk|.*\.idsig|.*\.keystore)$/i;
const EXECUTABLE = /(^|\/)(build-live\.sh|build-apk\.sh|molv|postinst)$/;

function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (SKIP_FILES.test(r)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, r));
    else if (entry.isFile()) out.push(r);
  }
  return out;
}

async function api(method, route, body) {
  const res = await fetch(`${apiBase}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}
  if (!res.ok) {
    const message = (data && data.message) || text.slice(0, 500);
    const err = new Error(`${method} ${route} -> ${res.status}: ${message}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function ensureRepo() {
  try {
    const existing = await api('GET', `/repos/${owner}/${repo}`);
    console.log(`repo exists: ${existing.html_url} (${existing.private ? 'private' : 'public'})`);
    return existing;
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  const created = await api('POST', '/user/repos', {
    name: repo,
    description: '墨绿OS · MolvOS — 跨平台 Linux 工作台、编译环境与应用中心',
    homepage: `https://github.com/${owner}/${repo}`,
    private: false,
    has_issues: true,
    has_wiki: false,
    auto_init: false,
  });
  console.log(`repo created: ${created.html_url}`);
  return created;
}

async function uploadBlobs(files) {
  const blobs = new Map();
  let cursor = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (cursor < files.length) {
      const i = cursor++;
      const rel = files[i];
      const content = fs.readFileSync(path.join(root, rel)).toString('base64');
      const blob = await api('POST', `/repos/${owner}/${repo}/git/blobs`, { content, encoding: 'base64' });
      blobs.set(rel, blob.sha);
      if ((i + 1) % 20 === 0 || i + 1 === files.length) console.log(`blobs ${i + 1}/${files.length}`);
    }
  });
  await Promise.all(workers);
  return blobs;
}

(async () => {
  const files = walk(root).sort();
  console.log(`source files: ${files.length}`);
  const repository = await ensureRepo();

  let parentSha = null;
  let baseTree = null;
  try {
    const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/main`);
    parentSha = ref.object.sha;
    const parent = await api('GET', `/repos/${owner}/${repo}/git/commits/${parentSha}`);
    baseTree = parent.tree.sha;
    console.log(`existing main: ${parentSha.slice(0, 12)}`);
  } catch (err) {
    if (err.status !== 404 && err.status !== 409) throw err;
    console.log('empty repository: creating initial commit');
  }

  const blobs = await uploadBlobs(files);
  const treeEntries = files.map((rel) => ({
    path: rel,
    mode: EXECUTABLE.test(rel) ? '100755' : '100644',
    type: 'blob',
    sha: blobs.get(rel),
  }));
  const tree = await api('POST', `/repos/${owner}/${repo}/git/trees`, {
    tree: treeEntries,
    ...(baseTree ? { base_tree: baseTree } : {}),
  });
  const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
    message: '墨绿OS 0.1.0 青岚：跨平台工作台、Linux 环境与编译工具链',
    tree: tree.sha,
    parents: parentSha ? [parentSha] : [],
    author: { name: 'MolvOS Contributors', email: 'hello@molv.os', date: new Date().toISOString() },
    committer: { name: 'MolvOS Contributors', email: 'hello@molv.os', date: new Date().toISOString() },
  });
  if (parentSha) {
    await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/main`, { sha: commit.sha, force: false });
  } else {
    await api('POST', `/repos/${owner}/${repo}/git/refs`, { ref: 'refs/heads/main', sha: commit.sha });
  }
  console.log(`commit: ${commit.sha}`);
  console.log(`repo: https://github.com/${owner}/${repo}`);
  console.log(`tree: https://github.com/${owner}/${repo}/tree/main`);
})().catch((err) => {
  console.error(`PUBLISH FAILED: ${err.message}`);
  if (err.data && err.data.documentation_url) console.error(err.data.documentation_url);
  process.exit(1);
});
