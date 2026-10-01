// dsh-weekly-panel — 客户端 UI 自检（不需要真实 react、不需要 DSH 进程、不联网）。
//
// 覆盖：侧边栏底部入口、角标=插件数、抽屉展开/收起、摘要（更新时间+插件数）、
// 插件 TOP10（中文名 / owner/repo / 星数 / 较上期涨星正数绿色）、免费模型可用性、
// 赞助位（有则显示且标注「赞助」、没有则不显示）、两个外链按钮、
// 加载中、请求失败（宿主半 ok:false）、网络异常、重试成功、畸形数据不崩、
// TTL 内反复开合不重复请求、侧边栏收起时退化为浮层。
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
const badgeOf = (tree) => byClass(tree, 'dwp-badge')[0]
const badgeText = (tree) => (badgeOf(tree) ? textOf(badgeOf(tree)) : '(无)')

/* ── 夹具 ───────────────────────────────────────────────────────────────── */
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

const hostOk = (data) => ({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, cached: false, stale: false, ageMs: 0, data }) })
const jsonRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })

/* ── 启动 + 挂载 ────────────────────────────────────────────────────────── */
function boot(options = {}) {
  hookState.length = 0
  cursor = 0
  pendingEffects = []
  effectRecords = []
  const writes = []
  const fetchCalls = []
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
      localStorage: {
        getItem: () => (options.open === undefined ? null : JSON.stringify({ open: options.open })),
        setItem: (k, v) => writes.push({ k, v }),
        removeItem: () => {},
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  }
  new Script(clientSrc, { filename: 'lib/client.js' }).runInContext(createContext(sandbox), { timeout: 10000 })
  const mod = record.factory((id) => {
    if (id !== 'react') throw new Error('unexpected require: ' + id)
    return ReactStub
  })
  let Component = null
  let registerOptions = null
  const slots = {
    inject(_key, cb) { return cb() },
    register(opts, comp) { registerOptions = opts; Component = comp; return () => {} },
    entries() { return [] },
  }
  mod.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
  return { Component, registerOptions, writes, fetchCalls }
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
      node.props.onClick({ stopPropagation() {}, preventDefault() {}, key: 'Enter' })
      return api.rerender()
    },
    async settle() {
      await new Promise((resolve) => setImmediate(resolve))
      return api.rerender()
    },
  }
  return api
}

const propsFor = (over = {}) => Object.assign({ wide: true }, over)

/* ── 断言 ───────────────────────────────────────────────────────────────── */
let failures = 0
let passed = 0
const ok = (label) => { passed += 1; console.log('  \u2713 ' + label) }
const bad = (label) => { failures += 1; console.error('  \u2717 ' + label) }
const expect = (cond, label) => (cond ? ok(label) : bad(label))

