// tools/build-report.mjs — 把两个数据源合成《DSH 插件周榜》
//
// 产物：
//   report/index.md          当期周报（Markdown，便于直接贴公众号/群）
//   report/index.html        当期周报（自包含单文件 HTML，GitHub Pages 用）
//   report/archive/<date>.md 历史留档
//   report/latest.json       机器可读的一期结果
//
// 数据来自：
//   tools/rank-plugins.mjs       插件榜（策展中文说明 + 实时星数 + 较上期涨星）
//   tools/survey-free-models.mjs 免费模型可用性（真跑一次补全）
//
// 用法：
//   node tools/build-report.mjs               # 采集 + 生成
//   node tools/build-report.mjs --offline     # 不联网采集，用 data/last-*.json
//   GITHUB_TOKEN=xxx node tools/build-report.mjs

import { spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA = resolve(ROOT, 'data')
const OUT = resolve(ROOT, 'report')
const ARCHIVE = resolve(OUT, 'archive')
const offline = process.argv.includes('--offline')

const TITLE = 'DSH 插件周榜'
// 周报按**北京时间**切期：UTC 日期会让晚上生成的周报落到前一天
const BJT = (d = new Date()) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
const TODAY = BJT()

function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}
function write(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
}

// ── 采集：调两个 CLI，取它们的 --json ───────────────────────────────────
function runTool(script, args = []) {
  const r = spawnSync(process.execPath, [resolve(HERE, script), ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000,
    env: process.env,
  })
  if (r.error) return { ok: false, why: String(r.error.message) }
  const stdout = (r.stdout || '').trim()
  if (!stdout) return { ok: false, why: `无输出（exit ${r.status}）: ${(r.stderr || '').trim().split('\n').slice(-3).join(' / ')}` }
  let json
  try { json = JSON.parse(stdout) } catch (e) { return { ok: false, why: 'JSON 解析失败：' + e.message } }
  return { ok: true, json, exit: r.status, note: (r.stderr || '').trim() }
}

let plugins, models, notes = []
if (offline) {
  plugins = readJson(resolve(DATA, 'last-plugins.json'))
  models = readJson(resolve(DATA, 'last-free-models.json'))
  notes.push(offline ? '本期为离线重渲染（--offline），数据取自上次采集。' : '')
} else {
  const p = runTool('rank-plugins.mjs', ['--json'])
  if (p.ok) { plugins = p.json; write(resolve(DATA, 'last-plugins.json'), JSON.stringify(p.json, null, 2)) }
  else notes.push('插件榜采集失败：' + p.why)

  const m = runTool('survey-free-models.mjs', ['--json'])
  if (m.ok) { models = m.json; write(resolve(DATA, 'last-free-models.json'), JSON.stringify(m.json, null, 2)) }
  else notes.push('免费模型采集失败：' + m.why)
}

// ── 统计与要点 ─────────────────────────────────────────────────────────
const P = plugins?.rows || []
const S = models?.stat || null
const M = models?.rows || []

const movers = P.filter((r) => typeof r.delta === 'number' && r.delta !== 0)
  .sort((a, b) => b.delta - a.delta)
const newcomersTop = (plugins?.fresh || []).slice(0, 3)
const totalStars = P.reduce((s, r) => s + (r.stars || 0), 0)
const categoryCount = {}
for (const r of P) {
  categoryCount[r.cat] = (categoryCount[r.cat] || 0) + 1
}
const catLine = Object.entries(categoryCount).sort((a, b) => b[1] - a[1])
  .map(([c, n]) => `${c} ${n}`).join('｜')

