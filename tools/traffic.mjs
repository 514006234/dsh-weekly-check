// tools/traffic.mjs — 仓库影响力采集（GitHub 真实数据，进周报固定栏目）
//
//   node tools/traffic.mjs           # 采集 + 打印摘要（写 data/traffic.json 与历史）
//   node tools/traffic.mjs --json    # 打印完整 payload（JSON，build-report 用这个）
//   node tools/traffic.mjs --no-write
//
// 数据来源（全部是 GitHub 官方 API）：
//   · /traffic/views    —— 仓库页浏览量（滚动近 14 天，含每日独立数）
//   · /traffic/clones   —— 克隆量（滚动近 14 天）
//   · /traffic/referrers—— 引荐来源（从哪里点进来的；新建仓库常返回 404 = 无数据，不是错误）
//   · 仓库元信息        —— star / fork / 关注者
//
// 权限：traffic 系列要求 token 对仓库有推送权限（本人 PAT 或 Actions 的 GITHUB_TOKEN）。
//
// 容错纪律（都是本机踩过的坑）：
//   · 每个端点独立 try/catch：referrers 404 当"无引荐"，views/clones 缺失当 0，不互相拖死
//   · 拿不到任何数据 → 只设 process.exitCode=2，**绝不在网络请求后 process.exit**：
//     那会在 Windows 上触发 libuv 的 UV_HANDLE_CLOSING 断言（进程直接 0xC0000147 崩掉）
//   · 历史快照存 data/traffic-history.json（按日期，保留 60 期），供"较上次采集"对比

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA = resolve(ROOT, 'data')
const GH = (process.env.DSH_GH_API || 'https://api.github.com').replace(/\/+$/, '')
const REPO = process.env.DSH_REPORT_REPO || '514006234/dsh-weekly-check'
const TOKEN = process.env.GITHUB_TOKEN || ''

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const noWrite = argv.includes('--no-write')

const HEAD = {
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-weekly-biz',
  ...(TOKEN ? { authorization: 'Bearer ' + TOKEN } : {}),
}

async function api(path) {
  const res = await fetch(GH + path, { headers: HEAD })
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status + ' on ' + path)
    err.status = res.status
    throw err
  }
  return res.json()
}

/** 把失败原因压成一行可落盘的文本：HTTP 状态 + GitHub 的说明（截断），或网络异常信息 */
function describeErr(reason) {
  if (!reason) return 'unknown'
  const status = reason.status ? ('HTTP ' + reason.status) : ''
  const detail = reason.message ? String(reason.message).replace(/\s+/g, ' ').slice(0, 160) : ''
  const cause = reason.cause && reason.cause.message ? ' ← ' + String(reason.cause.message).slice(0, 120) : ''
  return (status ? status + ' ' : '') + detail + cause || 'unknown'
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

const BJT = (d = new Date()) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)

// ── 四路采集，各自独立容错 ────────────────────────────────────────────────
const [rInfo, rViews, rClones, rRef] = await Promise.allSettled([
  api('/repos/' + REPO),
  api('/repos/' + REPO + '/traffic/views'),
  api('/repos/' + REPO + '/traffic/clones'),
  api('/repos/' + REPO + '/traffic/referrers'),
])

const info = rInfo.status === 'fulfilled' ? rInfo.value : null
const views = rViews.status === 'fulfilled' ? rViews.value : null
const clones = rClones.status === 'fulfilled' ? rClones.value : null
const referrers = rRef.status === 'fulfilled' ? (rRef.value || []) : null

