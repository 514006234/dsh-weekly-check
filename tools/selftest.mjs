// tools/selftest.mjs — 离线回归自测（不碰真实 data/，不依赖网络）
//
//   node tools/selftest.mjs        # 全通过退出 0，否则 1
//
// 覆盖三条最容易静默出错的链路：
//   1) 「较上期」涨星：有历史快照时必须算出 delta，没历史时必须为 null（而不是 0）
//   2) GitHub 不可用时的兜底：退化到策展快照、星数仍是真实数字、退出码 2
//   3) 周报离线渲染：--offline 能只用 data/last-*.json 生成 md + html，且关键内容在位
//
// 做法：把工具复制到临时目录里跑（工具用自身位置推导 data/，所以复制即隔离）。

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

let fail = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  → ' + detail : ''))
  if (!ok) fail++
}

const sandbox = mkdtempSync(join(tmpdir(), 'dsh-weekly-selftest-'))
mkdirSync(join(sandbox, 'tools'), { recursive: true })
mkdirSync(join(sandbox, 'data'), { recursive: true })
for (const f of ['rank-plugins.mjs', 'build-report.mjs']) {
  copyFileSync(join(HERE, f), join(sandbox, 'tools', f))
}
writeFileSync(join(sandbox, 'data', 'history.json'), JSON.stringify({
  '2026-09-25': { 'jipika/dsh-memory': 0, 'zouyuxuan122/dsh-our-free-model': 400, 'AzureHalcyon/dsh-deepseek-usage': 0 },
}), 'utf8')

function runRank(env) {
  const r = spawnSync(process.execPath, [join(sandbox, 'tools', 'rank-plugins.mjs'), '--no-write', '--json'], {
    encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 300000,
  })
  let json = null
  try { json = JSON.parse(r.stdout) } catch { /* 保持 null */ }
  return { exit: r.status, json, err: (r.stderr || '').trim().split('\n').slice(-2).join(' / ') }
}

// 网络探针：GitHub 不可达时，网络依赖的断言降级为"跳过"而不是"失败"
function githubReachable() {
  const r = spawnSync(process.execPath, ['-e',
    "fetch('https://api.github.com/rate_limit',{signal:AbortSignal.timeout(4000)}).then(x=>process.exit(x.ok?0:1)).catch(()=>process.exit(1))"],
    { timeout: 8000 })
  return r.status === 0
}

console.log('用例 1：有上期历史 → 应算出「较上期」涨星')
const a = runRank({})
if (!a.json) {
  check('拿到 JSON', false, a.err || ('exit ' + a.exit))
} else {
  check('priorAsOf 指向上期日期', a.json.priorAsOf === '2026-09-25', String(a.json.priorAsOf))
  const ofm = a.json.rows.find((r) => r.repo === 'zouyuxuan122/dsh-our-free-model')
  check('涨星 delta 正确', ofm && ofm.delta === ofm.stars - 400, ofm ? `${ofm.stars} - 400 = ${ofm.delta}` : 'missing')
  check('只有上期收录的仓库有 delta', a.json.rows.filter((r) => r.delta !== null).length === 3,
    'delta 行数=' + a.json.rows.filter((r) => r.delta !== null).length)
  // 网络抖动不算自测失败：GitHub 可达时才强制要求 live>0，不可达则如实跳过
  if (a.json.liveCount > 0) {
    check('实时星数已取到', true, 'live=' + a.json.liveCount)
  } else if (githubReachable()) {
    check('实时星数已取到', false, 'GitHub 可达但 live=0 → 真失败')
  } else {
    check('实时星数：GitHub 不可达，本项跳过（不影响其余断言）', true, 'live=0 且网络探针失败')
  }
}

