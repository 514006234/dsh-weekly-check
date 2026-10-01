// dsh-weekly-panel — 契约门禁（零依赖、零网络）。
//
// 这个脚本不依赖浏览器、不依赖 DSH 进程，跑一遍就能回答：「我把插件改坏了没有？」
//
// 覆盖两个层面：
//   [1] package.json 契约（可安装的关键是 dsh.bundle.patch + dsh.client）
//   [2] cordis.patch.yml 的 insert 行与包名一致
//   [3] 宿主半静态边界：只读、唯一出站地址、loopback 防护、只允许 GET、缓存 30 分钟
//   [4] lib/client.js 静态形态：经典脚本、__ModuleLoader__.load、槽位/order、
//       抽屉"不遮挡对话"的 CSS 不变量（面板在流内 + 只有 rail 才浮层 + z-index ≤ 90）
//   [5] lib/client.js 运行时契约（node:vm 沙箱，假 react）
//   [6] 槽位注册调用（假 ctx）：inject sidebar.footer.action / id / order 20 / 缺服务时不抛
//   [7] 宿主半运行时契约（注入假 fetch 与假 req/res，仍然零网络）：
//       成功→缓存命中→TTL 过期重取；上游挂了→退回旧缓存并标 stale；
//       既没缓存又挂了→ok:false+reason；非 loopback/跨站/错 Origin→403；
//       非 GET→405；任何情况下都不抛异常
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
  assert.equal(pkg.name, 'dsh-weekly-panel', 'name 必须等于插件 id')
  assert.equal(pkg.type, 'module', 'type 必须是 module（宿主半是 ESM）')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch 必须指向 cordis.patch.yml（可安装的关键）')
  assert.equal(pkg.dsh?.client?.platform, 'web', 'dsh.client.platform 必须是 web')
  assert.ok(Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.includes('slots'), 'dsh.client.inject 必须含 slots')
  assert.equal(pkg.exports?.['.'], './lib/index.js', 'exports["."] 必须是宿主半')
  assert.equal(pkg.exports?.['./client'], './lib/client.js', 'exports["./client"] 必须是客户端半')
  assert.equal(pkg.main, './lib/index.js', 'main 必须是宿主半')
  ok('name / type / dsh.bundle.patch / dsh.client / exports 全部符合加载契约')
} catch (err) { fail('package.json 契约', err.message) }

