// dsh-dashboard — 客户端 UI 自检（不需要真实 react、不需要 DSH 进程、不联网）。
//
// 覆盖（断言数 ≥ 35）：
//   panellist 注册参数（id/order/label）与 main key 正确、图标行 size/active 高亮、
//   TOP6 渲染与星数排序、涨星绿色且不显示 0、免费模型大数字与小字、
//   最近会话 3 条（标题+工作区名）与点击打开的优先级、latest 失败态+重试、
//   sessions 缺失占位、三个快捷动作的点击（selectPanel 成功 / 缺失→window.open /
//   抛异常不崩）、支持卡链接、面板骨架与数据路由。
//
// 为什么用假 react：本机 react 只存在于 Electron 的 app.asar 内，磁盘上取不到。
// 桩里实现了 useState / useEffect（带依赖比较）与手动重渲染，因此能模拟点击与异步加载。
//
// 用法：node tools/render-test.mjs   （退出码 0 = 全绿）

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, Script } from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientSrc = readFileSync(join(ROOT, 'lib/client.js'), 'utf8')

const SITE_URL = 'https://514006234.github.io/dsh-weekly-check/'
const SPONSOR_URL = 'https://514006234.github.io/dsh-weekly-check/sponsor/'

/* ── 极小 react 桩（含依赖比较的 useEffect）──────────────────────────── */
const hookState = []
let cursor = 0
let pendingEffects = []
let effectRecords = []

const ReactStub = {
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props)
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { __el: true, type, props: merged }
  },
  useState(init) {
    const at = cursor++
    if (!(at in hookState)) hookState[at] = typeof init === 'function' ? init() : init
    return [hookState[at], (next) => { hookState[at] = typeof next === 'function' ? next(hookState[at]) : next }]
  },
  useEffect(fn, deps) { pendingEffects.push({ fn, deps }) },
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
}

function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false
  return true
}

function flushEffects() {
  const pending = pendingEffects
  pendingEffects = []
  pending.forEach((effect, index) => {
    const previous = effectRecords[index]
    if (previous && effect.deps !== undefined && sameDeps(previous.deps, effect.deps)) return
    if (previous && typeof previous.cleanup === 'function') previous.cleanup()
    const cleanup = effect.fn()
    effectRecords[index] = { deps: effect.deps, cleanup }
  })
}

/* ── 元素树工具 ─────────────────────────────────────────────────────────── */
function expand(node) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(expand).filter((x) => x !== null)
  if (node.__el) {
    if (typeof node.type === 'function') return expand(node.type(node.props || {}))
    return { tag: node.type, props: node.props, children: expand(node.props && node.props.children) }
  }
  return null
}

function walk(node, visit) {
  if (node === null || node === undefined || node === false || node === true) return
  if (typeof node === 'string') { visit({ text: node }); return }
  if (Array.isArray(node)) { for (const c of node) walk(c, visit); return }
  visit({ tag: node.tag, props: node.props, children: node.children })
  walk(node.children, visit)
}

function textOf(node) {
  const out = []
  walk(node, (n) => { if (n.text !== undefined) out.push(n.text) })
  return out.join('')
}

function findAll(node, pred, out = []) {
  walk(node, (n) => { if (n.tag && pred(n)) out.push(n) })
  return out
}

const hasToken = (node, token) => String(node.props.className || '').split(/\s+/).includes(token)
const byClass = (tree, token) => findAll(tree, (n) => hasToken(n, token))
const classNames = (node) => String((node && node.props && node.props.className) || '')

/** 找到包含指定文案的卡片（用来把「周榜卡」和「会话卡」的行分开）。 */
function cardByText(tree, token) {
  return byClass(tree, 'dd-card').find((c) => textOf(c).includes(token)) || null
}
/** 在某棵子树里按文案找按钮。 */
function btnByText(tree, token, cls) {
  return byClass(tree, cls || 'dd-act').find((b) => textOf(b).includes(token)) || null
}
function click(node) {
  node.props.onClick({ stopPropagation() {}, preventDefault() {}, key: 'Enter' })
}