const star = (n) => n === null || n === undefined ? '—' : (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
const deltaText = (d) => d === null || d === undefined ? '—' : (d > 0 ? '+' + d : String(d))

const bullets = []
if (P.length) {
  const top = [...P].sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, 3)
  bullets.push(`收录插件 ${P.length} 个，合计 ${totalStars.toLocaleString('en-US')} ★；前三名：` + top.map((r) => `${r.name}（${star(r.stars)}★）`).join('、') + '。')
}
if (movers.length) {
  const up = movers.slice(0, 3)
  bullets.push('本期涨星：' + up.map((r) => `${r.name} ${deltaText(r.delta)}★`).join('、') + '。')
} else {
  bullets.push('本期为首期（或与上期间隔内星数无变化），暂无涨星对比。')
}
if (S) {
  bullets.push(`免费模型可用性：**${S.ok}/${S.total} 可用**` + (S.limited ? `，限流 ${S.limited} 个` : '') + (S.region ? `，地区墙 ${S.region} 个` : '') + (S.gone ? `，已下线 ${S.gone} 个` : '') + (S.flaky ? `，上游波动 ${S.flaky} 个` : '') + (S.ttfbMid !== null ? `；可用模型首字延迟中位 ${S.ttfbMid.toFixed(2)}s。` : '。'))
} else {
  bullets.push('免费模型数据本期未采集到（见文末说明）。')
}
if (newcomersTop.length) {
  bullets.push('待审新面孔：' + newcomersTop.map((f) => `${f.repo}（${star(f.stars)}★，${f.pushed}）`).join('、') + '。')
}

// ── Markdown ───────────────────────────────────────────────────────────
function md() {
  const L = []
  L.push(`# ${TITLE} · ${TODAY}`, '')
  L.push(`> 只做一件事：把"这周 DSH 生态里什么值得装、免费模型还能不能用"讲成人话。**所有星数来自 GitHub 实时接口**，中文说明为人工核实后的策展，不做机翻。`, '')
  L.push('## 一、本期要点', '')
  for (const b of bullets) L.push('- ' + b)
  L.push('')
  L.push('## 二、插件榜', '')
  L.push(`分类分布：${catLine}`, '')
  L.push('| ⭐ | 插件 | 中文说明 | 分类 | 形态 | 较上期 | 最近更新 | 许可 |', '|---:|---|---|---|---|---:|---|---|')
  for (const r of P) {
    const mark = r.starsSource === 'live' ? '' : '≈'
    L.push(`| ${star(r.stars)}${mark} | **${r.name}**<br>\`${r.repo}\` | ${r.cn} | ${r.cat} | ${r.kind} | ${deltaText(r.delta)} | ${r.pushed || '—'} | ${r.license || '-'} |`)
  }
  L.push('', '> ≈ 表示该行星数取自上期快照（本次实时接口未取到）。', '')

  if (M.length) {
    L.push('## 三、免费模型可用性（真跑一次补全）', '')
    L.push(`共 ${S.total} 个免费模型：**可用 ${S.ok}**，限流 ${S.limited}，地区墙 ${S.region}，已下线 ${S.gone}，上游波动 ${S.flaky}。`, '')
    L.push('| 状态 | 模型 | 线路 | 首字延迟 | 总耗时 | 结果 |', '|---|---|---|---|---|---|')
    const LBL = { ok: '✅ 可用', limited: '⚠️ 限流', region: '🚫 地区墙', gone: '❌ 已下线', flaky: '🔁 上游波动' }
    for (const r of M) {
      const body = r.text || (r.reasoning ? `[仅思考 ${r.reasoning} 字]` : '')
      const detail = r.ok ? JSON.stringify(body).slice(0, 30) : String(r.err || 'HTTP ' + r.status).slice(0, 100)
      L.push(`| ${LBL[r.verdict] || '❔'} | \`${r.model}\` | ${r.wire} | ${r.ttfb === null || r.ttfb === undefined ? '—' : r.ttfb.toFixed(2) + 's'} | ${Number(r.total).toFixed(1)}s | ${detail} |`)
    }
    L.push('', '> 「上游波动」= 供应商临时过载/超时（已自动重试）；「已下线」= 接口明确返回模型或端点不可用。二者对使用者的含义不同，故分开列。', '')
  }

  const fresh = plugins?.fresh || []
  if (fresh.length) {
    L.push('## 四、待审新面孔（已自动过滤蹭标签项目）', '')
    L.push('| ⭐ | 仓库 | 最近更新 | 英文简介（原样） |', '|---:|---|---|---|')
    for (const f of fresh) L.push(`| ${star(f.stars)} | \`${f.repo}\` | ${f.pushed} | ${String(f.desc || '').replace(/\|/g, '/')} |`)
    L.push('', '> 这些是 `topic:dsh-plugin` 里星数较高但尚未人工核实的新项目，核实后会进入正式榜。', '')
  }

  const np = plugins?.notPlugins || []
  if (np.length) {
    L.push('## 五、星数陷阱（贴了标签但不是插件）', '')
    L.push('| ⭐ | 仓库 | 为什么不算', '|---:|---|---|')
    for (const r of [...np].sort((a, b) => b.stars - a.stars)) L.push(`| ${star(r.stars)} | \`${r.repo}\` | ${r.why} |`)
    L.push('')
  }

  L.push('## 六、方法与免责', '')
  L.push('- 插件星数为 GitHub 实时数据（GraphQL 批量取，失败时退化为逐个 REST，仍失败则用上期快照并标 ≈）。')
  L.push('- 中文名/中文说明/形态判断为人工策展；"形态"里的**原生bundle**指可以直接装进 DSH profile，"外部/Skill"指独立应用或技能包。')
  L.push('- 免费模型为**真实调用**（一条极短补全），走的就是免费模型插件自己的传输与指纹；地区墙受出口 IP 影响，换地区结论会变。')
  L.push('- 周报立场：只推荐本机实测过、且读过源码确认没有外网/密钥/定时器风险的项目；其余只列不荐。')
  L.push('')
  L.push(`<sub>生成时间 ${new Date().toISOString()}｜数据源 tools/rank-plugins.mjs + tools/survey-free-models.mjs</sub>`)
  return L.join('\n') + '\n'
}

