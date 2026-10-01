// dsh-weekly-panel — host half（宿主半，v0.1.0）。
//
// 这一半只做一件事：把《DSH 插件周榜》的公开数据（GitHub Pages 上的 latest.json）
// 取回来，并用自己的内存缓存挡住重复请求。
//
//   GET /weekly-panel/data
//        → { ok:true, cached:boolean, stale:boolean, ageMs:number, data:<latest.json> }
//        → { ok:false, reason:string }        （上游拿不到、且连旧缓存也没有时）
//
// 边界（每条都是代码里强制的）：
//   * 仅 loopback 且同源（沿用同机已验证插件 dsh-workbench-lite / dsh-deepseek-usage 的
//     DNS-rebinding 防护写法：remoteAddress + Host 解析 + sec-fetch-site + Origin）
//   * 只接受 GET；其余方法一律 405
//   * **唯一出站地址**就是 UPSTREAM_URL 这一个 https 常量，不接受任何请求参数、不转发任何头
//   * 内存缓存 30 分钟；上游失败时退回上一次成功的缓存（响应里标 stale:true）
//   * 不写任何文件、不读任何本地文件、不接触任何凭据
//   * handleData 吞掉所有异常：任何情况下都以 JSON 答复，绝不把异常抛进 HTTP 栈
//
// 为什么用 ctx.inject 兜底：Cordis 的 ctx.get(name) 在提供方 fiber 未 active 时会**静默**
// 返回 undefined，直接 ctx.webServer.register 可能在启动早期悄悄失败。所以两条路都走：
// 服务已在位就立刻注册；不在位就 ctx.inject(['webServer'], …) 等它出现再注册。

export const name = 'dsh-weekly-panel'
export const inject = ['webServer']

/** 唯一允许的出站地址（静态门禁 tools/gate.mjs 会逐字核对）。 */
export const UPSTREAM_URL = 'https://514006234.github.io/dsh-weekly-check/latest.json'
/** 内存缓存时长：30 分钟。 */
export const CACHE_TTL_MS = 30 * 60 * 1000
/** 单次上游请求的超时（毫秒）。 */
export const FETCH_TIMEOUT_MS = 10000
/** 本插件唯一的路由。 */
export const ROUTE_DATA = '/weekly-panel/data'

const MAX_BYTES_HINT = 4 * 1024 * 1024

