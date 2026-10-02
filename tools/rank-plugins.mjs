// tools/rank-plugins.mjs — DSH 插件周榜数据源（CLI）
//
// 设计取舍：**中文解释是策展的，不做机器翻译**。
// GitHub `topic:dsh-plugin` 有几万条，其中大量项目只是蹭标签
// （24 万星的是 harness 本体、4 万星的是简历生成器、2 万星的是图片上传器），
// 且 GitHub 描述基本是英文。所以这里：
//   1) 用**人工核实过的白名单**（每条都写好中文名+中文说明+是否原生 bundle）
//   2) 只向 GitHub 拉**实时星数/更新时间/许可**来刷新
//   3) 额外做一次 topic 扫描，把"星数突增但未收录"的新项目列进【待审区】
//   4) 星数落盘成快照 + 历史，离线/配额受限时报告仍有真实数字与"较上期"变化
//
// 用法：
//   node tools/rank-plugins.mjs              # Markdown 表格（stdout）
//   node tools/rank-plugins.mjs --json       # JSON
//   node tools/rank-plugins.mjs --no-write   # 不更新 data/*.json
//   GITHUB_TOKEN=xxx node tools/rank-plugins.mjs   # 带 token：走 GraphQL 一次批量取，配额充足
//
// 退出码：0 = 至少一项取到实时星数；2 = 完全没取到（用快照渲染）

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA = resolve(ROOT, 'data')

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const noWrite = argv.includes('--no-write')
const TOKEN = process.env.GITHUB_TOKEN || ''

const UA = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-weekly-check' }
// 允许换 API 基址：自测（打一个必然连不上的地址来验证兜底链路）或走企业代理用
const GH = (process.env.DSH_GH_API || 'https://api.github.com').replace(/\/+$/, '')

