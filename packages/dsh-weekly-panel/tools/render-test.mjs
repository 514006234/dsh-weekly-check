// dsh-weekly-panel — 客户端 UI 自检（不需要真实 react、不需要 DSH 进程、不联网）。
//
// v0.3.0（抽屉移除）后覆盖：
//   注册形态（main + sidebar.panellist，两扇门）、主面板结构（流内、无按钮、无浮层）、
//   加载中 / 数据到（摘要、TOP10 排序与星数格式化、涨星着色、0 与缺失不显示）、
//   免费模型 chips、赞助位（有/无）、失败态 + 重试、网络异常、畸形数据不崩、
//   TTL（反复挂载只打一次宿主半路由）、图标运行时（active 高亮、点击分岔、降级不抛）。
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
const clientSrc = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')

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
const rowsOf = (tree) => byClass(tree, 'dwp-row')

/* ── 夹具 ───────────────────────────────────────────────────────────────── */
function plugin(i, over = {}) {
  return Object.assign({
    repo: 'demo/plugin-' + i,
    name: '示例插件 ' + i,
    stars: 10000 - i * 500,
    delta: null,
    cn: '中文说明 ' + i,
    starsSource: 'live',
    kind: '原生bundle',
  }, over)
}
const PLUGINS = []
for (let i = 1; i <= 12; i += 1) PLUGINS.push(plugin(i))
PLUGINS[0] = plugin(1, { repo: 'nexu-io/open-design', name: 'OpenDesign 设计工作台', stars: 99046, delta: 2, kind: '外部' })
PLUGINS[1] = plugin(2, { repo: 'tt-a1i/archify', name: 'Archify 架构图', stars: 75670, delta: 0 })
PLUGINS[2] = plugin(3, { repo: 'volcengine/OpenViking', name: 'OpenViking 上下文库', stars: 39088, delta: -1 })
PLUGINS[11] = plugin(12, { repo: 'demo/tiny', name: '小插件', stars: 5 })

const STAT = { total: 11, ok: 6, limited: 1, region: 2, gone: 2, flaky: 1, retried: 3, ttfbFast: 1.48, ttfbMid: 3.07, ttfbSlow: 13.19 }
const SPONSORS = [{ repo: 'demo/paid-plugin', name: '付费示例插件', cn: '这是一条赞助推荐语', tier: '单期推荐', until: '2026-10-09' }]
const DATA = {
  date: '2026-10-02',
  generatedAt: '2026-10-02T00:21:17.000Z',
  plugins: PLUGINS,
  stat: STAT,
  models: [{ model: 'demo-free' }],
  sponsors: SPONSORS,
  newcomers: [],
}
const DATA_NO_SPONSOR = Object.assign({}, DATA, { sponsors: [] })

const hostOk = (data) => ({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, cached: false, stale: false, ageMs: 0, data }) })

