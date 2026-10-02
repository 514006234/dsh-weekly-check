/**
 * 用 GitHub API 推送（github.com:443 连不上时的兜底）。
 *
 * 为什么需要：本机网络下 `github.com` 常常连不上（git push 报
 * "Failed to connect to github.com:443"），但 `api.github.com` 一直通。
 * 这个脚本用 Git Data API（blobs → tree → commit → 更新 ref）把本地 HEAD
 * 相对远端分支的差异推上去，效果等同于一次 git push（同样产生一个真实提交）。
 *
 * 用法：
 *   node tools/gh-push.mjs                       # 推到 origin 的 main
 *   node tools/gh-push.mjs --dry-run             # 只列出会改哪些文件
 *   node tools/gh-push.mjs --branch main --message "..." --repo owner/name
 *
 * 密钥：从 D:\DClaw\.env 读 GITHUB_TOKEN（唯一存放点，只在内存里用，绝不打印）。
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ENV_FILE = 'D:\\DClaw\\.env';
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

function loadToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const raw = readFileSync(ENV_FILE, 'utf8');
  const m = raw.match(/^\s*GITHUB_TOKEN\s*=\s*(.*)$/m);
  if (!m) throw new Error(ENV_FILE + ' 里没有 GITHUB_TOKEN');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

function git(gitArgs, opts = {}) {
  const r = spawnSync('git', gitArgs, { maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    throw new Error('git ' + gitArgs.join(' ') + ' 失败：' + String(r.stderr || '').slice(0, 400));
  }
  return opts.encoding === 'buffer' ? r.stdout : String(r.stdout).trim();
}

function repoFromRemote() {
  const url = git(['remote', 'get-url', 'origin']);
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
  if (!m) throw new Error('无法从 origin 解析仓库：' + url);
  return m[1];
}

const token = loadToken();
const REPO = val('--repo', repoFromRemote());
const BRANCH = val('--branch', 'main');
const DRY = has('--dry-run');
const H = {
  authorization: 'Bearer ' + token,
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-gh-push',
  'content-type': 'application/json',
};

async function api(path, init) {
  const res = await fetch('https://api.github.com' + path, { ...init, headers: { ...H, ...(init && init.headers) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path + '：' + JSON.stringify(body).slice(0, 400));
  return body;
}

const localHead = git(['rev-parse', 'HEAD']);
const ref = await api(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
const remoteSha = ref.object.sha;

console.log('仓库 ' + REPO + ' 分支 ' + BRANCH);
console.log('  远端 ' + remoteSha.slice(0, 10));
console.log('  本地 ' + localHead.slice(0, 10));

if (remoteSha === localHead) {
  console.log('已是最新，无需推送');
  process.exit(0);
}

// 差异基线：默认用远端 HEAD；若远端有本地没有的提交（CI 提交过归档），
// 就用 --since 指定的、本地确实有的那个公共提交来算差异，
// 再把差异叠加到远端当前的树上——这样不会把别人（CI）的提交冲掉。
let since = val('--since', remoteSha);
if (since !== remoteSha) {
  console.log('  差异基线（--since）' + since.slice(0, 10));
}
const sinceIsAncestor = spawnSync('git', ['merge-base', '--is-ancestor', since, localHead]).status === 0;
if (!sinceIsAncestor) {
  throw new Error('基线 ' + since.slice(0, 10) + ' 不是本地 HEAD 的祖先，无法安全计算差异');
}
if (since === remoteSha) {
  const anc = spawnSync('git', ['merge-base', '--is-ancestor', remoteSha, localHead]);
  if (anc.status !== 0) {
    throw new Error('远端 ' + remoteSha.slice(0, 10) + ' 不是本地 HEAD 的祖先——请加 --since <共同祖先>（例如上一次成功推送的提交）');
  }
}

// -z：路径按 NUL 分隔且不做引号转义，中文路径也安全
const rawDiff = git(['diff', '--name-status', '-z', since, localHead], { encoding: 'buffer' });
const toks = String(rawDiff).split('\0').filter((s) => s !== '');
const changes = [];
for (let i = 0; i < toks.length;) {
  const status = toks[i]; i += 1;
  if (status[0] === 'R' || status[0] === 'C') {
    const from = toks[i]; const to = toks[i + 1]; i += 2;
    changes.push({ status: 'D', path: from });
    if (status[0] === 'R') changes.push({ status: 'A', path: to });
  } else {
    changes.push({ status: status[0], path: toks[i] }); i += 1;
  }
}

console.log('  待推送文件 ' + changes.length + ' 个：');
for (const c of changes) console.log('    ' + c.status + '  ' + c.path);
if (DRY) {
  console.log('（--dry-run，未推送）');
  process.exit(0);
}

const remoteCommit = await api(`/repos/${REPO}/git/commits/${remoteSha}`);
const tree = [];
for (const c of changes) {
  if (c.status === 'D') {
    tree.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
    continue;
  }
  const buf = spawnSync('git', ['cat-file', 'blob', 'HEAD:' + c.path], { maxBuffer: 128 * 1024 * 1024 }).stdout;
  const blob = await api(`/repos/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: Buffer.from(buf).toString('base64'), encoding: 'base64' }),
  });
  tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
  console.log('    已上传 blob ' + c.path + '（' + Buffer.from(buf).length + ' 字节）');
}

const message = val('--message', git(['log', '-1', '--pretty=%B', localHead]));
const newTree = await api(`/repos/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ base_tree: remoteCommit.tree.sha, tree }),
});

const name = (() => { try { return git(['config', 'user.name']) || 'dsh-agent'; } catch { return 'dsh-agent'; } })();
const email = (() => { try { return git(['config', 'user.email']) || 'agent@local'; } catch { return 'agent@local'; } })();
const date = new Date().toISOString();

const commit = await api(`/repos/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message,
    tree: newTree.sha,
    parents: [remoteSha],
    author: { name, email, date },
    committer: { name, email, date },
  }),
});

await api(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha, force: false }),
});

// 只有本地确实有这个提交对象时才移动本地 ref。
// 否则（API 提交的父提交是本地没有的 CI 提交）update-ref 会把分支指向一个不存在的对象，
// 整个本地仓库会直接坏掉——所以这里必须先探一下对象在不在。
const hasObj = spawnSync('git', ['cat-file', '-e', commit.sha + '^{commit}']);
if (hasObj.status === 0) {
  spawnSync('git', ['update-ref', 'refs/heads/' + BRANCH, commit.sha]);
  console.log('  本地 ref 已对齐到该提交');
} else {
  console.log('  （本地没有这个提交对象，保持本地 ref 不动；下次 git fetch 后正常 rebase 即可）');
}

console.log('✓ 已推送 ' + commit.sha.slice(0, 10) + ' → ' + BRANCH);
console.log('  https://github.com/' + REPO + '/commit/' + commit.sha);