// ── 策展白名单：repo / 中文名 / 中文说明 / 分类 / 形态 ───────────────
// 形态：原生bundle=可 dsh plugin add / 拷贝部署；外部=独立应用或扩展；Skill=技能包
const CURATED = [
  ['nexu-io/open-design', 'OpenDesign 设计工作台', '生成网页/PPT/图片/视频并导出，**不是 DSH 插件**，是它反过来管理 DSH 运行时', '设计交付', '外部'],
  ['tt-a1i/archify', 'Archify 架构图', '从代码库生成可验证的架构/流程/时序图，自带 HTML 导出', '文档图', 'Skill'],
  ['volcengine/OpenViking', 'OpenViking 上下文库', '把记忆/知识/RAG/Skill 统一进 `viking://` 虚拟文件系统；**AGPL 且是独立部署**，不适合只想加记忆的人', '记忆', '外部'],
  ['anywhere-labs/dsh-desktop', 'DSH Desktop（社区桌面端）', '把整个 Harness 打进安装包，**无需 Node 环境**；个人项目非官方', '桌面端', '外部'],
  ['titanwings/distilly', 'Distilly 技能提炼', '把「别人怎么想」蒸馏成可复用 Skills（原 colleague-skill）', '技能', '外部'],
  ['voyager-crew/voyager', 'Voyager 提示词管理', '浏览器扩展，可在 DSH 网页里复用提示词；**不是 DSH bundle**', '提示词', '外部'],
  ['awesome-dsh-plugin/awesome-dsh-plugin', 'DSH 插件精选列表', '社区维护的插件清单，找插件的入口', '榜单', '外部'],
  ['EverMind-AI/EverOS', 'EverOS 记忆层', '本地优先、Markdown 原生、用户自持的跨 Agent 记忆层', '记忆', '外部'],
  ['MemTensor/MemOS', 'MemOS 记忆操作系统', '面向 LLM/Agent 的自进化记忆系统，带混合检索', '记忆', '外部'],
  ['dataelement/dsh-desktop', 'DSHDesktop', '又一个社区桌面版', '桌面端', '外部'],
  ['zhu1090093659/dsh-web', 'dsh-web 全家桶', '任务看板/Git图谱/右侧面板/移动端/皮肤等聚合分发', '工作台', '原生bundle'],
  ['Tencent/BrowserSkill', 'BrowserSkill 浏览器技能', '让 Agent 用你**已登录的真实浏览器**干活，CLI+扩展', '浏览器', 'Skill'],
  ['yjh051108/dsh-routing-suite', 'dsh-routing-suite 智能路由', '按任务把请求路由到不同模型/提供商', '模型路由', '原生bundle'],
  ['Devin-AXIS/iPolloWork', 'iPolloWork 企业工作台', '本地优先的多引擎 Agent 工作台', '工作台', '外部'],
  ['Q00/ouroboros', 'Ouroboros 自进化 Agent OS', '访谈门控 + 分阶段评测 + 预算约束的长任务闭环', '多Agent', '原生bundle'],
  ['loopx-project/loopx', 'loopx 长任务控制面', '带持久状态内核，维持长任务与团队持续推进', '多Agent', '外部'],
  ['dsh-market/dsh-market', 'dsh-market 插件市场', 'DSH 界面内的插件市场：浏览/搜索/一键安装', '插件市场', '原生bundle'],
  ['zouyuxuan122/dsh-our-free-model', 'Our Free Model 免费模型', '免登录免 Key 用 11 个免费模型（MiMo/Nemotron/Space Bunny 等）；**本机已装并调优**', '免费模型', '原生bundle'],
  ['crafter-station/petdex', 'petdex 宠物画廊', '界面里养动画宠物（Codex/Claude/DSH 通用）', '娱乐', '原生bundle'],
  ['liustack/modlens', 'ModLens 视觉识图', '纯文本模型**直接看图**：粘贴图片返回 OCR/布局/语义证据', '视觉识图', '原生bundle'],
  ['omdsh-dev/DSH-better-sidebar', 'better-sidebar 侧边栏底座', '侧边栏变 IDE：文件树/终端/Git/子代理，且开放给三方扩展', '工作台', '原生bundle'],
  ['superdesigndev/treg', 'treg 工具路由器', '「Agent 工具界的 OpenRouter」，统一调度工具调用', '多Agent', '原生bundle'],
  ['ccch1mneyyy/dsh-TUI', 'dsh-TUI 终端版', '官方公众号收录的 TUI：鲸鱼顶栏/流式思考/上下文进度+TPS', '终端', '原生bundle'],
  ['xiaobright/dsh-anchored-standard', 'anchored-standard 两阶段预设', '先最小对齐启动、再放开全套标准工具的 preset', '预设', '原生bundle'],
  ['MeteorNOX/DeepSeek-Balance-Whale-Widget', '余额小鲸鱼', '右下角动画小鲸鱼盯余额，可拖拽吸附', '娱乐', '原生bundle'],
  ['oh-my-dsh/dsh-plugin-upgrade-skill', '插件升级 Skill', '让已装插件跟着 DSH 版本升级（升级顾问）', '维护', 'Skill'],
  ['Sanqi-normal/dsh-webui-market-plugin', 'Web 界面插件市场', '在 Web GUI 里浏览目录、一键装卸到 profile', '插件市场', '原生bundle'],
  ['WYH66666666/DSH-Transparent-UI-Plugin', '玻璃透明主题', '全界面磨砂玻璃主题，模糊度/磨砂度可调', '主题皮肤', '原生bundle'],
  ['LittleBlackTong/dsh-plugin-memory', 'dsh-plugin-memory（记忆）', '两层 markdown 记忆；**本机实测不推荐**：默认库在 `~/.memory` 且每 60 秒起一次 git 提交', '记忆', '原生bundle'],
  ['jipika/dsh-memory', 'dsh-memory 双层记忆', '**本机已装的首选记忆**：全局+项目层 markdown、零外网零 Key 零定时器、审计日志、CSRF 护栏', '记忆', '原生bundle'],
  ['AzureHalcyon/dsh-deepseek-usage', 'DeepSeek 用量看板', '余额/今日用量/缓存命中/热力图，三个只读接口；**本机已装**', '用量', '原生bundle'],
]