/* ── 夹具（全部对应 latest.json / 会话快照的真实字段）────────────────────── */
function plugin(i, over = {}) {
  return Object.assign({
    repo: 'demo/plugin-' + i,
    name: '示例插件 ' + i,
    stars: 10000 - i * 500,
    delta: null,
    cn: '中文说明 ' + i,
    starsSource: 'live',
  }, over)
}
const PLUGINS = []
for (let i = 1; i <= 12; i += 1) PLUGINS.push(plugin(i))
PLUGINS[0] = plugin(1, { repo: 'nexu-io/open-design', name: 'OpenDesign 设计工作台', stars: 99046, delta: 2 })
PLUGINS[1] = plugin(2, { repo: 'tt-a1i/archify', name: 'Archify 架构图', stars: 75670, delta: 0 })
PLUGINS[2] = plugin(3, { repo: 'volcengine/OpenViking', name: 'OpenViking 上下文库', stars: 39088, delta: -1 })
PLUGINS[11] = plugin(12, { repo: 'demo/tiny', name: '小插件', stars: 5 })

const STAT = { total: 11, ok: 6, limited: 1, region: 2, gone: 2, flaky: 1, retried: 3, ttfbFast: 1.48, ttfbMid: 3.07, ttfbSlow: 13.19 }
const DATA = {
  date: '2026-10-02',
  generatedAt: '2026-10-02T00:21:17.000Z',
  plugins: PLUGINS,
  stat: STAT,
  models: [{ model: 'demo-free' }],
  sponsors: [],
  newcomers: [],
}

const WORKSPACES = {
  items: [
    { path: 'D:/ds工作区', title: 'ds工作区' },
    { path: 'D:/proj/alpha', title: 'Alpha 项目' },
  ],
  archivedSessionIds: [],
}
// ids 故意乱序 + 混入子 agent / 草稿，验证过滤与按 updatedAt 降序
const SESSIONS = {
  ids: ['s5', 'sub1', 's1', 's3', 'blank1', 's4', 's2'],
  byId: {
    s1: { id: 's1', title: '修复仪表盘布局', cwd: 'D:/ds工作区', updatedAt: 1000 },
    s2: { id: 's2', title: '调研槽位注册表', cwd: 'D:/proj/alpha', updatedAt: 5000 },
    s3: { id: 's3', title: '写周报生成脚本', cwd: 'D:/ds工作区', updatedAt: 9000 },
    s4: { id: 's4', title: '整理发布说明', cwd: 'D:/outside/repo', updatedAt: 7000 },
    s5: { id: 's5', title: '旧会话不该出现', cwd: 'D:/ds工作区', updatedAt: 100 },
    sub1: { id: 'sub1', title: '子任务会话', origin: 'subagent', cwd: 'D:/ds工作区', updatedAt: 99000 },
    blank1: { id: 'blank1', title: '草稿', blank: true, cwd: 'D:/ds工作区', updatedAt: 98000 },
  },
}

const hostOk = (data) => ({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, cached: false, stale: false, ageMs: 0, data }) })
const jsonRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })

