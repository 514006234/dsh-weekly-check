/**
 * 立刻重新发布 GitHub Pages（不用等到下周一）。
 *
 * 为什么需要：.github/workflows/weekly.yml 原来是「仅 cron + 手动」，改了 site/ 下的页面
 * 要等到下周一才会出现在线上。这个脚本用 GitHub API 触发一次 workflow_dispatch，
 * 然后轮询运行结果。现在 workflow 也加了 push 触发（paths: site/**），
 * 但改流水线文件本身、或想立刻重发一次时，还是用这个脚本。
 *
 * 密钥：从 D:\DClaw\.env 读 GITHUB_TOKEN（唯一存放点，只在内存里用，绝不打印）。
 * 用法：node tools/deploy-now.mjs [--watch]
 */
import { readFileSync } from 'node:fs';

const OWNER = '514006234';
const REPO = 'dsh-weekly-check';
const WORKFLOW = 'weekly.yml';
const ENV_FILE = 'D:\\DClaw\\.env';

function loadToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  let raw;
  try { raw = readFileSync(ENV_FILE, 'utf8'); } catch (err) {
    throw new Error('读不到 ' + ENV_FILE + '：' + err.message);
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*GITHUB_TOKEN\s*=\s*(.*)$/);
    if (m) {
      const v = m[1].trim().replace(/^["']|["']$/g, '');
      if (v) return v;
    }
  }
  throw new Error(ENV_FILE + ' 里没有 GITHUB_TOKEN');
}

const token = loadToken();
console.log('已从 ' + ENV_FILE + ' 读到 GITHUB_TOKEN（变量名与长度：GITHUB_TOKEN=' + token.length + '，值不回显）');

const H = {
  authorization: 'Bearer ' + token,
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-weekly-check-deploy',
  'content-type': 'application/json',
};

async function api(path, init) {
  const res = await fetch('https://api.github.com' + path, { ...init, headers: { ...H, ...(init && init.headers) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

// 触发
const dispatch = await api(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
  method: 'POST',
  body: JSON.stringify({ ref: 'main' }),
});
console.log('触发 workflow_dispatch → HTTP ' + dispatch.status +
  (dispatch.status === 204 ? '（成功）' : '：' + JSON.stringify(dispatch.body)));

if (dispatch.status !== 204) {
  console.log('\n如果状态是 403/404，通常是这个 PAT 没有 workflow 权限：');
  console.log('  打开 https://github.com/' + OWNER + '/' + REPO + '/actions/workflows/' + WORKFLOW);
  console.log('  点右侧「Run workflow」即可（一次点击，跟这个脚本等价）。');
  process.exitCode = 3;
} else {
  // 等它起来
  await new Promise((r) => setTimeout(r, 8000));
  const runs = await api(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=3`);
  const list = (runs.body && runs.body.workflow_runs) || [];
  if (list.length === 0) {
    console.log('还没看到运行记录，稍后自己刷 Actions 页看。');
  } else {
    const r = list[0];
    console.log('最新一次运行：' + r.status + ' / ' + (r.conclusion || '进行中') + '  ' + r.html_url);
    console.log('（发布通常 1–3 分钟；完成后 https://' + OWNER + '.github.io/' + REPO + '/sponsor/ 才会是新版）');
  }
  process.exitCode = 0;
}