// ── 为什么不能只按 topic + 星数排：贴了 `dsh-plugin` 标签、但不是「可安装插件」的高星项目 ──
//
// 措辞纪律（改过一次，原因记在这里）：这一栏**只陈述事实，不做动机判断**。
// 初版写的是「星数陷阱」+「蹭标签」，问题有两个：
//   ① 把 `deepseek-ai/deepseek-harness`（平台本体）写进「陷阱」，等于说官方仓库是坑——这是找死；
//   ② 说别人「蹭标签」是在公开揣测动机，而多数情况只是标签用法不同（平台本体、同类工具、独立应用）。
// 保留这栏的价值在于解释「为什么星数排序会误导」，而不是给谁扣帽子。
const NOT_PLUGINS = [
  ['deepseek-ai/deepseek-harness', 241006, 'DeepSeek Harness 平台本体——不是插件，而是所有插件运行的地方'],
  ['reactive-resume/reactive-resume', 43621, '简历生成器：与 DSH 插件生态无关，只是标签用法不同'],
  ['Molunerfinn/PicGo', 27289, '图片上传工具：与 DSH 无关'],
  ['nocobase/nocobase', 24414, '无代码平台：独立产品，不是 DSH 插件'],
  ['ruvnet/ruflo', 73575, '另一个 agent harness 项目——同类工具，不是本生态的插件'],
  ['esengine/DeepSeek-Reasonix', 35721, '独立的编码代理，不是可安装进 DSH 的插件'],
  ['Tencent/WeKnora', 31469, 'LLM 知识平台：独立产品，不是 DSH 插件'],
  ['freestylefly/awesome-gpt-image-2', 33810, '提示词案例库：内容集合，不是可安装插件'],
]

// ── 星数快照（策展时点，2026-10-01）。live 拉不到时用它兜底 ─────────────
const SNAPSHOT_ASOF = '2026-10-01'
const SNAPSHOT = {
  'nexu-io/open-design': 98918, 'tt-a1i/archify': 75083, 'volcengine/OpenViking': 39051,
  'anywhere-labs/dsh-desktop': 29640, 'titanwings/distilly': 25174, 'voyager-crew/voyager': 20273,
  'awesome-dsh-plugin/awesome-dsh-plugin': 17453, 'EverMind-AI/EverOS': 13313, 'MemTensor/MemOS': 11660,
  'dataelement/dsh-desktop': 11095, 'zhu1090093659/dsh-web': 8222, 'Tencent/BrowserSkill': 7960,
  'yjh051108/dsh-routing-suite': 6990, 'Devin-AXIS/iPolloWork': 6924, 'Q00/ouroboros': 6154,
  'loopx-project/loopx': 6117, 'dsh-market/dsh-market': 5135, 'zouyuxuan122/dsh-our-free-model': 503,
  'crafter-station/petdex': 4177, 'liustack/modlens': 4091, 'omdsh-dev/DSH-better-sidebar': 3926,
  'superdesigndev/treg': 3924, 'ccch1mneyyy/dsh-TUI': 3868, 'xiaobright/dsh-anchored-standard': 3783,
  'MeteorNOX/DeepSeek-Balance-Whale-Widget': 3669, 'oh-my-dsh/dsh-plugin-upgrade-skill': 148,
  'Sanqi-normal/dsh-webui-market-plugin': 105, 'WYH66666666/DSH-Transparent-UI-Plugin': 409,
  'LittleBlackTong/dsh-plugin-memory': 3, 'jipika/dsh-memory': 0, 'AzureHalcyon/dsh-deepseek-usage': 1,
}

