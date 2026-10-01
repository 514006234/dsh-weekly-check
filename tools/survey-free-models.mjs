// tools/survey-free-models.mjs — DSH 免费模型可用性周报数据源（CLI）
//
// 跑一条真实补全，逐个测 OpenCode Zen 免费车道的可用性与延迟。
// 复用 dsh-our-free-model 插件自己的 gatewayHeaders/applyFingerprint/endpointFor ——
// 测的就是插件真实走的传输与指纹（UA + bash/glob/grep/read 四件套）。
//
// 用法：
//   node tools/survey-free-models.mjs                 # Markdown 表格（stdout）
//   node tools/survey-free-models.mjs --json          # JSON 行
//   node tools/survey-free-models.mjs --plugin <dir>  # 指定插件源码目录
//
// 退出码：0 = 全部有可用模型；1 = 无一可用；2 = 环境问题（找不到插件/上游挂了）

import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const DUMP = argv.includes('--dump')
const pluginArg = argv.indexOf('--plugin')

// 插件源码目录候选顺序：显式参数 > 环境变量 > 工作区克隆 > 本机已安装的 profile 副本
const CANDIDATES = [
  resolve(HERE, '..', '..', 'dsh-our-free-model'),
  resolve(HERE, '..', 'dsh-our-free-model'),
  join(homedir(), '.dsh', 'profiles', 'node_modules', 'dsh-our-free-model'),
]
const PLUGIN_DIR = pluginArg >= 0
  ? resolve(argv[pluginArg + 1])
  : process.env.DSH_PLUGIN_SRC || CANDIDATES.find((d) => existsSync(resolve(d, 'src', 'upstream.js'))) || CANDIDATES[0]

const UPSTREAM = resolve(PLUGIN_DIR, 'src', 'upstream.js')
if (!existsSync(UPSTREAM)) {
  console.error('ERROR 找不到插件源码：' + UPSTREAM)
  console.error('      先 git clone --depth 1 https://github.com/zouyuxuan122/dsh-our-free-model')
  console.error('      或用 --plugin <dir> 指定路径，或设 DSH_PLUGIN_SRC。')
  console.error('      已尝试：' + CANDIDATES.join(' | '))
  process.exit(2)
}

const { endpointFor, wireFor, gatewayHeaders, applyFingerprint, mintSessionId, mintRequestId } =
  await import(pathToFileURL(UPSTREAM).href)

const TIMEOUT_MS = 40000
const QUARTET = ['bash', 'glob', 'grep', 'read']
const PROMPT = '只回复两个字：通了'
const attemptArg = argv.indexOf('--attempts')
const ATTEMPTS = Math.max(1, Math.min(4, Number(attemptArg >= 0 ? argv[attemptArg + 1] : 2) || 2))