/* ── 启动 + 挂载 ────────────────────────────────────────────────────────── */
function boot(options = {}) {
  hookState.length = 0
  cursor = 0
  pendingEffects = []
  effectRecords = []
  const fetchCalls = []
  const opened = []
  let record = null
  const sandbox = {
    console,
    setTimeout: (fn) => { fn(); return 0 },
    clearTimeout: () => {},
    fetch: (url, init) => {
      fetchCalls.push({ url: String(url), init: init || null })
      if (typeof options.fetch === 'function') return options.fetch(url, init)
      return Promise.resolve(hostOk(options.data === undefined ? DATA : options.data))
    },
    window: {
      __ModuleLoader__: { load(rec) { record = rec } },
      // 降级出口：selectPanel 不可用时的回落目标，全部记账供断言
      open: (url) => { opened.push(String(url)); return null },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  }
  new Script(clientSrc, { filename: 'lib/client.js' }).runInContext(createContext(sandbox), { timeout: 10000 })
  const mod = record.factory((id) => {
    if (id !== 'react') throw new Error('unexpected require: ' + id)
    return ReactStub
  })

  // 假 ctx：slots（第一段）+ 可选 layout / 服务面
  const regs = {}
  const injected = []
  const slots = {
    inject(key, cb) { injected.push(key); return cb() },
    register(opts, comp) { regs[opts.name] = { opts, comp }; return () => {} },
    entries() { return [] },
  }
  const services = options.services || {}
  const ctx = {
    get(name, strict) {
      if (name === 'slots') return slots
      if (strict === false && options.lazy && options.lazy[name] !== undefined) return options.lazy[name]
      return services[name]
    },
  }
  if (options.layout !== undefined) ctx.layout = options.layout
  for (const key of Object.keys(options.ctxProps || {})) ctx[key] = options.ctxProps[key]
  mod.apply(ctx)

  const main = regs['main']
  const icon = regs['sidebar.panellist']
  if (!main || !icon) throw new Error('双槽注册缺失：' + Object.keys(regs).join(','))
  const face = main.opts.inject()

  // 标准 props：sessions / workspaces 快照 hook（null = 框架没给这个 prop）
  const sessions = 'sessions' in options ? options.sessions : SESSIONS
  const workspaces = 'workspaces' in options ? options.workspaces : WORKSPACES
  const std = {}
  if (sessions !== null) std.useSessions = (sel) => sel(sessions)
  if (workspaces !== null) std.useWorkspaces = (sel) => sel(workspaces)

  return {
    Main: main.comp,
    Icon: icon.comp,
    mainOpts: main.opts,
    iconOpts: icon.opts,
    injected,
    face,
    std,
    fetchCalls,
    opened,
    ctx,
  }
}

function mount(Component, props) {
  hookState.length = 0
  cursor = 0
  pendingEffects = []
  effectRecords = []
  const render = () => {
    cursor = 0
    const tree = expand(Component(props))
    flushEffects()
    return tree
  }
  let tree = render()
  const api = {
    get tree() { return tree },
    rerender() { tree = render(); return tree },
    click(node) {
      click(node)
      return api.rerender()
    },
    async settle() {
      await new Promise((resolve) => setImmediate(resolve))
      return api.rerender()
    },
  }
  return api
}

const mainProps = (booted, over = {}) => Object.assign({}, booted.std, booted.face, over)

/* ── 断言 ───────────────────────────────────────────────────────────────── */
let failures = 0
let passed = 0
const ok = (label) => { passed += 1; console.log('  \u2713 ' + label) }
const bad = (label) => { failures += 1; console.error('  \u2717 ' + label) }
const expect = (cond, label) => (cond ? ok(label) : bad(label))

async function run() {
  console.log('[1] 双槽注册契约：main(key) + sidebar.panellist(id 同值)')
  {
    const booted = boot()
    expect(booted.injected.includes('main') && booted.injected.includes('sidebar.panellist'), '依次 inject main 与 sidebar.panellist')
    expect(booted.mainOpts.name === 'main', "main 注册 name = 'main'")
    expect(booted.mainOpts.key === 'dsh-dashboard', 'main 注册 key = dsh-dashboard')
    expect(booted.iconOpts.name === 'sidebar.panellist', "panellist 注册 name = 'sidebar.panellist'")
    expect(booted.iconOpts.id === 'dsh-dashboard', 'panellist 注册 id = dsh-dashboard')
    expect(booted.iconOpts.id === booted.mainOpts.key, 'panellist.id 与 main.key 同值（Each list id addresses the matching main panel）')
    expect(booted.iconOpts.order === 100, 'order = 100（升序）')
    expect(booted.iconOpts.label === '仪表盘', 'label = 仪表盘')
    expect(typeof booted.Main === 'function' && typeof booted.Icon === 'function', '两个槽位组件都是函数')
    expect(typeof booted.face.dashJump === 'function' && typeof booted.face.dashOpenSession === 'function' && typeof booted.face.dashCreateSession === 'function', '注入面三件套齐全')
  }

  console.log('[2] 侧边栏图标行：size 等尺寸自绘 + active 高亮')
  {
    const booted = boot()
    const idle = mount(booted.Icon, { size: 18, active: false })
    const ico = byClass(idle.tree, 'dd-ico')
    expect(ico.length === 1, '渲染出 .dd-ico 图标容器')
    expect(classNames(ico[0]).includes('is-active') === false, '未选中时不高亮')
    expect(ico[0].props.style.width === '18px' && ico[0].props.style.height === '18px', '按 ownerProps.size 画等尺寸图标（18×18）')
    const svg = byClass(idle.tree, 'dd-ico').length === 1 && findAll(idle.tree, (n) => n.tag === 'svg').length === 1
    expect(svg, '图标内容是自绘内联 SVG（无外部字体/图片）')
    expect(findAll(idle.tree, (n) => n.tag === 'rect').length === 4, 'SVG 四格，纯路径绘制')

    const active = mount(booted.Icon, { size: 24, active: true })
    const ico2 = byClass(active.tree, 'dd-ico')[0]
    expect(classNames(ico2).includes('is-active'), 'active=true → is-active 高亮')
    expect(ico2.props.style.width === '24px', 'size=24 → 24px 宽')

    const bare = mount(booted.Icon, {})
    expect(byClass(bare.tree, 'dd-ico')[0].props.style.width === '24px', '缺 size 时默认 24px（不崩）')
  }

  console.log('[3] 面板骨架 + 数据只打宿主半路由')
  {
    const booted = boot()
    const view = mount(booted.Main, mainProps(booted))
    const first = view.tree
    expect(byClass(first, 'dd-root').length === 1, '渲染出面板根 .dd-root')
    expect(byClass(first, 'dd-grid').length === 1, '卡片网格 .dd-grid 存在')
    expect(textOf(first).includes('DSH 仪表盘'), '面板标题「DSH 仪表盘」')
    expect(textOf(first).includes('正在读取周报…'), '首帧显示加载中文案')
    const tree = await view.settle()
    expect(booted.fetchCalls.length === 1, '挂载即取一次数据')
    expect(booted.fetchCalls[0].url === '/dashboard/data', '请求打在宿主半只读路由 /dashboard/data')
    expect(booted.fetchCalls[0].init && booted.fetchCalls[0].init.credentials === 'same-origin', '同源凭据')
    expect(textOf(tree).includes('更新 2026-10-02'), '数据到后显示更新时间')
  }

  console.log('[4] 周榜 TOP 6：渲染、排序、星数格式化、涨星绿色且不显示 0')
  {
    const booted = boot()
    const view = mount(booted.Main, mainProps(booted))
    const tree = await view.settle()
    const card = cardByText(tree, '周榜 TOP 6')
    expect(card !== null, '有「周榜 TOP 6」卡片')
    const rows = byClass(card, 'dd-row')
    expect(rows.length === 6, '只列 6 行，实际 ' + rows.length)
    const first = textOf(rows[0])
    expect(first.includes('OpenDesign 设计工作台'), '第 1 行有中文名')
    expect(first.includes('nexu-io/open-design'), '第 1 行有 owner/repo')
    expect(first.includes('99.0k'), '第 1 行星数格式化（99046 → 99.0k）')
    expect(textOf(rows[1]).includes('75.7k'), '第 2 行 = 75670 → 75.7k（按星数降序）')
    expect(textOf(rows[5]).includes('示例插件 6'), '第 6 行是星数第 6 的插件')
    expect(!textOf(card).includes('小插件'), '星数最少的第 12 名不进 TOP6')

    const deltas = byClass(card, 'dd-delta')
    expect(deltas.length === 2, '只渲染 2 个 delta（delta:0 与缺失都不显示），实际 ' + deltas.length)
    const up = byClass(card, 'is-up')
    expect(up.length === 1 && textOf(up[0]) === '+2', '正涨星 +2 带 is-up（绿色）')
    const down = byClass(card, 'is-down')
    expect(down.length === 1 && textOf(down[0]) === '-1', '下跌 -1 带 is-down')
    expect(!textOf(card).includes('0 个'), 'delta:0 的行不显示 0（避免把「没变化」当「持平」）')
  }

  console.log('[5] 点周榜行：selectPanel 成功 → 切 dsh-weekly；缺失/抛异常 → window.open')
  {
    // (a) 切面板成功
    const picked = []
    const a = boot({ layout: { selectPanel: (k) => picked.push(k) } })
    const va = mount(a.Main, mainProps(a))
    const ta = await va.settle()
    const rowA = byClass(cardByText(ta, '周榜 TOP 6'), 'dd-row')[0]
    const afterA = va.click(rowA)
    expect(picked.length === 1 && picked[0] === 'dsh-weekly', '点击第 1 行 → selectPanel("dsh-weekly")')
    expect(a.opened.length === 0, '切面板成功时不开网页')

    // (b) layout 面缺失 → 回落 window.open
    const b = boot({})
    const vb = mount(b.Main, mainProps(b))
    const tb = await vb.settle()
    vb.click(byClass(cardByText(tb, '周榜 TOP 6'), 'dd-row')[0])
    expect(b.opened.length === 1 && b.opened[0] === SITE_URL, 'selectPanel 缺失 → window.open 榜单网页')

    // (c) selectPanel 抛异常（官方对未注册 key 的行为）→ 吞掉并回落，不崩
    const c = boot({ layout: { selectPanel: () => { throw new Error('unknown panel key') } } })
    const vc = mount(c.Main, mainProps(c))
    let treeC = null
    let escaped = null
    try {
      const t = await vc.settle()
      treeC = vc.click(byClass(cardByText(t, '周榜 TOP 6'), 'dd-row')[0])
    } catch (err) { escaped = err }
    expect(escaped === null, 'selectPanel 抛异常不崩：' + (escaped && escaped.message))
    expect(c.opened.length === 1 && c.opened[0] === SITE_URL, '抛异常也回落到 window.open')
    expect(treeC !== null && textOf(treeC).includes('DSH 仪表盘'), '点击后面板照常渲染')
  }

  console.log('[6] 免费模型卡：大数字 + 已下线/地区墙/上游波动小字 + 点击跳转')
  {
    const picked = []
    const booted = boot({ layout: { selectPanel: (k) => picked.push(k) } })
    const view = mount(booted.Main, mainProps(booted))
    const tree = await view.settle()
    const card = cardByText(tree, '免费模型')
    expect(card !== null, '有免费模型卡')
    expect(classNames(card).includes('is-click'), '卡片可点（is-click，hover 有反馈）')
    expect(textOf(card).includes('6/11'), '大数字 = stat.ok/stat.total = 6/11')
    expect(textOf(card).includes('已下线 2'), '小字：已下线 2')
    expect(textOf(card).includes('地区墙 2'), '小字：地区墙 2')
    expect(textOf(card).includes('上游波动 1'), '小字：上游波动 1')
    click(card)
    expect(picked.length === 1 && picked[0] === 'dsh-weekly', '点卡 → 切到周榜面板')
  }

  console.log('[7] 最近会话卡：3 条（标题+工作区名）、过滤子 agent、点击打开')
  {
    const openedSessions = []
    const booted = boot({
      services: { uiWorkspace: { openSession: (id) => openedSessions.push('uiWorkspace:' + id) } },
    })
    const view = mount(booted.Main, mainProps(booted))
    const tree = await view.settle()
    const card = cardByText(tree, '最近会话')
    expect(card !== null, '有最近会话卡')
    const rows = byClass(card, 'dd-row')
    expect(rows.length === 3, '只列最近 3 条，实际 ' + rows.length)
    const texts = rows.map(textOf)
    expect(texts[0].includes('写周报生成脚本') && texts[0].includes('ds工作区'), '第 1 条 = updatedAt 最新的会话 + 工作区名')
    expect(texts[1].includes('整理发布说明') && texts[1].includes('工作区外'), '第 2 条：cwd 不在工作区 → 显示「工作区外」')
    expect(texts[2].includes('调研槽位注册表') && texts[2].includes('Alpha 项目'), '第 3 条：路径命中的工作区标题')
    expect(!textOf(card).includes('旧会话不该出现'), '第 4 条不显示')
    expect(!textOf(card).includes('子任务会话'), '子 agent 会话被过滤')
    expect(!textOf(card).includes('草稿'), '草稿会话被过滤')

    const after = view.click(rows[0])
    expect(openedSessions.length === 1 && openedSessions[0] === 'uiWorkspace:s3', '点击 → uiWorkspace.openSession(新会话优先)')
    expect(textOf(after).includes('已打开：写周报生成脚本'), '打开后 note 显示会话标题')
  }

  console.log('[8] 打开会话的降级：无 uiWorkspace → sessions.open；都没有 → note 报错不抛')
  {
    const order = []
    const b = boot({ services: { sessions: { open: (id) => order.push('sessions:' + id) } } })
    const vb = mount(b.Main, mainProps(b))
    const tb = await vb.settle()
    const rowsB = byClass(cardByText(tb, '最近会话'), 'dd-row')
    let escaped = null
    try { vb.click(rowsB[0]) } catch (err) { escaped = err }
    expect(escaped === null, '回落路径不抛：' + (escaped && escaped.message))
    expect(order.length === 1 && order[0] === 'sessions:s3', '回落到 sessions.open')

    const c = boot({})
    const vc = mount(c.Main, mainProps(c))
    const tc = await vc.settle()
    const afterC = vc.click(byClass(cardByText(tc, '最近会话'), 'dd-row')[0])
    expect(textOf(afterC).includes('打开会话失败'), '两个面都没有 → note 中文报错，不崩')
  }

  console.log('[9] sessions 缺失 → 会话卡占位，其它卡不受影响')
  {
    const booted = boot({ sessions: null })
    const view = mount(booted.Main, mainProps(booted))
    const tree = await view.settle()
    const card = cardByText(tree, '会话列表不可用')
    expect(card !== null, '会话卡显示「不可用」占位')
    expect(cardByText(tree, '周榜 TOP 6') !== null, '周榜卡照常渲染（不受影响）')
    expect(cardByText(tree, '快捷动作') !== null, '快捷动作卡照常渲染（不受影响）')
    expect(cardByText(tree, '支持本项目') !== null, '支持卡照常渲染（不受影响）')
  }

  console.log('[10] latest 拿不到 → 中文失败提示 + 重试按钮，重试成功后恢复')
  {
    let n = 0
    const booted = boot({
      fetch: () => {
        n += 1
        return Promise.resolve(n === 1 ? jsonRes({ ok: false, reason: '上游 HTTP 503' }) : hostOk(DATA))
      },
    })
    const view = mount(booted.Main, mainProps(booted))
    const tree = await view.settle()
    const fail = cardByText(tree, '暂时拿不到周报数据')
    expect(fail !== null, '失败态卡片渲染（不白屏）')
    expect(textOf(tree).includes('上游 HTTP 503'), '失败提示带具体原因')
    const retry = byClass(tree, 'dd-retry')
    expect(retry.length === 1, '提供「重试」按钮')
    expect(textOf(cardByText(tree, '最近会话')).includes('写周报生成脚本'), '数据失败不影响会话卡')

    view.click(retry[0])
    expect(n === 2, '点重试 → 再发一次请求，实际 ' + n)
    const done = await view.settle()
    expect(textOf(done).includes('OpenDesign 设计工作台'), '重试成功后渲染周榜数据')
    expect(!textOf(done).includes('暂时拿不到周报数据'), '成功后失败提示消失')
  }

  console.log('[11] 网络异常 / 畸形数据也要友好降级')
  {
    const net = boot({ fetch: () => Promise.reject(new Error('连接被拒绝')) })
    const vn = mount(net.Main, mainProps(net))
    const tn = await vn.settle()
    expect(textOf(tn).includes('暂时拿不到周报数据'), '网络异常 → 中文失败提示')
    expect(textOf(tn).includes('连接被拒绝'), '带上异常信息')

    const weird = boot({ data: { date: '2026-10-02' } })
    const vw = mount(weird.Main, mainProps(weird))
    const tw = await vw.settle()
    expect(byClass(tw, 'dd-root').length === 1, '畸形数据不崩（面板仍在）')
    expect(textOf(tw).includes('本期还没有插件数据'), '缺 plugins → 明确空提示')
    expect(textOf(tw).includes('免费模型数据暂缺'), '缺 stat → 明确说明而不是 0/0')
  }

  console.log('[12] 快捷动作：新会话 / 打开工作台 / 打开周榜（含降级）')
  {
    // 新会话：create(cwd, done) → 成功后自动打开
    const created = []
    const openedSessions = []
    const booted = boot({
      services: {
        sessions: { create: (input) => { created.push(input); return Promise.resolve('new-id') } },
        uiWorkspace: { openSession: (id) => openedSessions.push(id) },
      },
    })
    const view = mount(booted.Main, mainProps(booted))
    const tree = await view.settle()
    const btnNew = btnByText(tree, '新会话')
    expect(btnNew !== null, '有「＋ 新会话」按钮')
    view.click(btnNew)
    await new Promise((r) => setImmediate(r))
    const tree2 = await view.settle()
    expect(created.length === 1 && created[0].cwd === 'D:/ds工作区', '新会话沿用最近会话的工作目录，实际 ' + JSON.stringify(created))
    expect(openedSessions.includes('new-id'), '新建成功后自动打开新会话')
    expect(textOf(tree2).includes('已新建会话'), 'note 显示「已新建会话」')

    // 新会话（拿不到 cwd → 传空，按 sessions.create 语义降级）
    const createdEmpty = []
    const noSess = boot({ sessions: null, services: { sessions: { create: (input) => { createdEmpty.push(input); return Promise.resolve('x') } } } })
    const v2 = mount(noSess.Main, mainProps(noSess))
    const t2 = await v2.settle()
    v2.click(btnByText(t2, '新会话'))
    expect(createdEmpty.length === 1 && Object.keys(createdEmpty[0]).length === 0, '拿不到 cwd → create 收到空对象（不带 cwd 字段）')

    // 新会话：create 缺失 → done(err) → note 报错不抛
    const noCreate = boot({})
    const v3 = mount(noCreate.Main, mainProps(noCreate))
    const t3 = await v3.settle()
    let escaped = null
    try { v3.click(btnByText(t3, '新会话')) } catch (err) { escaped = err }
    expect(escaped === null, 'create 缺失时点击不抛：' + (escaped && escaped.message))
    expect(textOf(v3.tree).includes('新建失败'), 'note 显示「新建失败」')

    // 打开工作台 / 打开周榜：selectPanel 成功
    const picked = []
    const b2 = boot({ layout: { selectPanel: (k) => picked.push(k) } })
    const v4 = mount(b2.Main, mainProps(b2))
    const t4 = await v4.settle()
    v4.click(btnByText(t4, '打开工作台'))
    v4.click(btnByText(v4.tree, '打开周榜'))
    expect(picked.length === 2 && picked[0] === 'dsh-workbench' && picked[1] === 'dsh-weekly', '两个按钮分别切到 dsh-workbench / dsh-weekly，实际 ' + JSON.stringify(picked))

    // selectPanel 缺失 → window.open；抛异常 → 不崩也回落
    const b3 = boot({})
    const v5 = mount(b3.Main, mainProps(b3))
    const t5 = await v5.settle()
    v5.click(btnByText(t5, '打开工作台'))
    expect(b3.opened.length === 1 && b3.opened[0] === SITE_URL, 'selectPanel 缺失 → window.open')

    const b4 = boot({ layout: { selectPanel: () => { throw new Error('nope') } } })
    const v6 = mount(b4.Main, mainProps(b4))
    const t6 = await v6.settle()
    let escaped2 = null
    try { v6.click(btnByText(t6, '打开周榜')) } catch (err) { escaped2 = err }
    expect(escaped2 === null, 'selectPanel 抛异常不崩：' + (escaped2 && escaped2.message))
    expect(b4.opened.length === 1 && b4.opened[0] === SITE_URL, '抛异常也回落 window.open')
  }

  console.log('[13] 支持本项目卡：文案 + 打开赞助页')
  {
    const booted = boot()
    const view = mount(booted.Main, mainProps(booted))
    const tree = await view.settle()
    const card = cardByText(tree, '支持本项目')
    expect(card !== null, '有支持本项目小卡')
    expect(textOf(card).includes('咖啡'), '一句话文案存在')
    expect(classNames(card).includes('is-click'), '小卡可点')
    view.click(card)
    expect(booted.opened.length === 1 && booted.opened[0] === SPONSOR_URL, '点击 → window.open 赞助页')
  }

  console.log('')
  if (failures) { console.error('RENDER TEST FAILED（通过 ' + passed + ' / 失败 ' + failures + '）'); process.exit(1) }
  console.log('RENDER TEST OK（' + passed + ' assertions）')
}

await run()