/** 仅 loopback + 同源；否则拒绝（DNS rebinding 防护）。 */
function isLoopbackRequest(req, requireOrigin = false) {
  const addr = req.socket && req.socket.remoteAddress
  if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') return false
  const host = req.headers && req.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try { hostUrl = new URL('http://' + host) } catch { return false }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return !requireOrigin
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function guard(req, res, method) {
  if (!isLoopbackRequest(req)) {
    json(res, 403, { ok: false, code: 'forbidden' })
    return false
  }
  if (req.method !== method) {
    json(res, 405, { ok: false, code: 'method-not-allowed' })
    return false
  }
  return true
}

function errorText(err) {
  if (!err) return '未知错误'
  if (err.name === 'AbortError') return '上游请求超时（' + FETCH_TIMEOUT_MS / 1000 + 's）'
  return err.message ? String(err.message) : String(err)
}

/**
 * 建一个数据仓库（内存缓存 + 单飞请求）。
 *
 * 之所以做成工厂而不是模块级单例：测试可以注入假 fetch / 假时钟，
 * 把「命中缓存」「超时」「上游 500」「缓存过期后退回旧值」这些路径都跑到。
 *
 * @param options.fetchImpl - 假 fetch（默认用全局 fetch）
 * @param options.now - 假时钟（默认 Date.now）
 * @param options.ttlMs - 缓存时长（默认 CACHE_TTL_MS）
 */
export function createStore(options = {}) {
  const fetchImpl = options.fetchImpl || ((url, init) => fetch(url, init))
  const now = options.now || (() => Date.now())
  const ttlMs = typeof options.ttlMs === 'number' ? options.ttlMs : CACHE_TTL_MS

  let cache = { data: null, at: 0 }
  let inflight = null

  /**
   * 取数据。永不抛异常，返回值描述结果：
   *   { data, cached, stale, ageMs }          —— 成功（可能来自缓存）
   *   { data:null, reason }                   —— 既没有缓存也拿不到
   */
  async function load(force = false) {
    const age = now() - cache.at
    if (!force && cache.data !== null && age < ttlMs) {
      return { data: cache.data, cached: true, stale: false, ageMs: age }
    }
    if (inflight) return inflight

    const task = (async () => {
      let timer = null
      try {
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        if (controller) timer = setTimeout(() => { try { controller.abort() } catch { /* 忽略 */ } }, FETCH_TIMEOUT_MS)
        const res = await fetchImpl(UPSTREAM_URL, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: controller ? controller.signal : undefined,
        })
        if (!res || res.ok !== true) throw new Error('上游 HTTP ' + (res && res.status ? res.status : '?'))
        const text = typeof res.text === 'function' ? await res.text() : null
        if (text !== null && text.length > MAX_BYTES_HINT) throw new Error('上游响应过大')
        const body = text !== null ? JSON.parse(text) : await res.json()
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('上游返回的不是 JSON 对象')
        cache = { data: body, at: now() }
        return { data: body, cached: false, stale: false, ageMs: 0 }
      } catch (err) {
        // 失败时优先继续用旧缓存（明确标 stale），实在没有才如实报错
        if (cache.data !== null) {
          return { data: cache.data, cached: true, stale: true, ageMs: now() - cache.at, reason: errorText(err) }
        }
        return { data: null, cached: false, stale: false, reason: errorText(err) }
      } finally {
        if (timer) clearTimeout(timer)
      }
    })()

    inflight = task
    try {
      return await task
    } finally {
      if (inflight === task) inflight = null
    }
  }

  /**
   * HTTP 入口：只读、永不抛。测试可直接调用。
   * @param request - Node IncomingMessage（只读 method/url/headers/socket）
   * @param response - Node ServerResponse
   */
  async function handleData(request, response) {
    if (!guard(request, response, 'GET')) return
    let result
    try {
      result = await load(false)
    } catch (err) {
      // 双保险：load 内部已经吞过异常，这里再兜一层，确保不会有异常逃到 HTTP 栈
      result = { data: null, reason: errorText(err) }
    }
    if (!result || !result.data) {
      json(response, 200, { ok: false, reason: (result && result.reason) || '上游暂时不可用' })
      return
    }
    json(response, 200, {
      ok: true,
      cached: result.cached === true,
      stale: result.stale === true,
      ageMs: typeof result.ageMs === 'number' ? result.ageMs : 0,
      data: result.data,
    })
  }

  return {
    handleData,
    load,
    peekCache: () => cache,
    clearCache: () => { cache = { data: null, at: 0 } },
  }
}

const defaultStore = createStore()

/** 默认实例的 HTTP 入口（供测试与 apply 复用）。 */
export const handleData = defaultStore.handleData
/** 看默认实例的缓存内容（测试用）。 */
export const peekCache = defaultStore.peekCache
/** 清默认实例的缓存（测试用）。 */
export const clearCache = defaultStore.clearCache

function warn(ctx, err) {
  const logger = ctx && ctx.logger
  const sink = (logger && (logger.warn || logger.info)) || (typeof console !== 'undefined' ? console.warn : null)
  if (!sink) return
  try { sink.call(logger || console, '[dsh-weekly-panel] ' + errorText(err)) } catch { /* 日志失败也不能影响加载 */ }
}

/**
 * 注册路由。优先直接用已在位的 webServer；不在位则用 ctx.inject 等它出现。
 * 注册失败不抛异常——插件加载不能因为一个只读面板而中断。
 */
export function apply(ctx) {
  const store = createStore()
  const route = {
    kind: 'exact',
    path: ROUTE_DATA,
    handler: (req, res) => { store.handleData(req, res) },
  }

  let server = null
  try { server = ctx && ctx.webServer ? ctx.webServer : null } catch { server = null }

  if (server && typeof server.register === 'function') {
    try {
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => {
          const dispose = server.register(route)
          return () => { try { if (typeof dispose === 'function') dispose() } catch { /* 忽略 */ } }
        }, 'dsh-weekly-panel: GET ' + ROUTE_DATA)
      } else {
        server.register(route)
      }
      return
    } catch (err) {
      warn(ctx, err)
    }
  }

  // 兜底：服务提供方还没 active（ctx.get/webServer 静默不可用），等它出现再注册
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (webCtx) => {
        try {
          const late = webCtx && webCtx.webServer
          if (!late || typeof late.register !== 'function') return
          const dispose = late.register(route)
          return () => { try { if (typeof dispose === 'function') dispose() } catch { /* 忽略 */ } }
        } catch (err) {
          warn(ctx, err)
          return undefined
        }
      })
    } catch (err) {
      warn(ctx, err)
    }
  }
}