// ── 免费车道清单（与插件 isFreeLane 同规则：-free 后缀）────────────────
async function freeModels() {
  const res = await fetch('https://opencode.ai/zen/v1/models', { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error('上游清单 HTTP ' + res.status)
  const json = await res.json()
  const list = Array.isArray(json) ? json : (json.data ?? json.models ?? [])
  return list.map((m) => m.id).filter((id) => typeof id === 'string' && /(?:^|[-_])free(?:$|[-_.])/.test(id))
}

// ── 请求体：按 wire 分三种形状 ─────────────────────────────────────────
function chatTools() {
  return QUARTET.map((n) => ({ type: 'function', function: { name: n, description: n, parameters: { type: 'object', properties: {} } } }))
}
function flatTools() {
  return QUARTET.map((n) => ({ type: 'function', name: n, description: n, parameters: { type: 'object', properties: {} } }))
}
function buildBody(model, wire) {
  if (wire === 'responses') {
    return {
      model, stream: true, max_output_tokens: 64,
      input: [{ role: 'user', content: [{ type: 'input_text', text: PROMPT }] }],
      tools: flatTools(),
    }
  }
  if (wire === 'messages') {
    return { model, max_tokens: 64, stream: true, messages: [{ role: 'user', content: PROMPT }] }
  }
  return { model, stream: true, max_tokens: 64, messages: [{ role: 'user', content: PROMPT }], tools: chatTools() }
}

// ── SSE 解析：data: {json} 里取正文 ────────────────────────────────────
// 三种线路都要认：chat（choices[].delta.content）、messages（content[].text）、
// responses（{type:'response.output_text.delta', delta}）。
// 另外 reasoning 类增量单独计数——有的模型只吐思考、正文为空，那也算"通了"。
function extractText(buf) {
  const out = []
  let reasoning = 0
  for (const m of buf.matchAll(/^data:\s*(\{[\s\S]*?\})\s*$/gm)) {
    if (m[1].trim() === '[DONE]') continue
    let json
    try { json = JSON.parse(m[1].trim()) } catch { continue }
    const delta = json?.choices?.[0]?.delta
    if (delta && typeof delta.content === 'string') out.push(delta.content)
    if (delta && typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content.length
    if (typeof json?.delta === 'string' && String(json?.type || '').includes('output_text')) out.push(json.delta)
    if (Array.isArray(json?.content)) {
      for (const part of json.content) if (typeof part?.text === 'string') out.push(part.text)
    }
    if (Array.isArray(json?.choices?.[0]?.message?.content)) {
      for (const part of json.choices[0].message.content) if (typeof part?.text === 'string') out.push(part.text)
    }
  }
  // 非流式兜底：整个响应体就是一个 JSON 对象
  if (!out.length && !reasoning && buf.trim().startsWith('{')) {
    try {
      const json = JSON.parse(buf)
      const c = json?.choices?.[0]?.message?.content ?? json?.content
      if (typeof c === 'string') out.push(c)
      else if (Array.isArray(c)) for (const p of c) if (typeof p?.text === 'string') out.push(p.text)
    } catch { /* 忽略 */ }
  }
  return { text: out.join(''), reasoning }
}
function errorText(raw) {
  const m = raw.match(/"message"\s*:\s*"([^"]{0,300})/)
  return m ? m[1] : raw.slice(0, 300)
}

// HTTP 200 的流里也可能夹着 error 事件（上游 503 等）——必须认出来，
// 否则会把"上游抽风"误报成"可用"。
function streamError(buf) {
  for (const line of buf.split('\n')) {
    const s = line.trim()
    if (!s.startsWith('data:')) continue
    const payload = s.slice(5).trim()
    if (!payload.startsWith('{')) continue
    try {
      const obj = JSON.parse(payload)
      if (obj?.error) return obj.error.message || obj.error.type || 'stream error'
    } catch { /* 不是完整 JSON，继续看下一行 */ }
  }
  return ''
}

// ── 分类：区分"真下线"与"上游临时抽风" ─────────────────────────────────
function classify(r) {
  const err = String(r.err || '')
  if (r.status === 429) return 'limited'
  if (err.includes('not available in your country') || err.includes('not available in your region')) return 'region'
  if (r.status === 400 && /unavailable|Endpoint is unavailable|not found|invalid model/i.test(err)) return 'gone'
  if (r.status === 404) return 'gone'
  if (r.status >= 500 || /temporarily|overloaded|timeout|超时|keep-alive|ECONNRESET|fetch failed|502|503|504/i.test(err)) return 'flaky'
  if (r.status === 200) return 'flaky'   // 200 但没吐正文：多为上游抖动
  return 'gone'
}
const LABEL = { ok: '✅ 可用', limited: '⚠️ 限流', region: '🚫 地区墙', gone: '❌ 已下线', flaky: '🔁 上游波动' }

// ── 单模型探测 ─────────────────────────────────────────────────────────
async function probe(model) {
  const path = endpointFor(model)
  const wire = wireFor(model)
  const body = buildBody(model, wire)
  if (wire !== 'messages') applyFingerprint(body, wire === 'responses')
  const headers = gatewayHeaders({ session: mintSessionId(), requestId: mintRequestId(), stream: true, accept: 'text/event-stream' })
  if (wire === 'messages') headers['anthropic-version'] = '2023-06-01'

  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let status = 0, buf = '', ttfb = null, err = ''
  try {
    const res = await fetch('https://opencode.ai' + path, {
      method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal, redirect: 'error',
    })
    status = res.status
    if (res.ok) {
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (ttfb === null) ttfb = (Date.now() - t0) / 1000
        buf += dec.decode(value, { stream: true })
      }
    } else {
      err = errorText(await res.text())
    }
  } catch (e) {
    err = e?.name === 'AbortError' ? '超时 ' + TIMEOUT_MS / 1000 + 's' : String(e?.message ?? e)
  } finally {
    clearTimeout(timer)
  }
  const total = (Date.now() - t0) / 1000
  const { text, reasoning } = extractText(buf)
  const ok = status === 200 && (text.length > 0 || reasoning > 0)
  if (!ok && !err) {
    err = streamError(buf) || (status === 200 ? 'HTTP 200 但无正文' : 'HTTP ' + status)
  }
  const row = { model, wire, status, ttfb, total, text, reasoning, err, ok, attempts: 1, lastError: '' }
  row.verdict = ok ? 'ok' : classify(row)
  if (DUMP && !ok) row.raw = buf.slice(0, 1200)
  return row
}