/* ── 启动 + 挂载 ────────────────────────────────────────────────────────── */
function boot(options = {}) {
  hookState.length = 0
  cursor = 0
  pendingEffects = []
  effectRecords = []
  const fetchCalls = []
  const copied = []
  let record = null
  const sandbox = {
    console,
    setTimeout: (fn) => { fn(); return 0 },
    clearTimeout: () => {},
    // 一键安装要用剪贴板：桩里记下被复制的内容，好在断言里核对命令对不对
    navigator: { clipboard: { writeText: (text) => { copied.push(String(text)); return Promise.resolve() } } },
    fetch: (url, init) => {
      fetchCalls.push({ url: String(url), init: init || null })
      if (typeof options.fetch === 'function') return options.fetch(url, init)
      return Promise.resolve(hostOk(options.data === undefined ? DATA : options.data))
    },
    window: {
      __ModuleLoader__: { load(rec) { record = rec } },
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
  const regs = {}
  let cur = null
  const slots = {
    inject(key, cb) { cur = key; return cb() },
    register(opts, comp) { regs[cur] = { opts, comp }; return () => {} },
    entries() { return [] },
  }
  const baseCtx = { get: (n) => (n === 'slots' ? slots : undefined) }
  if (options.layout) baseCtx.layout = options.layout
  mod.apply(baseCtx)
  // v0.3.0：唯一内容组件挂在 main 槽
  const Component = regs['main'] ? regs['main'].comp : null
  return { Component, regs, fetchCalls, copied }
}

function mount(Component, props) {
  hookState.length = 0
  cursor = 0
  pendingEffects = []
  effectRecords = []
  const render = () => {
    cursor = 0
    const tree = expand(Component(props || {}))
    flushEffects()
    return tree
  }
  let tree = render()
  const api = {
    get tree() { return tree },
    rerender() { tree = render(); return tree },
    click(node) {
      node.props.onClick({ stopPropagation() {}, preventDefault() {}, key: 'Enter' })
      return api.rerender()
    },
    async settle() {
      await new Promise((resolve) => setImmediate(resolve))
      return api.rerender()   // 注意：settle 返回的是树本身
    },
  }
  return api
}

/* ── 断言 ───────────────────────────────────────────────────────────────── */
let failures = 0
let passed = 0
const ok = (label) => { passed += 1; console.log('  ✓ ' + label) }
const bad = (label) => { failures += 1; console.error('  ✗ ' + label) }
const expect = (cond, label) => (cond ? ok(label) : bad(label))

async function run() {
  console.log('[1] 注册形态：两扇门（main + 图标行），抽屉入口已移除')
  {
    const { regs } = boot()
    expect(regs['main'] && regs['main'].opts.key === 'dsh-weekly', 'main 槽 key = dsh-weekly')
    expect(regs['main'].opts.key !== 'conversation', '不占用保留 key conversation')
    expect(regs['sidebar.panellist'] && regs['sidebar.panellist'].opts.id === 'dsh-weekly', 'panellist id 与 main.key 同值')
    expect(regs['sidebar.panellist'].opts.order === 15, 'panellist order = 15')
    expect(String(regs['sidebar.panellist'].opts.label).includes('周榜'), 'panellist label 含「周榜」')
    expect(!regs['sidebar.footer.action'], '不再注册 sidebar.footer.action（底部入口已按要求去掉）')
  }

  console.log('[2] 主面板结构：流内布局、无按钮、无浮层、窄窗约束在位')
  {
    const { Component } = boot()
    const view = mount(Component, {})
    const tree = await view.settle()
    expect(byClass(tree, 'dwp-main').length === 1, '根容器是 .dwp-main（中间整列）')
    expect(byClass(tree, 'dwp-panel').length === 1, '有面板主体 .dwp-panel')
    expect(byClass(tree, 'dwp-btn').length === 0, '不再渲染抽屉按钮')
    expect(byClass(tree, 'dwp-badge').length === 0, '不再渲染抽屉角标')
    expect(byClass(tree, 'is-float').length === 0 && byClass(tree, 'is-rail').length === 0, '无浮层/rail 类')
    const cssText = (clientSrc.match(/var CSS = \[([\s\S]*?)\]\.join\(''\)/) || ['', ''])[1]
    expect(!/position:fixed/.test(cssText.replace(/\/\*[\s\S]*?\*\//g, '')), 'CSS 里零处固定定位（不遮挡对话的硬保证）')
    expect(/min\(1100px,\s*100%\)/.test(cssText) && /min\(260px,\s*100%\)/.test(cssText), '窄窗 min() 约束在位（未最大化不裁切）')
    expect(/min-height:60px/.test(cssText), '卡片行加高（min-height:60px）')
  }

  console.log('[3] 加载中 → 挂载即取一次数据')
  {
    const { Component, fetchCalls } = boot()
    const view = mount(Component, {})
    expect(textOf(view.tree).includes('正在读取周报'), '首帧显示加载文案')
    const tree = await view.settle()
    expect(fetchCalls.length === 1, '挂载即请求一次宿主半路由，实际 ' + fetchCalls.length)
    expect(fetchCalls[0].url.includes('/weekly-panel/data'), '请求打在 /weekly-panel/data 上')
    expect(!textOf(tree).includes('正在读取周报'), '数据到后加载文案消失')
  }

  console.log('[4] 数据到：摘要 + TOP10 排序/格式化/涨星着色')
  {
    const { Component } = boot()
    const view = mount(Component, {})
    const tree = await view.settle()
    const text = textOf(tree)
    expect(text.includes('12 个插件'), '摘要显示插件总数 12')
    expect(text.includes('更新 2026-10-02'), '摘要显示更新日期')
    expect(text.includes('插件 TOP 10'), '有 TOP10 小标题')
    const rows = rowsOf(tree)
    expect(rows.length === 10, '渲染 10 行（12 个里取前 10），实际 ' + rows.length)
    const firstName = textOf(rows[0])
    expect(firstName.includes('OpenDesign 设计工作台'), '第 1 名是星数最高的 OpenDesign')
    expect(firstName.includes('99046') === false && firstName.includes('99.0k'), '星数格式化 99046 → 99.0k')
    const delta2 = byClass(rows[0], 'dwp-delta')
    expect(delta2.length === 1 && textOf(rows[0]).includes('+2'), 'delta 2 显示为 +2')
    expect(String(delta2[0].props.className).includes('is-up'), '正涨星是绿色 is-up')
    const archify = rows.find((r) => textOf(r).includes('Archify'))
    expect(!textOf(archify).includes('+0') && byClass(archify, 'dwp-delta').length === 0, 'delta 0 不渲染（不显示 +0）')
    const viking = rows.find((r) => textOf(r).includes('OpenViking'))
    const vd = byClass(viking, 'dwp-delta')
    expect(vd.length === 1 && String(vd[0].props.className).includes('is-down'), '负 delta 是 is-down')
    const links = byClass(tree, 'dwp-repo')
    expect(links.length === 11, 'TOP10 + 赞助卡各一条仓库链接，实际 ' + links.length)
    expect(links[0].props.href.includes('github.com/nexu-io/open-design'), '第一条仓库链接指向正确 GitHub 地址')
    expect(links[0].props.target === '_blank', '链接新开标签')
  }

  console.log('[5] 免费模型 chips')
  {
    const { Component } = boot()
    const view = mount(Component, {})
    const tree = await view.settle()
    const text = textOf(tree)
    expect(text.includes('免费模型'), '有免费模型区')
    expect(text.includes('可用') && text.includes('6/11'), '可用 6/11')
    expect(text.includes('已下线') && text.includes('2'), '已下线数量')
    expect(text.includes('地区墙'), '地区墙 chip')
    expect(text.includes('限流'), '限流 >0 时显示')
    expect(text.includes('上游波动'), '上游波动 >0 时显示')
  }

  console.log('[6] 推荐位：付费标「赞助」、免费互推标「互推」')
  {
    const { Component } = boot()
    const view = mount(Component, {})
    const tree = await view.settle()
    const text = textOf(tree)
    expect(text.includes('本期推荐'), '有推荐位小节标题')
    expect(byClass(tree, 'dwp-sponsor-badge').length >= 1, '推荐位卡片带徽标')
    expect(text.includes('付费示例插件'), '显示推荐方名称')
    expect(text.includes('这是一条赞助推荐语'), '显示推荐语')
    expect(text.includes('单期推荐'), '显示档位')
    // 付费那条：必须是「赞助」，且不能出现「互推」
    const paidCard = byClass(tree, 'dwp-sponsor')[0]
    expect(paidCard && textOf(paidCard).includes('赞助'), '付费档标「赞助」')
    expect(paidCard && !textOf(paidCard).includes('互推'), '付费档不会标成「互推」')
  }

  console.log('[6b] 推荐位：免费互推那条必须标「互推」，不能写成「赞助」')
  {
    const withRecip = Object.assign({}, DATA, {
      sponsors: [
        Object.assign({}, SPONSORS[0]),
        { repo: 'demo/free-plugin', name: '互推示例插件', cn: '这是一条互推推荐语', kind: 'reciprocal', tier: '免费互推', until: '2026-10-09' },
      ],
    })
    const { Component } = boot({ data: withRecip })
    const view = mount(Component, {})
    const tree = await view.settle()
    const cards = byClass(tree, 'dwp-sponsor')
    expect(cards.length === 2, '两条推荐位都渲染，实际 ' + cards.length)
    const recipCard = cards.map(textOf).find((t) => t.includes('互推示例插件')) || ''
    expect(recipCard.includes('互推'), '互推档带「互推」字样')
    expect(!recipCard.includes('赞助'), '互推档**不能**出现「赞助」字样（没付钱就不能写成赞助）')
    expect(byClass(tree, 'is-recip').length === 1, '互推徽章用中性色 class=is-recip')
  }

  console.log('[7] 推荐位：没有推荐 → 不出现该小节')
  {
    const { Component } = boot({ data: DATA_NO_SPONSOR })
    const view = mount(Component, {})
    const tree = await view.settle()
    expect(!textOf(tree).includes('本期推荐'), '空 sponsors 不渲染推荐小节')
    expect(byClass(tree, 'dwp-sponsor-badge').length === 0, '没有推荐徽标')
    expect(byClass(tree, 'dwp-row').length === 10, '其它内容不受影响')
  }

  console.log('[8] 失败态：宿主半 ok:false → 中文提示 + 原因 + 重试成功恢复')
  {
    let calls = 0
    const { Component } = boot({
      fetch: () => {
        calls += 1
        if (calls === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, reason: '上游 503 抽风' }) })
        return Promise.resolve(hostOk(DATA))
      },
    })
    const view = mount(Component, {})
    const tree = await view.settle()
    const text = textOf(tree)
    expect(text.includes('暂时拿不到周报数据'), '失败时显示中文标题')
    expect(text.includes('上游 503 抽风'), '失败原因透出')
    const retry = byClass(tree, 'dwp-retry')
    expect(retry.length === 1, '有重试按钮')
    view.click(retry[0])
    await view.settle()
    const recovered = view.rerender()
    expect(byClass(recovered, 'dwp-row').length === 10, '重试成功后正常渲染数据')
    expect(!textOf(recovered).includes('暂时拿不到周报数据'), '失败提示消失')
  }

  console.log('[9] 网络异常（fetch reject）→ 提示不崩')
  {
    const { Component } = boot({ fetch: () => Promise.reject(new Error('网络断了')) })
    const view = mount(Component, {})
    const tree = await view.settle()
    const text = textOf(tree)
    expect(text.includes('暂时拿不到周报数据'), '网络异常也走失败态')
    expect(text.includes('网络断了'), '异常信息透出')
    expect(byClass(tree, 'dwp-retry').length === 1, '仍提供重试按钮')
  }

  console.log('[10] 畸形数据（字段缺失）不崩')
  {
    const { Component } = boot({ data: { date: '2026-10-02' } })
    const view = mount(Component, {})
    const tree = await view.settle()
    expect(tree !== null && tree !== undefined, '面板仍在（没白屏）')
    const text = textOf(tree)
    expect(text.includes('0 个插件'), '缺 plugins → 显示 0 个插件而不是崩溃')
    expect(!text.includes('null') && !text.includes('undefined'), '不把 null/undefined 漏到界面上')
    expect(byClass(tree, 'dwp-retry').length === 0, '成功但空数据不算失败态')
  }

  console.log('[11] TTL：反复挂载只打一次宿主半路由')
  {
    const { Component, fetchCalls } = boot()
    const v1 = mount(Component, {})
    await v1.settle()
    const v2 = mount(Component, {})
    await v2.settle()
    const v3 = mount(Component, {})
    await v3.settle()
    expect(fetchCalls.length === 1, '三次挂载仍只请求一次（5 分钟客户端 TTL），实际 ' + fetchCalls.length)
    expect(byClass(v3.tree, 'dwp-row').length === 10, '每次挂载都有完整数据')
  }

  console.log('[12] 图标行运行时：active 高亮 + 点击分岔 + 降级不抛')
  {
    const { regs } = boot()
    const iconComp = regs['sidebar.panellist'].comp
    const iconOn = iconComp({ size: 24, active: true })
    expect(String((iconOn.props.style || {}).border || '').includes('3b82f6'), 'active 图标有高亮边框')
    expect(iconOn.props.style.width === '24px' && iconOn.props.style.height === '24px', '图标按宿主给的 size 等尺寸')
    const iconOff = iconComp({ size: 24, active: false })
    expect(String((iconOff.props.style || {}).border || '').includes('transparent'), '非 active 图标边框透明')
    expect(typeof iconOn.props.onClick === 'function', '图标自带 onClick 双保险')

    let iconClicked = null
    const withLayout = boot({ layout: { selectPanel(k) { iconClicked = k } } })
    withLayout.regs['sidebar.panellist'].comp({ size: 20, active: false })
      .props.onClick({ stopPropagation() {}, preventDefault() {} })
    expect(iconClicked === 'dsh-weekly', '有 layout 时点击切到 dsh-weekly')

    let iconErr = null
    try { iconOn.props.onClick({ stopPropagation() {}, preventDefault() {} }) } catch (err) { iconErr = err }
    expect(iconErr === null, '无 layout 点击不许抛：' + (iconErr && iconErr.message))

    let iconThrow = null
    try {
      const throwing = boot({ layout: { selectPanel() { throw new Error('面板未注册') } } })
      throwing.regs['sidebar.panellist'].comp({ size: 20, active: false })
        .props.onClick({ stopPropagation() {}, preventDefault() {} })
    } catch (err) { iconThrow = err }
    expect(iconThrow === null, 'selectPanel 抛异常也被吞掉：' + (iconThrow && iconThrow.message))
  }

  console.log('[13] 一键安装：只有「原生bundle」给命令，点击复制 dsh plugin add <repo>')
  {
    const { Component, copied } = boot()
    const view = mount(Component, {})
    const tree = await view.settle()
    const rows = rowsOf(tree)
    const installs = byClass(tree, 'dwp-install')
    expect(installs.length === 9 && rows.length === 10, '10 行里 9 行是可装的原生bundle，实际按钮 ' + installs.length + ' 个')
    const openRow = rows.find((r) => JSON.stringify(r).includes('nexu-io/open-design'))
    expect(!!openRow && byClass(openRow, 'dwp-install').length === 0, '外部形态（OpenDesign）不给安装命令——不给跑不通的命令')

    const btn = installs[0]
    const title = String((btn.props || {}).title || '')
    expect(/^复制安装命令：dsh plugin add [\w.-]+\/[\w.-]+$/.test(title), '按钮提示里带完整命令：' + title)
    const fake = { textContent: '装', dataset: {}, classList: { add() {}, remove() {} } }
    btn.props.onClick({ currentTarget: fake })
    expect(copied.length === 1, '点击后确实调用了剪贴板 API，实际 ' + copied.length + ' 次')
    expect(copied[0] === title.replace('复制安装命令：', ''), '复制出去的就是那条命令：' + copied[0])

    // 没有剪贴板 API 时必须降级到 prompt，而不是抛异常炸掉面板
    const noClip = boot({ data: DATA })
    const v2 = mount(noClip.Component, {})
    const tree2 = await v2.settle()
    const btn2 = byClass(tree2, 'dwp-install')[0]
    let threw = null
    try { btn2.props.onClick({ currentTarget: fake }) } catch (err) { threw = err }
    expect(threw === null, '剪贴板不可用时安静降级（不抛）：' + (threw && threw.message))
  }

  console.log('')
  if (failures) { console.error('RENDER TEST FAILED（通过 ' + passed + ' / 失败 ' + failures + '）'); process.exit(1) }
  console.log('RENDER TEST OK（' + passed + ' assertions）')
}

await run()
