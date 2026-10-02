// dsh-dashboard — 契约门禁（零依赖、零网络）。
//
// 这个脚本不依赖浏览器、不依赖 DSH 进程，跑一遍就能回答：「我把插件改坏了没有？」
//
// 覆盖层面（断言数 ≥ 20，实际远多于）：
//   [1] package.json 契约（可安装的关键是 dsh.bundle.patch + dsh.client）+ 必要文件存在
//   [2] cordis.patch.yml 的 insert 行与包名一致
//   [3] 宿主半静态边界：只读、唯一出站地址、loopback 护栏、只允许 GET、缓存 30 分钟、不碰磁盘/凭据
//   [4] lib/client.js 静态形态：经典脚本、__ModuleLoader__.load、
//       **注册 main（key=dsh-dashboard）与 sidebar.panellist（id=dsh-dashboard 同值）**、
//       selectPanel 全有降级、无外链资源、抽屉时代遗留（不得依赖 sidebar.footer.action）
//   [5] lib/client.js 运行时契约（node:vm 沙箱，假 react）
//   [6] 槽位注册调用（假 ctx）：双槽注册参数 / 注入面 / 缺服务时不抛
//   [7] 跳转与服务面降级矩阵：selectPanel 成功/缺失/抛异常 + openSession 三级 + createSession 四态
//   [8] 宿主半运行时契约（注入假 fetch 与假 req/res，仍然零网络）
//
// 用法：node tools/gate.mjs   （退出码 0 = 通过）

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createContext, Script } from 'node:vm'
import assert from 'node:assert/strict'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const checks = []
function ok(name) { checks.push(name); console.log('  \u2713 ' + name) }
function fail(name, detail) {
  console.error('  \u2717 ' + name)
  if (detail) console.error('    ' + String(detail).split('\n').join('\n    '))
  process.exitCode = 1
}

// ── [1] package.json ──────────────────────────────────────────────────────
console.log('[1] package.json 契约')
try {
  assert.equal(pkg.name, 'dsh-dashboard', 'name 必须等于插件 id')
  assert.equal(pkg.type, 'module', 'type 必须是 module（宿主半是 ESM）')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch 必须指向 cordis.patch.yml（可安装的关键）')
  assert.equal(pkg.dsh?.client?.platform, 'web', 'dsh.client.platform 必须是 web')
  assert.ok(Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.includes('slots'), 'dsh.client.inject 必须含 slots')
  assert.equal(pkg.exports?.['.'], './lib/index.js', 'exports["."] 必须是宿主半')
  assert.equal(pkg.exports?.['./client'], './lib/client.js', 'exports["./client"] 必须是客户端半')
  assert.equal(pkg.main, './lib/index.js', 'main 必须是宿主半')
  for (const script of ['gate', 'render-test', 'test', 'check']) {
    assert.equal(typeof pkg.scripts?.[script], 'string', 'scripts.' + script + ' 必须存在')
  }
  assert.ok(pkg.scripts.test.includes('tools/gate.mjs') && pkg.scripts.test.includes('tools/render-test.mjs'), 'test 必须串跑两个工具')
  ok('name / type / dsh.bundle.patch / dsh.client / exports / scripts 全部符合加载契约')
} catch (err) { fail('package.json 契约', err.message) }

for (const rel of [pkg.main, pkg.exports?.['.'], pkg.exports?.['./client'], pkg.dsh?.bundle?.patch, './README.md', './tools/gate.mjs', './tools/render-test.mjs']) {
  if (typeof rel !== 'string') continue
  if (existsSync(join(ROOT, rel))) ok('文件存在：' + rel)
  else fail('文件存在：' + rel, '路径不存在')
}

// ── [2] cordis.patch.yml ──────────────────────────────────────────────────
console.log('[2] cordis.patch.yml 组合层')
try {
  const yml = readFileSync(join(ROOT, pkg.dsh.bundle.patch), 'utf8')
  assert.ok(/insert\s*:/.test(yml), '必须是 insert 列表（bundle 形态）')
  assert.ok(yml.includes('id: ' + pkg.name), 'insert 的 id 必须是包名')
  assert.ok(new RegExp('name:\\s*["\']?' + pkg.name).test(yml), 'insert 的 name 必须是包名')
  ok('insert 行 id/name 与包名一致')
} catch (err) { fail('cordis.patch.yml', err.message) }