// 抖动重试：只重试 flaky，且最多 ATTEMPTS 次；成功则采用成功那次的数据
async function probeWithRetry(model) {
  let row = await probe(model)
  while (!row.ok && row.verdict === 'flaky' && row.attempts < ATTEMPTS) {
    await new Promise((r) => setTimeout(r, 1500))
    const again = await probe(model)
    again.attempts = row.attempts + 1
    again.lastError = row.err
    row = again
  }
  return row
}

// ── 主流程 ─────────────────────────────────────────────────────────────
// 位置参数 = 只测这些模型；跳过 --plugin 的值与其它开关
const models = argv.filter((a, i) => !a.startsWith('--') && i !== pluginArg + 1)
let list
try {
  list = models.length ? models : await freeModels()
} catch (e) {
  console.error('ERROR 拉取上游清单失败：' + e.message)
  process.exit(2)
}
if (list.length === 0) {
  console.error('ERROR 上游清单里没有免费模型（规则变了？）')
  process.exit(2)
}

const rows = []
for (const model of list) rows.push(await probeWithRetry(model))

const ok = rows.filter((r) => r.ok)
const count = (v) => rows.filter((r) => r.verdict === v).length
const ttfbs = ok.map((r) => r.ttfb).filter((x) => x !== null).sort((a, b) => a - b)
const stat = {
  total: rows.length,
  ok: ok.length,
  limited: count('limited'),
  region: count('region'),
  gone: count('gone'),
  flaky: count('flaky'),
  retried: rows.filter((r) => r.attempts > 1).length,
  ttfbFast: ttfbs[0] ?? null,
  ttfbMid: ttfbs[Math.floor(ttfbs.length / 2)] ?? null,
  ttfbSlow: ttfbs[ttfbs.length - 1] ?? null,
}

if (asJson) {
  console.log(JSON.stringify({ rows, stat }, null, 0))
} else {
  console.log('| 状态 | 模型 | 线路 | 首字延迟 | 总耗时 | 结果 |')
  console.log('|---|---|---|---|---|---|')
  for (const r of rows) {
    const body = r.text || (r.reasoning ? `[仅思考 ${r.reasoning} 字]` : '')
    let detail = r.ok ? JSON.stringify(body).slice(0, 40) : (r.err || 'HTTP ' + r.status).slice(0, 120)
    if (r.attempts > 1 && !r.ok) detail += `（重试 ${r.attempts} 次）`
    if (r.attempts > 1 && r.ok) detail += `（首次失败：${(r.lastError || '').slice(0, 40)}，重试后可用）`
    console.log(`| ${LABEL[r.verdict]} | \`${r.model}\` | ${r.wire} | ${r.ttfb === null ? '—' : r.ttfb.toFixed(2) + 's'} | ${r.total.toFixed(1)}s | ${detail} |`)
  }
  console.error(`[统计] 可用 ${stat.ok}/${stat.total}｜限流 ${stat.limited}｜地区墙 ${stat.region}｜已下线 ${stat.gone}｜上游波动 ${stat.flaky}（重试过 ${stat.retried} 个）`
    + (stat.ttfbMid !== null ? `｜TTFB 最快 ${stat.ttfbFast.toFixed(2)}s / 中位 ${stat.ttfbMid.toFixed(2)}s / 最慢 ${stat.ttfbSlow.toFixed(2)}s` : ''))
  if (DUMP) {
    for (const r of rows.filter((x) => !x.ok)) {
      console.error(`\n──── raw: ${r.model} (HTTP ${r.status}) ────\n${(r.raw || '').replace(/\n/g, '\\n').slice(0, 1200)}`)
    }
  }
}

process.exit(ok.length > 0 ? 0 : 1)