// ── HTML（单文件、零依赖、可直接上 GitHub Pages）───────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
// 极简 Markdown 内联渲染（够用即可：**粗体**、`代码`）
function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')
}

function html() {
  const LBL = { ok: ['✅ 可用', 'ok'], limited: ['⚠️ 限流', 'warn'], region: ['🚫 地区墙', 'warn'], gone: ['❌ 已下线', 'bad'], flaky: ['🔁 上游波动', 'warn'] }
  const card = (r, i) => `
      <article class="card" data-cat="${esc(r.cat)}" data-kind="${esc(r.kind)}">
        <div class="rank">${i + 1}</div>
        <div class="body">
          <h3>${inline(r.name)}<span class="kind">${esc(r.kind)}</span></h3>
          <a class="repo" href="https://github.com/${esc(r.repo)}" target="_blank" rel="noopener">${esc(r.repo)}</a>
          <p>${inline(r.cn)}</p>
          <div class="meta">
            <span class="cat">${esc(r.cat)}</span>
            <span class="pushed">更新 ${esc(r.pushed || '—')}</span>
            <span class="lic">${esc(r.license || '-')}</span>
          </div>
        </div>
        <div class="stars">
          <b>${star(r.stars)}${r.starsSource === 'live' ? '' : '≈'}</b><span>★</span>
          ${r.delta ? `<em class="${r.delta > 0 ? 'up' : 'down'}">${deltaText(r.delta)}</em>` : ''}
        </div>
      </article>`

  const catChips = ['全部', ...Object.keys(categoryCount)].map((c, i) => `<button class="chip${i === 0 ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')

  const modelRows = M.map((r) => {
    const [label, cls] = LBL[r.verdict] || ['❔', 'warn']
    const body = r.text || (r.reasoning ? `[仅思考 ${r.reasoning} 字]` : '')
    const detail = r.ok ? JSON.stringify(body).slice(0, 24) : String(r.err || 'HTTP ' + r.status).slice(0, 90)
    return `<tr><td><span class="pill ${cls}">${label}</span></td><td><code>${esc(r.model)}</code></td><td>${esc(r.wire)}</td><td>${r.ttfb === null || r.ttfb === undefined ? '—' : Number(r.ttfb).toFixed(2) + 's'}</td><td>${Number(r.total).toFixed(1)}s</td><td class="dim">${inline(detail)}</td></tr>`
  }).join('')

  const freshRows = (plugins?.fresh || []).map((f) => `<tr><td>${star(f.stars)}★</td><td><a href="https://github.com/${esc(f.repo)}" target="_blank" rel="noopener">${esc(f.repo)}</a></td><td>${esc(f.pushed)}</td><td class="dim">${esc(String(f.desc || '').slice(0, 110))}</td></tr>`).join('')
  const trapRows = [...(plugins?.notPlugins || [])].sort((a, b) => b.stars - a.stars)
    .map((r) => `<tr><td>${star(r.stars)}★</td><td><code>${esc(r.repo)}</code></td><td>${inline(r.why)}</td></tr>`).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE} · ${TODAY}</title>
<meta name="description" content="${TITLE}：DSH 生态插件排行（中文说明+实时星数）与免费模型可用性周报。">
<style>
  :root{--bg:#0b0f17;--bg2:#141a26;--card:#182031;--line:#243044;--fg:#e8eefc;--dim:#93a1bd;--acc:#5eead4;--acc2:#8b9dff;--up:#42d392;--down:#ff7a7a}
  @media (prefers-color-scheme:light){:root{--bg:#f6f8fc;--bg2:#fff;--card:#fff;--line:#e3e9f4;--fg:#12192a;--dim:#5a6a86;--acc:#0d9488;--acc2:#4f46e5}}
  *{box-sizing:border-box}
  body{margin:0;background:linear-gradient(180deg,var(--bg2),var(--bg) 320px);color:var(--fg);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:1000px;margin:0 auto;padding:40px 20px 80px}
  header{border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:28px}
  h1{margin:0 0 6px;font-size:30px;letter-spacing:-.5px}
  h1 small{font-size:15px;color:var(--dim);font-weight:400;margin-left:10px}
  h2{font-size:20px;margin:44px 0 14px;padding-left:12px;border-left:3px solid var(--acc)}
  .lede{color:var(--dim);font-size:14.5px}
  ul.points{list-style:none;padding:0;margin:0}
  ul.points li{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin-bottom:10px;box-shadow:0 1px 2px rgba(0,0,0,.12)}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 18px}
  .chip{cursor:pointer;background:var(--card);color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:13px}
  .chip.on{color:#04121a;background:var(--acc);border-color:var(--acc);font-weight:600}
  .grid{display:grid;gap:14px}
  .card{display:grid;grid-template-columns:40px 1fr auto;gap:14px;align-items:start;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;transition:.18s;box-shadow:0 1px 2px rgba(0,0,0,.12)}
  .card:hover{transform:translateY(-2px);border-color:var(--acc2);box-shadow:0 10px 28px rgba(0,0,0,.22)}
  .card.hide{display:none}
  .rank{font:600 13px/1 ui-monospace,monospace;color:var(--dim);padding-top:6px}
  .card h3{margin:0 0 2px;font-size:16.5px}
  .card h3 .kind{font-size:11.5px;font-weight:500;color:var(--acc);border:1px solid var(--line);border-radius:6px;padding:1px 7px;margin-left:8px;vertical-align:1px}
  .repo{color:var(--dim);font:12.5px/1.5 ui-monospace,monospace;text-decoration:none;word-break:break-all}
  .repo:hover{color:var(--acc2)}
  .card p{margin:7px 0 0;font-size:14.5px;color:var(--fg)}
  .card p code{background:rgba(127,127,127,.16);padding:1px 5px;border-radius:5px;font-size:13px}
  .meta{margin-top:9px;display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--dim)}
  .meta .cat{color:var(--acc)}
  .stars{text-align:right;min-width:64px}
  .stars b{font-size:17px}
  .stars span{color:var(--dim);margin-left:2px}
  .stars em{display:block;font-style:normal;font-size:12.5px;margin-top:3px}
  .up{color:var(--up)}.down{color:var(--down)}
  table{width:100%;border-collapse:collapse;font-size:14px;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  th{background:rgba(127,127,127,.08);font-size:12.5px;color:var(--dim);font-weight:600;white-space:nowrap}
  tr:last-child td{border-bottom:0}
  td.dim{color:var(--dim);font-size:13px}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .pill{font-size:12px;padding:2px 9px;border-radius:999px;white-space:nowrap}
  .pill.ok{background:rgba(66,211,146,.16);color:var(--up)}
  .pill.bad{background:rgba(255,122,122,.16);color:var(--down)}
  .pill.warn{background:rgba(255,196,0,.16);color:#eab308}
  .scroll{overflow-x:auto}
  footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);color:var(--dim);font-size:12.5px}
  a{color:var(--acc2)}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>${TITLE}<small>${TODAY}</small></h1>
  <p class="lede">只做一件事：把"这周 DSH 生态里什么值得装、免费模型还能不能用"讲成人话。<br>
  <strong>星数全部来自 GitHub 实时接口</strong>，中文说明为人工核实后的策展，不做机翻。</p>
</header>

<h2>一、本期要点</h2>
<ul class="points">${bullets.map((b) => `<li>${inline(b)}</li>`).join('')}</ul>

<h2>二、插件榜（${P.length}）</h2>
<div class="chips">${catChips}</div>
<div class="grid">${P.map(card).join('')}</div>
<p class="lede" style="margin-top:12px">≈ 表示星数取自上期快照（本次实时接口未取到）。</p>

${M.length ? `<h2>三、免费模型可用性（真跑一次补全）</h2>
<p class="lede">可用 <strong>${S.ok}</strong>/${S.total}｜限流 ${S.limited}｜地区墙 ${S.region}｜已下线 ${S.gone}｜上游波动 ${S.flaky}${S.ttfbMid !== null ? `｜首字延迟中位 ${Number(S.ttfbMid).toFixed(2)}s` : ''}</p>
<div class="scroll"><table><thead><tr><th>状态</th><th>模型</th><th>线路</th><th>首字</th><th>总耗时</th><th>结果</th></tr></thead><tbody>${modelRows}</tbody></table></div>
<p class="lede" style="margin-top:12px">「上游波动」= 供应商临时过载/超时（已自动重试）；「已下线」= 接口明确返回模型或端点不可用。二者对使用者的含义不同，故分开列。</p>` : ''}

${freshRows ? `<h2>四、待审新面孔（已自动过滤蹭标签项目）</h2>
<div class="scroll"><table><thead><tr><th>⭐</th><th>仓库</th><th>更新</th><th>英文简介（原样）</th></tr></thead><tbody>${freshRows}</tbody></table></div>` : ''}

${trapRows ? `<h2>五、星数陷阱（贴了标签但不是插件）</h2>
<div class="scroll"><table><thead><tr><th>⭐</th><th>仓库</th><th>为什么不算</th></tr></thead><tbody>${trapRows}</tbody></table></div>` : ''}

<h2>六、方法与免责</h2>
<ul class="points">
  <li>插件星数为 GitHub 实时数据（GraphQL 批量取，失败退化逐个 REST，再失败用上期快照并标 ≈）。</li>
  <li><strong>原生bundle</strong> 指可直接装进 DSH profile；<strong>外部 / Skill</strong> 指独立应用或技能包。</li>
  <li>免费模型为<strong>真实调用</strong>（一条极短补全），走的就是免费模型插件自己的传输与指纹；地区墙受出口 IP 影响。</li>
  <li>周报立场：只推荐本机实测过、且读过源码确认没有外网 / 密钥 / 定时器风险的项目；其余只列不荐。</li>
</ul>

<footer>
  生成时间 ${new Date().toISOString()}｜数据源 tools/rank-plugins.mjs + tools/survey-free-models.mjs
  ${notes.filter(Boolean).length ? '<br>采集备注：' + notes.filter(Boolean).map(esc).join('；') : ''}
</footer>
</div>
<script>
var chips = document.querySelectorAll('.chip');
var cards = document.querySelectorAll('.card');
for (var i = 0; i < chips.length; i++) {
  chips[i].addEventListener('click', function () {
    var cat = this.getAttribute('data-cat');
    for (var j = 0; j < chips.length; j++) chips[j].classList.toggle('on', chips[j] === this);
    for (var k = 0; k < cards.length; k++) {
      cards[k].classList.toggle('hide', cat !== '全部' && cards[k].getAttribute('data-cat') !== cat);
    }
  });
}
</script>
</body>
</html>
`
}

const mdText = md()
const htmlText = html()
write(resolve(OUT, 'index.md'), mdText)
write(resolve(OUT, 'index.html'), htmlText)
// GitHub Pages 默认走 Jekyll：放 .nojekyll 避免下划线开头的文件被忽略
write(resolve(OUT, '.nojekyll'), '')
write(resolve(ARCHIVE, TODAY + '.md'), mdText)
write(resolve(ARCHIVE, TODAY + '.html'), htmlText)
write(resolve(OUT, 'latest.json'), JSON.stringify({
  date: TODAY, generatedAt: new Date().toISOString(),
  plugins: P, stat: S, models: M,
  newcomers: plugins?.fresh || [], notPlugins: plugins?.notPlugins || [], notes: notes.filter(Boolean),
}, null, 2))

console.log(`[ok] report/index.md + report/index.html（插件 ${P.length} 项，免费模型 ${M.length} 项，星数实时 ${P.filter((r) => r.starsSource === 'live').length} 项）`)
for (const n of notes.filter(Boolean)) console.error('[note] ' + n)
process.exit(P.length ? 0 : 2)