async function run() {
  console.log('[1] 收起态：侧边栏底部的入口 + 角标')
  {
    const booted = boot()
    const { Component, registerOptions } = booted
    const view = mount(Component, propsFor())
    expect(byClass(view.tree, 'dwp-btn').length === 1, '渲染出底部入口按钮')
    expect(byClass(view.tree, 'dwp-panel').length === 0, '默认不展开抽屉')
    expect(textOf(view.tree).includes('📊 周榜'), '按钮文字是「📊 周榜」')
    expect(badgeText(view.tree) === '…', '数据未到角标显示占位符')
    expect(registerOptions.order === 20, '注册 order = 20（workbench 是 15，不冲突）')
    const after = await view.settle()
    expect(badgeText(after) === '12', '数据到后角标 = 插件数 12（不用展开就能看见）')
    expect(booted.fetchCalls.length === 1, '挂载即取一次数据')
  }

  console.log('[2] 展开：摘要 + 插件 TOP 10')
  {
    const { Component } = boot()
    const view = mount(Component, propsFor())
    await view.settle()
    const tree = view.click(byClass(view.tree, 'dwp-btn')[0])
    expect(byClass(tree, 'dwp-panel').length === 1, '点按钮 → 抽屉展开')
    expect(byClass(tree, 'dwp-btn').some((b) => hasToken(b, 'is-open')), '展开态按钮有 is-open')
    expect(byClass(tree, 'dwp-head').length === 1, '有抽屉头（标题 + 提示）')
    const text = textOf(tree)
    expect(text.includes('DSH 插件周榜'), '抽屉标题')
    expect(text.includes('12 个插件'), '摘要显示插件总数')
    expect(text.includes('更新 2026-10-02'), '摘要显示更新时间')
    expect(text.includes('插件 TOP 10'), 'TOP 10 小标题')

    const rows = rowsOf(tree)
    expect(rows.length === 10, 'TOP 只列 10 条（本期 12 个插件），实际 ' + rows.length)
    expect(!text.includes('示例插件 11'), '第 11 名及以后不进 TOP10')
    const first = textOf(rows[0])
    expect(first.includes('OpenDesign 设计工作台'), '第 1 行有中文名')
    expect(first.includes('nexu-io/open-design'), '第 1 行有 owner/repo')
    expect(first.includes('99.0k'), '第 1 行星数格式化（99046 → 99.0k）')
    expect(first.includes('+2'), '第 1 行显示较上期 +2')
    expect(first.indexOf('1') === 0, '第 1 行有序号 1')
    expect(textOf(rows[9]).includes('示例插件 10') && textOf(rows[9]).includes('5.0k'), '第 10 行 = 星数第 10 的插件（5000 → 5.0k）')
    expect(!text.includes('小插件'), '星数最少的第 12 名不进 TOP10')

    const up = byClass(tree, 'is-up')
    expect(up.length === 1 && textOf(up[0]) === '+2', '正涨星带 is-up（绿色），实际 ' + up.length + ' 个')
    expect(byClass(tree, 'is-down').length === 1 && textOf(byClass(tree, 'is-down')[0]) === '-1', '下跌带 is-down')
    expect(rowsOf(tree).every((r) => !textOf(r).includes('null')), '没有 delta 的行不会显示 null')
    const repoLinks = byClass(tree, 'dwp-repo')
    expect(repoLinks.length === 11, '10 行仓库链接 + 1 个赞助位仓库链接')
    expect(repoLinks[0].props.href === 'https://github.com/nexu-io/open-design', '仓库链接指向 github.com/owner/repo')
  }

  console.log('[3] 免费模型可用性')
  {
    const { Component } = boot()
    const view = mount(Component, propsFor({ wide: true }))
    await view.settle()
    const tree = view.click(byClass(view.tree, 'dwp-btn')[0])
    const text = textOf(tree)
    expect(text.includes('免费模型'), '有免费模型小节')
    expect(text.includes('可用 ') && text.includes('6/11'), '可用 x/y = 6/11')
    expect(text.includes('已下线 ') && text.includes('2'), '已下线数量')
    expect(text.includes('地区墙 ') && text.includes('2'), '地区墙数量')
    expect(text.includes('限流 '), '限流 > 0 时也列出')
    expect(text.includes('上游波动 '), '上游波动 > 0 时也列出')
    expect(byClass(tree, 'dwp-chip').length === 5, '5 个 chip（可用/已下线/地区墙/限流/上游波动）')
  }

  console.log('[4] 赞助位（有 sponsors 时必须出现且标注「赞助」）')
  {
    const { Component } = boot()
    const view = mount(Component, propsFor())
    await view.settle()
    const tree = view.click(byClass(view.tree, 'dwp-btn')[0])
    const text = textOf(tree)
    expect(text.includes('本期推荐（赞助）'), '有赞助小节标题')
    expect(byClass(tree, 'dwp-section-sponsor').length === 1, '赞助小节有独立视觉样式')
    const badges = byClass(tree, 'dwp-sponsor-badge')
    expect(badges.length === 1 && textOf(badges[0]) === '赞助', '赞助卡片带「赞助」徽标')
    expect(text.includes('付费示例插件'), '显示赞助方名称')
    expect(text.includes('这是一条赞助推荐语'), '显示赞助推荐语')
    expect(text.includes('单期推荐'), '显示档位')
  }

  console.log('[5] 没有 sponsors 时不显示赞助小节')
  {
    const { Component } = boot({ data: Object.assign({}, DATA, { sponsors: [] }) })
    const view = mount(Component, propsFor())
    await view.settle()
    const tree = view.click(byClass(view.tree, 'dwp-btn')[0])
    expect(!textOf(tree).includes('本期推荐（赞助）'), '空数组 → 不显示赞助小节')
    expect(byClass(tree, 'dwp-sponsor').length === 0, '没有赞助卡片')

    const noKey = Object.assign({}, DATA)
    delete noKey.sponsors
    const booted2 = boot({ data: noKey })
    const view2 = mount(booted2.Component, propsFor())
    await view2.settle()
    const tree2 = view2.click(byClass(view2.tree, 'dwp-btn')[0])
    expect(!textOf(tree2).includes('本期推荐（赞助）'), '字段整个缺失也不显示、且不崩')
    expect(textOf(tree2).includes('示例插件 1'), '字段缺失不影响其它内容渲染')
  }

  console.log('[6] 请求失败（宿主半 ok:false）→ 友好提示 + 重试')
  {
    let n = 0
    const booted = boot({
      open: true,
      fetch: () => {
        n += 1
        return Promise.resolve(n === 1 ? jsonRes({ ok: false, reason: '上游 HTTP 503' }) : hostOk(DATA))
      },
    })
    const view = mount(booted.Component, propsFor())
    const tree = await view.settle()
    expect(byClass(tree, 'dwp-panel').length === 1, '失败时抽屉仍渲染（不白屏）')
    const text = textOf(tree)
    expect(text.includes('暂时拿不到周报数据'), '显示中文失败提示')
    expect(text.includes('上游 HTTP 503'), '提示里带具体原因')
    expect(byClass(tree, 'dwp-retry').length === 1, '提供「重试」按钮')
    expect(byClass(tree, 'dwp-links').length === 1, '失败时两个外链按钮仍在')
    expect(badgeText(tree) === '!', '失败且无数据时角标显示 !')
    expect(badgeOf(tree) && hasToken(badgeOf(tree), 'is-empty'), '未知状态角标是弱化样式')

    const retried = view.click(byClass(tree, 'dwp-retry')[0])
    expect(n === 2, '点「重试」→ 再发一次请求，实际 ' + n)
    const done = await view.settle()
    expect(textOf(done).includes('示例插件 1'), '重试成功后正常渲染数据')
    expect(!textOf(done).includes('暂时拿不到周报数据'), '成功后失败提示消失')
  }

  console.log('[7] 网络异常（fetch reject）也要友好失败')
  {
    const booted = boot({ open: true, fetch: () => Promise.reject(new Error('连接被拒绝')) })
    const view = mount(booted.Component, propsFor())
    const tree = await view.settle()
    const text = textOf(tree)
    expect(text.includes('暂时拿不到周报数据'), '网络异常 → 友好提示')
    expect(text.includes('连接被拒绝'), '带上异常信息')
    expect(text.includes('打开完整榜单'), '链接仍在，用户能自己去网站看')
  }

  console.log('[8] 加载中（请求挂起时）')
  {
    let release = null
    const pending = new Promise((resolve) => { release = resolve })
    const booted = boot({ open: true, fetch: () => pending.then(() => hostOk(DATA)) })
    const view = mount(booted.Component, propsFor())
    expect(textOf(view.tree).includes('正在读取周报…'), '首帧显示加载中')
    expect(badgeText(view.tree) === '…', '加载中角标是占位符')
    release()
    const tree = await view.settle()
    expect(textOf(tree).includes('示例插件 1'), '请求返回后渲染数据')
    expect(!textOf(tree).includes('正在读取周报…'), '加载中文案消失')
  }

  console.log('[9] 畸形数据（字段缺失）不崩')
  {
    const booted = boot({ open: true, data: { date: '2026-10-02' } })
    const view = mount(booted.Component, propsFor())
    const tree = await view.settle()
    const text = textOf(tree)
    expect(byClass(tree, 'dwp-panel').length === 1, '面板仍在（没白屏）')
    expect(text.includes('0 个插件'), '缺 plugins → 显示 0 个插件而不是崩溃')
    expect(text.includes('本期还没有插件数据'), 'TOP 区有明确空提示')
    expect(text.includes('免费模型数据暂缺'), '缺 stat → 明确说明而不是显示 0/0')

    const empty = boot({ open: true, data: {} })
    const view2 = mount(empty.Component, propsFor())
    const tree2 = await view2.settle()
    expect(textOf(tree2).includes('更新 —'), '连 date 都没有时显示「更新 —」')
    expect(byClass(tree2, 'dwp-links').length === 1, '空对象也保留外链按钮')
  }

  console.log('[10] TTL 内反复开合不重复请求宿主半')
  {
    const booted = boot()
    const view = mount(booted.Component, propsFor())
    await view.settle()
    expect(booted.fetchCalls.length === 1, '挂载取一次')
    await view.settle()
    view.click(byClass(view.tree, 'dwp-btn')[0])
    await view.settle()
    view.click(byClass(view.tree, 'dwp-btn')[0])
    await view.settle()
    view.click(byClass(view.tree, 'dwp-btn')[0])
    await view.settle()
    expect(booted.fetchCalls.length === 1, '开合三次仍只请求一次（客户端 5 分钟缓存生效）')
    expect(booted.fetchCalls[0].url === '/weekly-panel/data', '请求打在宿主半只读路由上')
    expect(booted.fetchCalls[0].init && booted.fetchCalls[0].init.credentials === 'same-origin', '同源凭据')
  }

  console.log('[11] 展开/收起 + 记忆展开态')
  {
    const booted = boot()
    const view = mount(booted.Component, propsFor())
    await view.settle()
    const opened = view.click(byClass(view.tree, 'dwp-btn')[0])
    expect(byClass(opened, 'dwp-panel').length === 1, '点一下 → 展开')
    const closed = view.click(byClass(opened, 'dwp-btn')[0])
    expect(byClass(closed, 'dwp-panel').length === 0, '再点一下 → 收起')
    const parse = (w) => { try { return JSON.parse(w.v) } catch { return null } }
    expect(booted.writes.length === 2, '写了两次 localStorage（展开 + 收起），实际 ' + booted.writes.length)
    expect(parse(booted.writes[0]) && parse(booted.writes[0]).open === true, '第一次写 open:true')
    expect(parse(booted.writes[1]) && parse(booted.writes[1]).open === false, '第二次写 open:false')
    expect(booted.writes[0].k === 'dsh.weekly-panel.v1', 'localStorage key 稳定')

    const restored = boot({ open: true })
    const view2 = mount(restored.Component, propsFor())
    expect(byClass(view2.tree, 'dwp-panel').length === 1, '记住展开态：重开直接是展开的')
  }

  console.log('[12] 两个外链按钮')
  {
    const { Component } = boot()
    const view = mount(Component, propsFor())
    await view.settle()
    const tree = view.click(byClass(view.tree, 'dwp-btn')[0])
    const links = byClass(tree, 'dwp-link')
    expect(links.length === 2, '两个链接按钮')
    expect(textOf(links[0]) === '打开完整榜单', '第一个是「打开完整榜单」')
    expect(textOf(links[1]) === '商务合作', '第二个是「商务合作」')
    expect(links[0].props.href === 'https://514006234.github.io/dsh-weekly-check/', '完整榜单地址正确')
    expect(links[1].props.href === 'https://514006234.github.io/dsh-weekly-check/sponsor/', '商务合作地址正确')
    expect(links.every((l) => l.props.target === '_blank'), '外链都新开标签')
    expect(links.every((l) => String(l.props.rel).includes('noopener')), '外链都带 noopener')
  }

  console.log('[13] 侧边栏收起（rail）：退化为浮层')
  {
    const { Component } = boot()
    const rail = mount(Component, propsFor({ wide: false }))
    expect(byClass(rail.tree, 'is-rail').length === 1, 'wide=false → rail 形态')
    expect(textOf(rail.tree).includes('📊'), 'rail 下只留图标')
    expect(!textOf(rail.tree).includes('📊 周榜'), 'rail 下不塞长文案（宽度不够）')
    const opened = rail.click(byClass(rail.tree, 'dwp-btn')[0])
    expect(byClass(opened, 'is-float').length === 1, 'rail 展开时用浮层（唯一的固定定位）')
    expect(byClass(opened, 'dwp-panel').length === 1, '浮层里仍是同一个抽屉')
  }

  console.log('')
  if (failures) { console.error('RENDER TEST FAILED（通过 ' + passed + ' / 失败 ' + failures + '）'); process.exit(1) }
  console.log('RENDER TEST OK（' + passed + ' assertions）')
}

await run()