// ── 本地缓存：data/stars.json（最新值） + data/history.json（每次运行一行）──
function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJson(file, value) {
  if (noWrite) return
  try {
    mkdirSync(DATA, { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
  } catch (e) { console.error('[warn] 写 ' + file + ' 失败：' + e.message) }
}

// ── 取数之三：GraphQL（有 token 时首选，一次请求拿全部）─────────────────
async function starsViaGraphQL(names) {
  if (!TOKEN) return null
  const out = {}
  for (let i = 0; i < names.length; i += 40) {
    const chunk = names.slice(i, i + 40)
    const fields = chunk.map((n, j) => {
      const [owner, name] = n.split('/')
      return `r${j}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)})`
        + ' { nameWithOwner stargazers { totalCount } pushedAt isArchived licenseInfo { spdxId } }'
    })
    let json
    try {
      const res = await fetch(GH + '/graphql', {
        method: 'POST',
        headers: { ...UA, authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'query {' + fields.join(' ') + '}' }),
      })
      if (!res.ok) { console.error('[warn] GraphQL HTTP ' + res.status + '，改用 REST'); return null }
      json = await res.json()
    } catch (e) { console.error('[warn] GraphQL 异常：' + e.message); return null }
    if (!json.data) { console.error('[warn] GraphQL 无数据' + (json.errors ? '：' + json.errors[0]?.message : '')); return null }
    for (const r of Object.values(json.data)) {
      if (!r || !r.nameWithOwner) continue
      out[r.nameWithOwner.toLowerCase()] = {
        stars: r.stargazers?.totalCount ?? null,
        pushed: r.pushedAt ? String(r.pushedAt).slice(0, 10) : null,
        license: r.licenseInfo?.spdxId || null,
        archived: !!r.isArchived,
      }
    }
  }
  return Object.keys(out).length ? out : null
}

// ── 取数之二：REST 逐个仓库（无 token 也能用，未认证 60 次/小时）──────────
async function starsViaRest(names) {
  const out = {}
  let i = 0
  let stopped = ''
  async function worker() {
    while (i < names.length && !stopped) {
      const n = names[i++]
      try {
        const res = await fetch(GH + '/repos/' + n, { headers: TOKEN ? { ...UA, authorization: 'Bearer ' + TOKEN } : UA })
        if (res.status === 403 || res.status === 429) { stopped = '配额受限 HTTP ' + res.status; return }
        if (!res.ok) continue
        const r = await res.json()
        out[String(r.full_name).toLowerCase()] = {
          stars: r.stargazers_count, pushed: (r.pushed_at || '').slice(0, 10),
          license: r.license?.spdx_id || null, archived: !!r.archived,
        }
      } catch { /* 单仓失败不影响整体 */ }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  if (stopped) console.error('[warn] ' + stopped + '，剩余仓库用快照')
  return out
}

// ── 新星扫描：topic 里有、但没进白名单的（过滤掉明显不是插件的）──────────
function looksLikeDSH(r) {
  const text = ((r.name || '') + ' ' + (r.description || '')).toLowerCase()
  return text.includes('dsh') || text.includes('harness') || text.includes('deepseek')
}
async function newcomers() {
  let json
  try {
    const res = await fetch(GH + '/search/repositories?q=' + encodeURIComponent('topic:dsh-plugin')
      + '&sort=stars&order=desc&per_page=40', { headers: TOKEN ? { ...UA, authorization: 'Bearer ' + TOKEN } : UA })
    if (!res.ok) { console.error('[warn] 新星扫描 HTTP ' + res.status); return [] }
    json = await res.json()
  } catch (e) { console.error('[warn] 新星扫描异常：' + e.message); return [] }
  const known = new Set(CURATED.map(([r]) => r.toLowerCase()))
  const black = new Set(NOT_PLUGINS.map(([r]) => r.toLowerCase()))
  return (json.items || [])
    .filter((r) => !known.has(r.full_name.toLowerCase()) && !black.has(r.full_name.toLowerCase()))
    .filter((r) => !r.archived && (r.stargazers_count || 0) >= 50 && looksLikeDSH(r))
    .slice(0, 6)
    .map((r) => ({ repo: r.full_name, stars: r.stargazers_count, pushed: (r.pushed_at || '').slice(0, 10), desc: (r.description || '').slice(0, 120) }))
}

// ── 历史：算"较上期"涨星 ────────────────────────────────────────────────
function priorStars(history, today) {
  const dates = Object.keys(history).filter((d) => d < today).sort()
  if (!dates.length) return { asOf: null, map: {} }
  const asOf = dates[dates.length - 1]
  return { asOf, map: history[asOf] || {} }
}

// ── 主流程 ─────────────────────────────────────────────────────────────
const names = CURATED.map(([r]) => r)
const live = (await starsViaGraphQL(names)) || (await starsViaRest(names))
const liveCount = Object.keys(live).length

const starsFile = resolve(DATA, 'stars.json')
const historyFile = resolve(DATA, 'history.json')
const saved = readJson(starsFile, {})
const history = readJson(historyFile, {})
// 与周报同口径：按北京时间切期（UTC 日期在晚上会落到前一天）
const BJT = (d = new Date()) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
const today = BJT()
const prior = priorStars(history, today)

const rows = CURATED.map(([repo, name, cn, cat, kind]) => {
  const key = repo.toLowerCase()
  const hit = live[key]
  const memo = saved[key] || saved[repo]
  const snap = SNAPSHOT[repo]
  const stars = hit?.stars ?? memo?.stars ?? snap ?? null
  const source = hit ? 'live' : (memo ? 'cache' : (snap !== undefined ? 'snapshot' : 'none'))
  const prev = prior.map[repo] ?? prior.map[key]
  return {
    repo, name, cn, cat, kind,
    stars,
    starsSource: source,
    asOf: hit ? today : (memo?.asOf || (snap !== undefined ? SNAPSHOT_ASOF : null)),
    delta: typeof stars === 'number' && typeof prev === 'number' ? stars - prev : null,
    pushed: hit?.pushed ?? memo?.pushed ?? null,
    license: hit?.license ?? memo?.license ?? null,
    archived: hit?.archived ?? false,
  }
}).sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1))

const fresh = await newcomers()

// 落盘：最新快照 + 历史（历史保留最近 40 次）
const merged = {}
for (const r of rows) {
  if (r.stars === null) continue
  merged[r.repo.toLowerCase()] = { stars: r.stars, pushed: r.pushed, license: r.license, asOf: r.asOf }
}
merged._meta = { updatedAt: new Date().toISOString(), liveCount, token: TOKEN ? 'yes' : 'no' }
if (liveCount > 0 || !existsSync(starsFile)) writeJson(starsFile, merged)

const todayMap = {}
for (const r of rows) if (r.stars !== null) todayMap[r.repo] = r.stars
history[today] = todayMap
const keep = Object.keys(history).sort().slice(-40)
writeJson(historyFile, Object.fromEntries(keep.map((d) => [d, history[d]])))

const payload = {
  generatedAt: new Date().toISOString(),
  liveCount,
  priorAsOf: prior.asOf,
  rows,
  notPlugins: NOT_PLUGINS.map(([repo, stars, why]) => ({ repo, stars, why })),
  fresh,
}

if (asJson) {
  console.log(JSON.stringify(payload))
} else {
  console.log('| ⭐ | 插件 | 中文说明 | 分类 | 形态 | 较上期 | 最近更新 | 许可 |')
  console.log('|---:|---|---|---|---|---:|---|---|')
  for (const r of rows) {
    const star = r.stars === null ? '—' : (r.stars >= 1000 ? (r.stars / 1000).toFixed(1) + 'k' : String(r.stars))
    const mark = r.starsSource === 'live' ? '' : (r.starsSource === 'none' ? '?' : '≈')
    const d = r.delta === null ? '—' : (r.delta > 0 ? '+' + r.delta : String(r.delta))
    console.log(`| ${star}${mark} | **${r.name}**<br>\`${r.repo}\` | ${r.cn} | ${r.cat} | ${r.kind} | ${d} | ${r.pushed || '—'} | ${r.license || '-'} |`)
  }
  console.error(`[统计] 白名单 ${rows.length} 项，实时 ${liveCount} 项，其余用快照（≈ 标记）；较上期基准 ${prior.asOf || '无（首次运行）'}`)
  if (fresh.length) console.error('[新星] 待审 ' + fresh.length + ' 项：' + fresh.map((f) => `${f.repo}★${f.stars}`).join(' / '))
}

process.exit(liveCount > 0 ? 0 : 2)