console.log('用例 2：GitHub 不可用 → 退化到策展快照，退出码 2')
const b = runRank({ GITHUB_TOKEN: '', DSH_GH_API: 'http://127.0.0.1:9' })
check('退出码为 2', b.exit === 2, 'exit=' + b.exit)
if (b.json) {
  const dist = {}
  for (const r of b.json.rows) dist[r.starsSource] = (dist[r.starsSource] || 0) + 1
  check('没有一行标记为 live', !dist.live && !dist.none, JSON.stringify(dist))
  check('liveCount = 0', b.json.liveCount === 0, 'live=' + b.json.liveCount)
  check('榜首仍是真实星数', typeof b.json.rows[0].stars === 'number' && b.json.rows[0].stars > 1000,
    `${b.json.rows[0].repo}=${b.json.rows[0].stars}`)
} else {
  check('拿到 JSON', false, b.err || ('exit ' + b.exit))
}

console.log('用例 3：--offline 只用上次采集的数据渲染周报')
writeFileSync(join(sandbox, 'data', 'last-plugins.json'), JSON.stringify({
  generatedAt: '2026-09-25T00:00:00.000Z', liveCount: 1, priorAsOf: null,
  rows: [{
    repo: 'demo/plugin', name: '示例插件', cn: '这是一句**中文**说明 `code`', cat: '工作台', kind: '原生bundle',
    stars: 1234, starsSource: 'live', asOf: '2026-09-25', delta: 56, pushed: '2026-09-24', license: 'MIT', archived: false,
  }],
  notPlugins: [{ repo: 'demo/not-plugin', stars: 99999, why: '不是插件' }],
  fresh: [{ repo: 'demo/new', stars: 88, pushed: '2026-09-24', desc: 'brand new' }],
}), 'utf8')
writeFileSync(join(sandbox, 'data', 'last-free-models.json'), JSON.stringify({
  stat: { total: 2, ok: 1, limited: 0, region: 1, gone: 0, flaky: 0, retried: 0, ttfbFast: 1.2, ttfbMid: 1.2, ttfbSlow: 1.2 },
  rows: [
    { model: 'demo-free', wire: 'chat', status: 200, ttfb: 1.2, total: 2.0, text: '通了', reasoning: 0, err: '', ok: true, verdict: 'ok', attempts: 1 },
    { model: 'demo-region-free', wire: 'chat', status: 403, ttfb: null, total: 0.3, text: '', reasoning: 0, err: 'This model is not available in your country.', ok: false, verdict: 'region', attempts: 1 },
  ],
}), 'utf8')
const off = spawnSync(process.execPath, [join(sandbox, 'tools', 'build-report.mjs'), '--offline'], { encoding: 'utf8', cwd: sandbox, timeout: 120000 })
check('退出码 0', off.status === 0, 'exit=' + off.status + ' ' + (off.stderr || '').trim())
for (const f of ['report/index.md', 'report/index.html', 'report/latest.json']) {
  check('生成 ' + f, existsSync(join(sandbox, f)))
}
if (existsSync(join(sandbox, 'report', 'index.html'))) {
  const h = readFileSync(join(sandbox, 'report', 'index.html'), 'utf8')
  const m = readFileSync(join(sandbox, 'report', 'index.md'), 'utf8')
  check('HTML 含插件卡片', h.includes('示例插件') && h.includes('1.2k'))
  check('HTML 内联渲染 **粗体**', h.includes('<strong>中文</strong>'))
  check('HTML 含免费模型状态标签', h.includes('地区墙'))
  check('HTML 无脚本外链（单文件）', !/<script[^>]+src=/.test(h) && !/<link[^>]+stylesheet/.test(h))
  check('Markdown 含涨星', /\+56/.test(m))
  // 影响力流量栏目：离线且无缓存时必须优雅降级，但栏目本身必须存在
  check('Markdown 含影响力与流量栏目', m.includes('影响力与流量'))
  check('HTML 含影响力与流量栏目', h.includes('影响力与流量'))
  check('无流量缓存时降级为「未采集」而不是崩溃', m.includes('未采集到流量数据'))
}

rmSync(sandbox, { recursive: true, force: true })
console.log(fail ? `\n✗ 失败 ${fail} 项` : '\n✓ 全部通过')
process.exit(fail ? 1 : 0)