if (!info && !views && !clones) {
  console.error('[traffic] 四路采集全部失败：'
    + [rInfo, rViews, rClones, rRef].map((r) => r.status === 'rejected' ? (r.reason && r.reason.message ? r.reason.message : 'unknown') : '').join(' / '))
  // 网络请求之后绝不 process.exit（Windows libuv 断言崩溃）；只标记退出码
  process.exitCode = 2
} else {
  // 关键：**不许用「空」覆盖上一次真采到的数字**。
  // 起因：GitHub Actions 的安装令牌读不到 /traffic/*（实测 403），而本地 PAT 可以（实测 200）。
  // 之前每期 CI 都用 views:null / clones:null 覆盖掉上一期的真实数字，于是线上永远显示
  // 「未采集到流量数据」——好数据被坏采集毁掉。现在失败时沿用上一次的数字，并标注它的采集时间。
  const prevPayload = readJson(resolve(DATA, 'traffic.json'), null)
  const carryViews = !views && prevPayload && prevPayload.views && typeof prevPayload.views.total === 'number' ? prevPayload.views : null
  const carryClones = !clones && prevPayload && prevPayload.clones && typeof prevPayload.clones.total === 'number' ? prevPayload.clones : null
  const carriedFrom = carryViews || carryClones ? (prevPayload.collectedAt || null) : null

  const payload = {
    collectedAt: new Date().toISOString(),
    repo: REPO,
    windowDays: 14,
    stars: info ? (info.stargazers_count ?? null) : (prevPayload ? prevPayload.stars ?? null : null),
    forks: info ? (info.forks_count ?? null) : (prevPayload ? prevPayload.forks ?? null : null),
    watchers: info ? (info.subscribers_count ?? null) : (prevPayload ? prevPayload.watchers ?? null : null),
    views: views
      ? {
          total: views.count ?? 0,
          days: (views.views || []).map((v) => ({ date: String(v.timestamp).slice(0, 10), count: v.count, uniques: v.uniques })),
        }
      : carryViews,
    clones: clones
      ? {
          total: clones.count ?? 0,
          days: (clones.clones || []).map((c) => ({ date: String(c.timestamp).slice(0, 10), count: c.count, uniques: c.uniques })),
        }
      : carryClones,
    // 沿用旧数字时，明确写清它是哪次采集的——不许把旧数据伪装成本期新数据
    carriedFrom,
    // referrers 404 = 新仓库还没有任何引荐记录（GitHub 的行为），归为"无引荐"而不是错误
    referrers: referrers === null ? [] : referrers.map((r) => ({ referrer: r.referrer, count: r.count, uniques: r.uniques })),
    referrersError: referrers === null && rRef.status === 'rejected'
      ? (rRef.reason && rRef.reason.status === 404 ? '404（新建仓库还没有引荐记录）' : (rRef.reason && rRef.reason.message ? rRef.reason.message : 'unknown'))
      : null,
    partial: {
      info: !info,
      views: !views,
      clones: !clones,
    },
    // 失败原因必须落盘。之前这里把 reason 丢掉了，只留一个 partial:true，
    // 结果线上连续几期都写「未采集到流量数据」，而没人能从产物里看出到底是 403、限流还是网络问题
    // ——「失败却不留证据」本身就是缺陷。
    errors: {
      info: rInfo.status === 'rejected' ? describeErr(rInfo.reason) : null,
      views: rViews.status === 'rejected' ? describeErr(rViews.reason) : null,
      clones: rClones.status === 'rejected' ? describeErr(rClones.reason) : null,
      referrers: rRef.status === 'rejected' ? describeErr(rRef.reason) : null,
    },
    // 采集时用的是哪种凭据（只记有无与长度，绝不记录值）
    tokenPresent: !!TOKEN,
    tokenHint: TOKEN ? ('已提供（长度 ' + TOKEN.length + '）') : '未提供',
  }

  // ── 历史快照（供"较上次采集"对比）─────────────────────────────────────
  const histFile = resolve(DATA, 'traffic-history.json')
  const history = readJson(histFile, {})
  const today = BJT()
  const prevDates = Object.keys(history).filter((d) => d < today).sort()
  const prev = prevDates.length ? history[prevDates[prevDates.length - 1]] : null
  payload.prev = prev
    ? { asOf: prevDates[prevDates.length - 1], views: prev.views ?? null, clones: prev.clones ?? null, stars: prev.stars ?? null }
    : null

  if (!noWrite) {
    mkdirSync(DATA, { recursive: true })
    writeFileSync(resolve(DATA, 'traffic.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8')
    history[today] = {
      views: payload.views ? payload.views.total : null,
      clones: payload.clones ? payload.clones.total : null,
      stars: payload.stars, forks: payload.forks, watchers: payload.watchers,
    }
    const keep = Object.keys(history).sort().slice(-60)
    writeFileSync(histFile, JSON.stringify(Object.fromEntries(keep.map((d) => [d, history[d]])), null, 2) + '\n', 'utf8')
  }

  if (asJson) {
    console.log(JSON.stringify(payload))
  } else {
    console.log(`[流量] ${REPO}`)
    console.log(`  仓库 ★${payload.stars} · fork ${payload.forks} · 关注 ${payload.watchers}`)
    console.log(`  近 ${payload.windowDays} 天页面浏览 ${payload.views ? payload.views.total : '未取到'} 次 · 克隆 ${payload.clones ? payload.clones.total : '未取到'} 次`)
    if (payload.prev) {
      const dv = payload.views && typeof payload.prev.views === 'number' ? (payload.views.total - payload.prev.views) : null
      console.log(`  较上次采集（${payload.prev.asOf}）浏览 ${dv === null ? '—' : (dv >= 0 ? '+' + dv : dv)}`)
    }
    if (payload.referrers.length === 0) {
      console.log('  引荐来源：暂无外部引荐' + (payload.referrersError ? `（${payload.referrersError}）` : '（还没有人从别处点进来）'))
    } else {
      console.log('  引荐来源（仓库历史累计）：')
      for (const r of payload.referrers) console.log(`    ${r.referrer} → ${r.count} 次（${r.uniques} 独立）`)
    }
    if (payload.partial.info || payload.partial.views || payload.partial.clones) {
      console.log('  [注意] 有端点未取到（' + Object.entries(payload.partial).filter(([, v]) => v).map(([k]) => k).join('/') + '），周报将按缺失降级显示')
    }
  }
}