for (const rel of [pkg.main, pkg.exports?.['.'], pkg.exports?.['./client'], pkg.dsh?.bundle?.patch, './README.md']) {
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
  assert.ok(hostSrc.includes("'/weekly-panel/data'"), '必须注册 /weekly-panel/data 路由')
  assert.ok(hostSrc.includes(ALLOWED_URL), '必须以内置常量声明唯一出站地址')
  assert.ok(/30\s*\*\s*60\s*\*\s*1000/.test(hostSrc), '缓存必须是 30 分钟常量')
  assert.ok(hostSrc.includes('isLoopbackRequest'), '必须有 loopback + 同源防护')
  assert.ok(hostSrc.includes("req.headers['sec-fetch-site'] === 'cross-site'"), '必须挡跨站请求（DNS rebinding 防护）')
  assert.ok(hostSrc.includes("const origin = req.headers.origin"), '必须校验 Origin 与 Host 同源')
  assert.ok(/req\.method\s*!==\s*method/.test(hostSrc), '必须做方法校验')
  assert.ok(/guard\(request, response, 'GET'\)/.test(hostSrc), '数据路由只允许 GET')
  ok('inject / apply / createStore / 路由 / 缓存常量 / loopback+同源防护 / 只允许 GET')

  // 出站地址白名单：全文件只有 UPSTREAM_URL 一个非 loopback URL
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

/**
 * 只取 CSS 常量（var CSS = [...].join('')），并去掉其中的 JS 注释（// 与 块注释）。
 * 否则注释里写到「position:fixed」也会被算进不变量，门禁会误报。
 */
function cssBlock(src) {
  const start = src.indexOf('var CSS = [')
  const end = src.indexOf("].join('')", start)
  if (start < 0 || end < 0) return ''
  return src.slice(start, end)
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return ''
      return line
    })
    .join('\n')
}
const css = cssBlock(clientSrc)
try {
  assert.ok(css.length > 500, '必须能取到 CSS 常量（否则下面的样式不变量检查都是空转）')
  assert.ok(css.includes('.dwp-panel{') && css.includes('.dwp-btn{'), 'CSS 常量里必须有抽屉与入口按钮的样式')
  assert.ok(!/^\s*import\s/m.test(clientSrc), '客户端 bundle 里不能出现 import 语句')
  assert.ok(!/^\s*export\s/m.test(clientSrc), '客户端 bundle 里不能出现 export 语句')
  assert.ok(clientSrc.includes('window.__ModuleLoader__.load'), '必须通过 window.__ModuleLoader__.load 注册 factory')
  assert.ok(!clientSrc.includes('@deepseek-ai/'), '没有跨插件值导入（module purity）')
  assert.ok(/id:\s*'dsh-weekly-panel'/.test(clientSrc), "load 的 id 必须是 dsh-weekly-panel")
  ok('经典脚本形态 / 无 import-export / 无跨插件值导入 / load id 正确')

  assert.ok(clientSrc.includes("'sidebar.footer.action'"), '必须注册到 sidebar.footer.action（侧边栏底部）')
  assert.ok(/ENTRY_ORDER\s*=\s*20/.test(clientSrc), 'order 必须是 20（workbench 用 15，不能撞）')
  assert.ok(clientSrc.includes('📊 周榜'), '按钮文字必须是「📊 周榜」')
  assert.ok(clientSrc.includes("'/weekly-panel/data'"), '数据必须来自宿主半路由 /weekly-panel/data')
  assert.ok(clientSrc.includes('https://514006234.github.io/dsh-weekly-check/'), '必须带「完整榜单」链接')
  assert.ok(clientSrc.includes('https://514006234.github.io/dsh-weekly-check/sponsor/'), '必须带「商务合作」链接')
  assert.ok(clientSrc.includes('本期推荐（赞助）') && clientSrc.includes("'赞助'"), '赞助位必须明确标注「赞助」')
  assert.ok(/fetch\(\s*DATA_ROUTE/.test(clientSrc), '客户端只能 fetch 宿主半路由（DATA_ROUTE）')
  assert.ok(!/fetch\(\s*['"]https?:/.test(clientSrc), '客户端不得直接打外网地址')
  ok('槽位 / order 20 / 文案 / 宿主半路由 / 两个外链 / 赞助标注')

  // 抽屉「不遮挡对话」的三条不变量（只看 CSS 常量，避免被注释误导）
  assert.ok(/\.dwp-panel>\*\{flex:0 0 auto;\}/.test(css), '面板子项必须禁止收缩（否则内容被压扁裁切）')
  assert.ok(/\.dwp-panel\{[^}]*max-height:min\(46vh,440px\)/.test(css), '面板必须限高（在流内挤出空间，而不是盖住对话）')
  assert.ok(/\.dwp-panel\{[^}]*overflow:auto/.test(css), '面板必须自带滚动')
  assert.ok(/\.dwp-badge\{flex:0 0 auto/.test(css), '角标必须 flex:0 0 auto（否则被压变形）')
  const fixedCount = (css.match(/position:fixed/g) || []).length
  assert.equal(fixedCount, 1, '只允许一处 position:fixed（侧边栏收起时的临时浮层），实际 ' + fixedCount + ' 处')
  assert.ok(/\.dwp-entry\.is-float \.dwp-panel\{[^}]*position:fixed/.test(css), '唯一那处 fixed 必须挂在 .is-float（rail 形态）上')
  const zIndexes = [...css.matchAll(/z-index:(\d+)/g)].map((m) => Number(m[1]))
  assert.ok(zIndexes.length >= 1, '浮层必须显式声明 z-index')
  assert.ok(Math.max(...zIndexes) <= 90, 'z-index 不得超过 90（必须低于宿主弹窗层级），实际 ' + Math.max(...zIndexes))
  // 注意锚点：不能用裸的 /\.dwp-panel\{position:/，那会命中
  // 「.dwp-entry.is-float .dwp-panel{position:fixed…}」这条合法规则的尾巴
  assert.ok(!/(?:^|[};])\.dwp-panel\{[^}]*position:/.test(css), '默认（宽屏）面板不得脱离文档流')
  ok('抽屉不遮挡对话：在流内 + 仅 rail 浮层 + z-index ≤ 90 + 自带滚动/限高')
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
  assert.equal(Array.isArray(mod.inject) || mod.inject instanceof Array, true, 'exports.inject 必须是数组')
  assert.equal(mod.inject.length, 1, 'exports.inject 长度必须是 1')
  assert.equal(mod.inject[0], 'slots', "exports.inject 必须严格等于 ['slots']")
  assert.equal(mod.name, pkg.name, 'exports.name 必须等于包名')
  ok("require 白名单内 / exports.apply / exports.inject === ['slots']")
} catch (err) { fail('factory 导出契约', err.message) }

// ── [6] 槽位注册调用 ──────────────────────────────────────────────────────
console.log('[6] 槽位注册调用（假 ctx）')
try {
  const events = []
  let registerOptions = null
  let Component = null
  const slots = {
    inject(key, cb) { events.push(['inject', key]); return cb() },
    register(options, component) { registerOptions = options; Component = component; return () => {} },
    entries() { return [] },
  }
  const ctx = { get: (name) => (name === 'slots' ? slots : undefined) }
  mod.apply(ctx)
  assert.deepEqual(events, [['inject', 'sidebar.footer.action']], '必须 inject 到 sidebar.footer.action')
  assert.equal(registerOptions.name, 'sidebar.footer.action', 'register 的 name 必须是 sidebar.footer.action')
  assert.equal(registerOptions.id, pkg.name, 'register 的 id 必须是包名')
  assert.equal(registerOptions.order, 20, 'register 的 order 必须是 20')
  assert.equal(registerOptions.label, '周榜', 'register 的 label 必须是「周榜」')
  assert.equal(typeof Component, 'function', '组件必须是函数')
  ok('sidebar.footer.action 注册 / id / order 20 / label 齐全')

  // 拿不到 slots 服务时必须安静跳过，绝不抛
  let threw = null
  try { mod.apply({ get: () => undefined }) } catch (err) { threw = err }
  assert.equal(threw, null, '拿不到 slots 时必须安静跳过：' + (threw && threw.message))
  ok('缺 slots 服务时安静跳过（不抛）')
} catch (err) { fail('槽位注册调用', err.message) }

// ── [7] 宿主半运行时契约（注入假 fetch / 假 req / 假 res，零网络）────────────
console.log('[7] 宿主半运行时契约（零网络）')
const HOST = ALLOWED_URL
const PAYLOAD = { date: '2026-10-02', plugins: [{ repo: 'a/b', name: '示例', stars: 12 }], stat: { total: 1, ok: 1 } }

function fakeReq(over = {}) {
  return Object.assign({
    method: 'GET',
    url: '/weekly-panel/data',
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
  assert.equal(host.UPSTREAM_URL, HOST, '导出的 UPSTREAM_URL 必须与门禁核对的一致')
  assert.equal(host.CACHE_TTL_MS, 30 * 60 * 1000, 'CACHE_TTL_MS 必须是 30 分钟')
  assert.equal(host.ROUTE_DATA, '/weekly-panel/data', 'ROUTE_DATA 必须是 /weekly-panel/data')
  assert.equal(typeof host.handleData, 'function', '必须导出 handleData 供测试直接调用')
  assert.equal(typeof host.createStore, 'function', '必须导出 createStore 供测试直接调用')
  ok('导出契约：UPSTREAM_URL / CACHE_TTL_MS / ROUTE_DATA / handleData / createStore')

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

  // (d) 非 JSON / 数组响应也算失败，不算成功
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
    assert.ok(effectLabels.some((l) => String(l).includes('dsh-weekly-panel')), '必须用 ctx.effect 包住注册（可回收）')

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