// ── [3] 宿主半静态边界 ────────────────────────────────────────────────────
console.log('[3] lib/index.js 宿主半静态边界')
const hostSrc = readFileSync(join(ROOT, 'lib/index.js'), 'utf8')
const ALLOWED_URL = 'https://514006234.github.io/dsh-weekly-check/latest.json'
try {
  assert.ok(/export\s+const\s+inject\s*=\s*\['webServer'\]/.test(hostSrc), "宿主半必须 inject = ['webServer']")
  assert.ok(/export\s+function\s+apply/.test(hostSrc), '宿主半必须导出 apply')
  assert.ok(/export\s+function\s+createStore/.test(hostSrc), '宿主半必须导出 createStore（可注入假 fetch 单测）')
  assert.ok(/ctx\.inject\(\['webServer'\]/.test(hostSrc), '必须用 ctx.inject([webServer]) 兜底注册（服务未 active 时 ctx.get 会静默失败）')
  assert.ok(hostSrc.includes("'/dashboard/data'"), '必须注册 /dashboard/data 路由')
  assert.ok(hostSrc.includes(ALLOWED_URL), '必须以内置常量声明唯一出站地址')
  assert.ok(/30\s*\*\s*60\s*\*\s*1000/.test(hostSrc), '缓存必须是 30 分钟常量')
  assert.ok(hostSrc.includes('isLoopbackRequest'), '必须有 loopback + 同源防护')
  assert.ok(hostSrc.includes("req.headers['sec-fetch-site'] === 'cross-site'"), '必须挡跨站请求（DNS rebinding 防护）')
  assert.ok(hostSrc.includes('const origin = req.headers.origin'), '必须校验 Origin 与 Host 同源')
  assert.ok(/req\.method\s*!==\s*method/.test(hostSrc), '必须做方法校验')
  assert.ok(/guard\(request, response, 'GET'\)/.test(hostSrc), '数据路由只允许 GET')
  ok('inject / apply / createStore / 路由 / 缓存常量 / loopback+同源防护 / 只允许 GET')

  const urls = [...hostSrc.matchAll(/['"](https?:\/\/[^'"\s]+)['"]/g)].map((m) => m[1])
  const external = urls.filter((u) => !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(u))
  assert.deepEqual(external, [ALLOWED_URL], '除 UPSTREAM_URL 外不得出现任何出站地址，实际：' + JSON.stringify(external))
  assert.equal(urls.filter((u) => u === ALLOWED_URL).length, 1, 'UPSTREAM_URL 只应出现一次')
  const fetchCalls = hostSrc.match(/\bfetch\s*\(/g) || []
  assert.equal(fetchCalls.length, 1, '宿主半只允许一处 fetch（默认 fetchImpl），实际 ' + fetchCalls.length + ' 处')
  assert.ok(hostSrc.includes('fetchImpl(UPSTREAM_URL'), 'fetch 必须打在 UPSTREAM_URL 上（不做任何请求参数转发）')
  ok('唯一出站地址 = ' + ALLOWED_URL + '，不转发任何请求参数/头')

  assert.ok(!/from\s+['"]node:fs/.test(hostSrc), '宿主半不得引入 node:fs')
  assert.ok(!/\brequire\s*\(/.test(hostSrc), '宿主半不得使用 require')
  assert.ok(!/writeFile|appendFile|createWriteStream|mkdir|rmSync|\brm\(/.test(hostSrc), '宿主半不得写盘')
  assert.ok(!/readFile|readdir|createReadStream|readFileSync/.test(hostSrc), '宿主半不得读本地文件')
  assert.ok(!/process\.env/.test(hostSrc), '宿主半不得读环境变量（无凭据接触）')
  assert.ok(!/import\s*\(/.test(hostSrc), '宿主半不得动态 import')
  assert.ok(!/from\s+['"]node:(http|https|net|dgram|tls)['"]/.test(hostSrc), '宿主半不得引入网络模块')
  assert.ok(!/\bhttps?\.request\s*\(/.test(hostSrc), '宿主半不得用 http.request')
  assert.ok(hostSrc.includes("new URL('http://' + host)"), 'Host 只用于本地同源校验（URL 解析，不发请求）')
  ok('只读边界：无 node:fs / 无写盘 / 无本地读 / 无 process.env / 无网络模块 / 无动态 import')
} catch (err) { fail('宿主半静态边界', err.message) }

// ── [4] client.js 静态形态 ────────────────────────────────────────────────
console.log('[4] lib/client.js 静态形态')
const clientSrc = readFileSync(join(ROOT, 'lib/client.js'), 'utf8')
try {
  assert.ok(!/^\s*import\s/m.test(clientSrc), '客户端 bundle 里不能出现 import 语句')
  assert.ok(!/^\s*export\s/m.test(clientSrc), '客户端 bundle 里不能出现 export 语句')
  assert.ok(clientSrc.includes('window.__ModuleLoader__.load'), '必须通过 window.__ModuleLoader__.load 注册 factory')
  assert.ok(/id:\s*'dsh-dashboard'/.test(clientSrc), 'load 的 id 必须是 dsh-dashboard')
  assert.ok(!clientSrc.includes('@deepseek-ai/'), '没有跨插件值导入（module purity）')
  assert.ok(clientSrc.includes("var React = require('react')"), '经典脚本只能 require 平台种子模块 react')
  ok('经典脚本形态 / 无 import-export / 无跨插件值导入 / load id 正确')

  // main 槽（key=dsh-dashboard）与 sidebar.panellist 槽（id=dsh-dashboard 同值）
  const mainKey = (clientSrc.match(/var MAIN_KEY = '([^']+)'/) || [])[1]
  const listId = (clientSrc.match(/var LIST_ID = '([^']+)'/) || [])[1]
  assert.equal((clientSrc.match(/var MAIN_SLOT = 'main'/) || []).length, 1, "必须声明 MAIN_SLOT = 'main'")
  assert.equal((clientSrc.match(/var LIST_SLOT = 'sidebar\.panellist'/) || []).length, 1, "必须声明 LIST_SLOT = 'sidebar.panellist'")
  assert.equal(mainKey, 'dsh-dashboard', "main 的 key 必须是 'dsh-dashboard'")
  assert.equal(listId, 'dsh-dashboard', "panellist 的 id 必须是 'dsh-dashboard'")
  assert.equal(listId, mainKey, 'panellist 的 id 必须与 main 的 key 同值（Each list id addresses the matching main panel）')
  assert.ok(clientSrc.includes('slots.inject(MAIN_SLOT'), '必须 inject 到 main 槽')
  assert.ok(clientSrc.includes('slots.inject(LIST_SLOT'), '必须 inject 到 sidebar.panellist 槽')
  assert.ok(/var LIST_ORDER = 100/.test(clientSrc), 'panellist order 必须是 100（升序，排在自带条目之后）')
  assert.ok(/var LIST_LABEL = '仪表盘'/.test(clientSrc), 'panellist label 必须是「仪表盘」')
  ok('注册 main(key=dsh-dashboard) + sidebar.panellist(id 同值 / order 100 / label 仪表盘)')

  // selectPanel 全有降级
  assert.ok(/function selectPanel\(ctx, key\)/.test(clientSrc), '必须有统一的 selectPanel 降级 helper')
  assert.ok(clientSrc.includes("typeof ctx?.layout?.selectPanel === 'function'"), 'selectPanel 必须先做 typeof 面检查')
  assert.ok(/function selectPanel\(ctx, key\) \{\s*try \{/.test(clientSrc), 'selectPanel 必须整体 try/catch（官方实现对未注册 key 会抛）')
  const panelCalls = clientSrc.match(/\.selectPanel\(/g) || []
  assert.equal(panelCalls.length, 1, '所有切面板都必须收敛到唯一 helper，直接调用点只允许 1 处（helper 内），实际 ' + panelCalls.length)
  const openCalls = clientSrc.match(/window\.open\s*\(/g) || []
  assert.equal(openCalls.length, 1, '所有外开都必须收敛到唯一 openUrl 降级口，实际 ' + openCalls.length)
  assert.ok(clientSrc.includes('function jumpTo(ctx, key, fallbackUrl)'), '必须有「先切面板、失败回落 window.open」的 jumpTo')
  assert.ok(clientSrc.includes("typeof window !== 'undefined' && typeof window.open === 'function'"), 'openUrl 必须先做 typeof 检查')
  assert.ok(/catch \{ \/\* 弹窗被拦等：静默 \*\/ \}/.test(clientSrc) || /catch \{\}/.test(clientSrc), 'openUrl 内部必须吞异常')
  ok('selectPanel/jumpTo/openUrl 全链路降级：typeof 检查 + try/catch + 唯一出口')

  // resolveService 三级兜底 + 打开会话优先级
  assert.ok(/function resolveService\(ctx, name\)/.test(clientSrc), '必须有与 workbench 相同的 resolveService 三级兜底')
  assert.ok(clientSrc.includes('ctx.get(name, false)'), 'resolveService 第二级：非 strict ctx.get(name, false)')
  assert.ok(clientSrc.includes('ctx[name]'), 'resolveService 第三级：属性访问')
  const atWorkspace = clientSrc.indexOf('uiWorkspace.openSession(sessionId)')
  const atSessions = clientSrc.indexOf('sessions.open(sessionId)')
  assert.ok(atWorkspace > 0 && atSessions > 0 && atWorkspace < atSessions, '打开会话必须按 uiWorkspace.openSession → sessions.open 的优先级')
  assert.ok(clientSrc.includes("typeof sessions.create !== 'function'"), '新建会话必须先检查 sessions.create 面')
  ok('resolveService 三级兜底 / openSession 优先级 / createSession 面检查')

  // 数据链路
  assert.ok(/fetch\(\s*DATA_ROUTE/.test(clientSrc), '客户端只能 fetch 宿主半路由（DATA_ROUTE）')
  assert.ok(!/fetch\(\s*['"]https?:/.test(clientSrc), '客户端不得直接打外网地址')
  assert.ok(clientSrc.includes("'/dashboard/data'"), '数据必须来自宿主半路由 /dashboard/data')

  // 无外链资源（导航用的 window.open/href 不算资源；资源=字体/图片/脚本/样式）
  const literals = [...clientSrc.matchAll(/['"](https?:\/\/[^'"\s]+)['"]/g)].map((m) => m[1]).sort()
  assert.deepEqual(
    literals,
    ['https://514006234.github.io/dsh-weekly-check/', 'https://514006234.github.io/dsh-weekly-check/sponsor/'].sort(),
    '客户端外链白名单只允许榜单首页与赞助页，实际：' + JSON.stringify(literals),
  )
  assert.ok(!/<script/i.test(clientSrc), '不得内联 <script src> 外链脚本')
  assert.ok(!/@import|@font-face/i.test(clientSrc), '不得 @import / @font-face 引外部样式或字体')
  assert.ok(!/url\(\s*['"]?https?:/i.test(clientSrc), 'CSS 不得 url(http…) 引外部图片')
  assert.ok(!/https?:\/\/[^\s'"]+\.(png|jpe?g|gif|svg|woff2?|ttf|otf|css|js)/i.test(clientSrc), '不得引用任何外部静态资源文件')
  ok('无外链资源：仅两个导航白名单 URL，无 script/@import/@font-face/url(http)')

  // 抽屉时代遗留
  assert.ok(!clientSrc.includes('sidebar.footer.action'), '客户端不得再依赖 sidebar.footer.action（抽屉时代遗留）')
  assert.ok(!hostSrc.includes('sidebar.footer.action'), '宿主半不得再依赖 sidebar.footer.action')
  ok('抽屉时代遗留已清除：两个半都不再引用 sidebar.footer.action')
} catch (err) { fail('client.js 静态形态', err.message) }

// ── [5] client.js 运行时（node:vm）────────────────────────────────────────
console.log('[5] lib/client.js 运行时契约（node:vm 沙箱）')
const PLATFORM = new Set(['react'])
let loaded = 0
let record = null
const sandbox = {
  console,
  window: {
    __ModuleLoader__: { load(rec) { loaded += 1; record = rec } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  },
}
try {
  new Script(clientSrc, { filename: 'lib/client.js' }).runInContext(createContext(sandbox), { timeout: 10000 })
  assert.equal(loaded, 1, 'load() 必须恰好调用一次')
  assert.ok(record, 'load() 必须收到 { id, factory }')
  assert.equal(record.id, pkg.name, 'id 必须等于包名')
  assert.equal(typeof record.factory, 'function', 'factory 必须是函数')
  ok('load 调用一次 / id / factory 形态正确')
} catch (err) { fail('client.js 运行时契约', err.message) }

let mod = null
try {
  const reactStub = {
    createElement: () => null,
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  }
  const requiredIds = []
  mod = record.factory((id) => {
    requiredIds.push(id)
    if (!PLATFORM.has(id)) throw new Error('unexpected external require: ' + id)
    return reactStub
  }, undefined)
  assert.deepEqual(requiredIds, ['react'], '只能 require 平台种子模块 react')
  assert.equal(typeof mod.apply, 'function', 'exports.apply 必须是函数')
  assert.equal(Array.isArray(mod.inject), true, 'exports.inject 必须是数组')
  assert.equal(mod.inject.length, 1, 'exports.inject 长度必须是 1')
  assert.equal(mod.inject[0], 'slots', "exports.inject[0] 必须是 'slots'（vm 跨 realm 数组不能用 deepEqual）")
  assert.equal(mod.name, pkg.name, 'exports.name 必须等于包名')
  ok("require 白名单内 / exports.apply / exports.inject === ['slots']")
} catch (err) { fail('factory 导出契约', err.message) }

// ── [6] 槽位注册调用（假 ctx）──────────────────────────────────────────────
console.log('[6] 槽位注册调用（假 ctx，双槽）')
function makeSlots() {
  const events = []
  const regs = {}
  const slots = {
    inject(key, cb) { events.push(key); return cb() },
    register(options, component) {
      regs[options.name] = { options, component }
      return () => {}
    },
    entries() { return [] },
  }
  return { events, regs, slots }
}
let face = null
try {
  const { events, regs, slots } = makeSlots()
  const ctx = { get: (name) => (name === 'slots' ? slots : undefined) }
  mod.apply(ctx)
  assert.deepEqual(events, ['main', 'sidebar.panellist'], '必须依次 inject main 与 sidebar.panellist，实际 ' + JSON.stringify(events))

  const main = regs['main']
  const list = regs['sidebar.panellist']
  assert.ok(main, 'main 槽必须有注册')
  assert.ok(list, 'sidebar.panellist 槽必须有注册')
  assert.equal(main.options.name, 'main', "main 注册的 name 必须是 'main'")
  assert.equal(main.options.key, 'dsh-dashboard', 'main 注册的 key 必须是 dsh-dashboard')
  assert.equal(list.options.name, 'sidebar.panellist', "panellist 注册的 name 必须是 'sidebar.panellist'")
  assert.equal(list.options.id, 'dsh-dashboard', 'panellist 注册的 id 必须是 dsh-dashboard')
  assert.equal(list.options.id, main.options.key, 'panellist.id 必须与 main.key 同值')
  assert.equal(list.options.order, 100, 'panellist order 必须是 100')
  assert.equal(list.options.label, '仪表盘', 'panellist label 必须是「仪表盘」')
  assert.equal(typeof main.component, 'function', 'main 组件必须是函数')
  assert.equal(typeof list.component, 'function', 'panellist 组件必须是函数')
  assert.equal(typeof main.options.inject, 'function', 'main 注册必须带注入面（inject）')
  face = main.options.inject()
  assert.deepEqual(Object.keys(face).sort(), ['dashCreateSession', 'dashJump', 'dashOpenSession'], '注入面必须有 dashJump / dashOpenSession / dashCreateSession')
  ok('双槽注册：main(key) / sidebar.panellist(id 同值+order+label) / 注入面齐全')
} catch (err) { fail('槽位注册调用', err.message) }

// ── [7] 跳转与服务面的降级矩阵 ─────────────────────────────────────────────
console.log('[7] 跳转/服务面降级矩阵（零网络、零抛错）')

/**
 * 在给定能力下取一份注入面（走官方 apply 路径：slots 注册 → main 注册的 inject）。
 * spec.services —— resolveService 第一级命中：ctx.get(name) 直接返回
 * spec.lazy     —— 第二级命中：仅 ctx.get(name, false) 返回（strict 调用静默 undefined）
 * spec.props    —— 第三级命中：ctx[name] 属性访问
 * spec.layout   —— ctx.layout（不传 = 面缺失）
 */
function faceOf(spec) {
  spec = spec || {}
  let mainOptions = null
  const slots = {
    inject(key, cb) { return cb() },
    register(opts) { if (opts && opts.name === 'main') mainOptions = opts; return () => {} },
    entries() { return [] },
  }
  const services = spec.services || {}
  const lazy = spec.lazy || {}
  const props = spec.props || {}
  const ctx = {
    get(name, strict) {
      if (name === 'slots') return slots
      if (strict === false && lazy[name] !== undefined) return lazy[name]
      return services[name]
    },
    layout: spec.layout,
  }
  for (const key of Object.keys(props)) ctx[key] = props[key]
  mod.apply(ctx)
  if (!mainOptions || typeof mainOptions.inject !== 'function') throw new Error('main 注册缺失')
  return mainOptions.inject()
}

try {
  const SITE = 'https://514006234.github.io/dsh-weekly-check/'

  // (a) selectPanel 可用 → 切面板成功，不碰 window.open
  {
    const picked = []
    const jumped = faceOf({ layout: { selectPanel: (k) => picked.push(k) } }).dashJump('dsh-weekly', SITE)
    assert.equal(jumped, true, 'selectPanel 可用时 dashJump 必须返回 true')
    assert.deepEqual(picked, ['dsh-weekly'], '必须切到 dsh-weekly')
  }

  // (b) ctx.layout 缺失 → 返回 false，不抛（gate 沙箱里 window.open 不存在 → 静默）
  {
    let escaped = null
    let jumped = null
    try { jumped = faceOf({}).dashJump('dsh-weekly', SITE) } catch (err) { escaped = err }
    assert.equal(escaped, null, 'layout 缺失时绝不抛：' + (escaped && escaped.message))
    assert.equal(jumped, false, 'layout 缺失时 dashJump 返回 false（回落窗口不可用则静默）')
  }

  // (c) selectPanel 抛异常（key 未注册的官方行为）→ 吞掉，不崩
  {
    let escaped = null
    let jumped = null
    const boom = { selectPanel: () => { throw new Error('unknown panel key') } }
    try { jumped = faceOf({ layout: boom }).dashJump('dsh-workbench', SITE) } catch (err) { escaped = err }
    assert.equal(escaped, null, 'selectPanel 抛异常必须被吞：' + (escaped && escaped.message))
    assert.equal(jumped, false, 'selectPanel 抛异常时返回 false')
  }

  // (d) 打开会话：uiWorkspace 优先 → sessions.open 兜底（顺带覆盖 resolveService 三级）→ 都没有 {ok:false}
  {
    const order = []
    const both = faceOf({
      services: {
        uiWorkspace: { openSession: (id) => order.push('uiWorkspace:' + id) },
        sessions: { open: (id) => order.push('sessions:' + id) },
      },
    })
    const rA = both.dashOpenSession('s1')
    assert.equal(rA.ok, true, '有 uiWorkspace 时必须 ok:true')
    assert.deepEqual(order, ['uiWorkspace:s1'], '必须优先 uiWorkspace.openSession，sessions.open 不得被调用')

    const rB = faceOf({ lazy: { sessions: { open: (id) => order.push('lazy-sessions:' + id) } } }).dashOpenSession('s2')
    assert.equal(rB.ok, true, '第二级 ctx.get(name,false) 能取到 sessions')
    assert.deepEqual(order.slice(1), ['lazy-sessions:s2'], '回落到 sessions.open')

    const rC = faceOf({ props: { sessions: { open: (id) => order.push('prop-sessions:' + id) } } }).dashOpenSession('s3')
    assert.equal(rC.ok, true, '第三级 ctx[name] 属性访问能取到 sessions')
    assert.deepEqual(order.slice(2), ['prop-sessions:s3'], '属性访问也能回落到 sessions.open')

    const rD = faceOf({}).dashOpenSession('s4')
    assert.equal(rD.ok, false, '两个面都没有 → {ok:false}，不抛')
    assert.ok(typeof rD.reason === 'string' && rD.reason.length > 0, '{ok:false} 必须带 reason')
  }

  // (e) 新会话四态：没有 create / 成功 / 同步抛错 / 拒绝 —— 全部经 done 回调，不外抛
  {
    // 注意：这些 Error / 普通对象是 **vm realm 里造的**，跨 realm 不能用 instanceof / deepEqual，
    // 所以一律按鸭子类型校验。
    const looksLikeError = (e) => !!e && typeof e === 'object' && typeof e.message === 'string'

    let errSeen = 'unset'
    faceOf({}).dashCreateSession('', (err) => { errSeen = err })
    assert.ok(looksLikeError(errSeen), '拿不到 sessions.create 必须 done(err) 而不是抛出')

    const inputs = []
    let doneArgs = null
    const withCreate = faceOf({ props: { sessions: { create: (input) => { inputs.push(input); return Promise.resolve('new-id') } } } })
    withCreate.dashCreateSession('D:/proj', (err, id) => { doneArgs = [err, id] })
    await new Promise((r) => setImmediate(r))
    assert.equal(inputs.length, 1, 'create 必须被调用 1 次，实际 ' + inputs.length)
    assert.equal(inputs[0].cwd, 'D:/proj', 'create 必须收到 {cwd:"D:/proj"}，实际 ' + JSON.stringify(inputs[0]))
    assert.equal(doneArgs[0], null, '成功时 done(null, id)')
    assert.equal(doneArgs[1], 'new-id', '成功时带回 sessionId')

    const emptyInputs = []
    faceOf({ props: { sessions: { create: (input) => { emptyInputs.push(input); return Promise.resolve('id2') } } } })
      .dashCreateSession('', () => {})
    assert.equal(emptyInputs.length, 1, '空 cwd 也必须调用 create 1 次')
    assert.equal(Object.keys(emptyInputs[0]).length, 0, '拿不到 cwd 就传空：不带 cwd 字段，按 sessions.create 语义降级')

    let err2 = null
    faceOf({ props: { sessions: { create: () => { throw new Error('同步炸') } } } })
      .dashCreateSession('', (err) => { err2 = err })
    assert.ok(looksLikeError(err2), 'create 同步抛错必须转成 done(err)')

    let err3 = null
    faceOf({ props: { sessions: { create: () => Promise.reject(new Error('上游拒绝')) } } })
      .dashCreateSession('', (err) => { err3 = err })
    await new Promise((r) => setImmediate(r))
    assert.ok(looksLikeError(err3) && err3.message === '上游拒绝', 'create 拒绝必须转成 done(err)，实际 ' + (err3 && err3.message))
  }

  // (f) 拿不到 slots 服务时必须安静跳过，绝不抛
  {
    let escaped = null
    try { mod.apply({ get: () => undefined }) } catch (err) { escaped = err }
    assert.equal(escaped, null, '拿不到 slots 时必须安静跳过：' + (escaped && escaped.message))
  }
  ok('降级矩阵：selectPanel 成功/缺失/抛异常 + openSession 三级取服务 + createSession 四态 + 缺 slots 不抛')
} catch (err) { fail('跳转/服务面降级矩阵', err.message) }

// ── [8] 宿主半运行时契约（注入假 fetch / 假 req / 假 res，零网络）────────────
console.log('[8] 宿主半运行时契约（零网络）')
const HOST = ALLOWED_URL
const PAYLOAD = { date: '2026-10-02', plugins: [{ repo: 'a/b', name: '示例', stars: 12 }], stat: { total: 1, ok: 1 } }

function fakeReq(over = {}) {
  return Object.assign({
    method: 'GET',
    url: '/dashboard/data',
    headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
  }, over)
}
function fakeRes() {
  return {
    statusCode: 0,
    headers: null,
    body: null,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers },
    end(body) { this.body = body },
  }
}
function bodyOf(res) { try { return JSON.parse(res.body) } catch { return null } }
const okRes = (payload) => ({ ok: true, status: 200, json: async () => payload })
const badRes = (status) => ({ ok: false, status, json: async () => ({}) })

try {
  const host = await import(pathToFileURL(join(ROOT, 'lib/index.js')).href)
  assert.equal(host.name, 'dsh-dashboard', 'exports.name 必须是 dsh-dashboard')
  assert.equal(host.UPSTREAM_URL, HOST, '导出的 UPSTREAM_URL 必须与门禁核对的一致')
  assert.equal(host.CACHE_TTL_MS, 30 * 60 * 1000, 'CACHE_TTL_MS 必须是 30 分钟')
  assert.equal(host.ROUTE_DATA, '/dashboard/data', 'ROUTE_DATA 必须是 /dashboard/data')
  assert.equal(typeof host.handleData, 'function', '必须导出 handleData 供测试直接调用')
  assert.equal(typeof host.createStore, 'function', '必须导出 createStore 供测试直接调用')
  ok('导出契约：name / UPSTREAM_URL / CACHE_TTL_MS / ROUTE_DATA / handleData / createStore')

  // (a) 成功 → 缓存命中 → TTL 过期重取
  {
    let clock = 1_000_000
    let calls = 0
    const store = host.createStore({ now: () => clock, fetchImpl: async () => { calls += 1; return okRes(PAYLOAD) } })
    const r1 = fakeRes()
    await store.handleData(fakeReq(), r1)
    const b1 = bodyOf(r1)
    assert.equal(r1.statusCode, 200, '正常请求必须 200')
    assert.equal(b1.ok, true, '必须 ok:true')
    assert.equal(b1.cached, false, '首次必须是新鲜数据（cached:false）')
    assert.deepEqual(b1.data, PAYLOAD, '返回的数据必须与上游一致')

    const r2 = fakeRes()
    await store.handleData(fakeReq(), r2)
    assert.equal(bodyOf(r2).cached, true, 'TTL 内第二次必须命中缓存（cached:true）')
    assert.equal(calls, 1, 'TTL 内只应请求上游一次，实际 ' + calls)

    clock += host.CACHE_TTL_MS + 1
    const r3 = fakeRes()
    await store.handleData(fakeReq(), r3)
    assert.equal(bodyOf(r3).cached, false, 'TTL 过期后必须重新取上游')
    assert.equal(calls, 2, 'TTL 过期后应发生第二次上游请求，实际 ' + calls)
    ok('30 分钟缓存：首次新鲜 / TTL 内命中 / 过期重取')
  }

  // (b) 上游挂了但有旧缓存 → 继续返回旧数据并标 stale
  {
    let clock = 2_000_000
    let mode = 'good'
    const store = host.createStore({
      now: () => clock,
      fetchImpl: async () => {
        if (mode === 'good') return okRes(PAYLOAD)
        throw new Error('ECONNREFUSED 连接被拒绝')
      },
    })
    const first = fakeRes()
    await store.handleData(fakeReq(), first)
    assert.equal(bodyOf(first).ok, true, '先成功一次建立缓存')

    mode = 'bad'
    clock += host.CACHE_TTL_MS + 1
    const second = fakeRes()
    await store.handleData(fakeReq(), second)
    const b2 = bodyOf(second)
    assert.equal(second.statusCode, 200, '上游挂了也不能 5xx（面板要能显示旧数据）')
    assert.equal(b2.ok, true, '有旧缓存时必须仍然 ok:true')
    assert.equal(b2.stale, true, '必须明确标注 stale:true')
    assert.deepEqual(b2.data, PAYLOAD, 'stale 数据必须是上一次成功的内容')
    assert.ok(b2.ageMs >= host.CACHE_TTL_MS, 'stale 必须带 ageMs，实际 ' + b2.ageMs)
    ok('上游失败 + 有旧缓存 → 返回旧数据并标 stale（不 5xx）')
  }

  // (c) 既没缓存又挂了 → ok:false + 中文 reason，且绝不抛
  {
    const store = host.createStore({ fetchImpl: async () => { throw new Error('fetch failed') } })
    const res1 = fakeRes()
    await store.handleData(fakeReq(), res1)
    const b = bodyOf(res1)
    assert.equal(b.ok, false, '没有缓存又拿不到时必须 ok:false')
    assert.ok(typeof b.reason === 'string' && b.reason.length > 0, '必须带 reason，实际 ' + JSON.stringify(b.reason))
    assert.ok(b.reason.includes('fetch failed'), 'reason 应包含上游错误信息')

    const throwing = host.createStore({ fetchImpl: () => { throw new Error('同步炸') } })
    const res2 = fakeRes()
    let escaped = null
    try { await throwing.handleData(fakeReq(), res2) } catch (err) { escaped = err }
    assert.equal(escaped, null, 'fetchImpl 同步抛异常时也不许把异常抛出去：' + (escaped && escaped.message))
    assert.equal(bodyOf(res2).ok, false, '同步异常也必须转成 ok:false')
    ok('无缓存 + 上游失败 → ok:false + reason；同步异常也绝不外抛')
  }

  // (d) 非 JSON / 数组响应也算失败
  {
    const store = host.createStore({ fetchImpl: async () => okRes([1, 2, 3]) })
    const res1 = fakeRes()
    await store.handleData(fakeReq(), res1)
    assert.equal(bodyOf(res1).ok, false, '上游返回数组（非对象）必须判失败，避免下游拿到脏形状')
    const store2 = host.createStore({ fetchImpl: async () => badRes(503) })
    const res2 = fakeRes()
    await store2.handleData(fakeReq(), res2)
    assert.equal(bodyOf(res2).ok, false, '上游 503 必须判失败')
    assert.ok(String(bodyOf(res2).reason).includes('503'), 'reason 应带上游状态码，实际 ' + bodyOf(res2).reason)
    ok('非 JSON 对象 / 上游 5xx → 判失败并带可读 reason')
  }

  // (e) 防护：非 loopback / 跨站 / 错 Origin / 非 GET
  {
    let calls = 0
    const store = host.createStore({ fetchImpl: async () => { calls += 1; return okRes(PAYLOAD) } })

    const remote = fakeRes()
    await store.handleData(fakeReq({ socket: { remoteAddress: '10.0.0.8' } }), remote)
    assert.equal(remote.statusCode, 403, '非 loopback 必须 403')

    const cross = fakeRes()
    await store.handleData(fakeReq({ headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } }), cross)
    assert.equal(cross.statusCode, 403, '跨站请求必须 403')

    const evilHost = fakeRes()
    await store.handleData(fakeReq({ headers: { host: 'evil.example.com' } }), evilHost)
    assert.equal(evilHost.statusCode, 403, 'Host 不是本机必须 403（DNS rebinding）')

    const badOrigin = fakeRes()
    await store.handleData(fakeReq({ headers: { host: '127.0.0.1:3080', origin: 'https://evil.example.com' } }), badOrigin)
    assert.equal(badOrigin.statusCode, 403, 'Origin 与 Host 不同源必须 403')

    const post = fakeRes()
    await store.handleData(fakeReq({ method: 'POST' }), post)
    assert.equal(post.statusCode, 405, '非 GET 必须 405')

    assert.equal(calls, 0, '被拦掉的请求不得触达上游，实际触达 ' + calls + ' 次')
    ok('防护矩阵：非 loopback / 跨站 / 错误 Host / 错误 Origin → 403；POST → 405；且都不触达上游')
  }

  // (f) apply：服务在位走 ctx.effect 注册；不在位走 ctx.inject 兜底；无服务也不抛
  {
    const routes1 = []
    const effectLabels = []
    const server = { register(route) { routes1.push(route); return () => {} } }
    host.apply({
      webServer: server,
      effect(fn, label) { effectLabels.push(label); return fn() },
      inject() { effectLabels.push('不该走 inject 分支') },
    })
    assert.equal(routes1.length, 1, '服务在位时必须注册 1 条路由，实际 ' + routes1.length)
    assert.equal(routes1[0].path, host.ROUTE_DATA, '注册路径必须是 ' + host.ROUTE_DATA)
    assert.equal(routes1[0].kind, 'exact', '必须是 exact 路由')
    assert.equal(typeof routes1[0].handler, 'function', '路由必须带 handler')
    assert.ok(effectLabels.some((l) => String(l).includes('dsh-dashboard')), '必须用 ctx.effect 包住注册（可回收）')

    const routes2 = []
    let injectedDeps = null
    host.apply({
      inject(deps, cb) {
        injectedDeps = deps
        const dispose = cb({ webServer: { register(r) { routes2.push(r); return () => {} } } })
        return typeof dispose === 'function' ? dispose : () => {}
      },
    })
    assert.deepEqual(injectedDeps, ['webServer'], '服务不在位时必须用 ctx.inject([webServer]) 兜底')
    assert.equal(routes2.length, 1, '兜底路径也必须注册 1 条路由，实际 ' + routes2.length)

    let escaped = null
    try { host.apply({}) } catch (err) { escaped = err }
    assert.equal(escaped, null, '完全没有服务时 apply 也不得抛异常：' + (escaped && escaped.message))
    ok('apply：服务在位走 ctx.effect；不在位走 ctx.inject([webServer]) 兜底；无服务也不抛')
  }
} catch (err) { fail('宿主半运行时契约', err.message) }

console.log('')
if (process.exitCode) {
  console.error('GATE FAILED')
} else {
  console.log('GATE OK (' + checks.length + ' checks)')
}
