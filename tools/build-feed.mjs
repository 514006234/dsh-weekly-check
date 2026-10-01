// tools/build-feed.mjs — 生成 RSS 2.0 / Atom 双格式订阅源（周报存档做内容源）
//
//   node tools/build-feed.mjs        # 生成 report/feed.xml + report/atom.xml
//
// 为什么要有：README 里把 RSS 列为下一步；它让"每周自动更新"变成别人可以**订阅**的东西，
// 而不是每次都要重新打开网页。内容全部来自 report/archive/*.html（已存在的历史留档），不编造。
// 周报本体在微信/群里发；RSS 是给"愿意订阅的人"和搜索引擎的入口。

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const REPORT = resolve(ROOT, 'report')
const ARCHIVE = resolve(REPORT, 'archive')

const SITE = 'https://514006234.github.io/dsh-weekly-check/'
const FEED_URL = SITE + 'feed.xml'
const ATOM_URL = SITE + 'atom.xml'
const TITLE = 'DSH 插件周榜'
const DESC = '每周自动更新的中文 DSH 插件榜：实时星数 + 本周涨星 + 免费模型真实调用可用性 + 星数陷阱提示。'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// 收集存档（按文件名日期倒序）
const items = []
for (const f of readdirSync(ARCHIVE)) {
  if (!f.endsWith('.html')) continue
  const date = f.replace(/\.html$/, '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
  const full = resolve(ARCHIVE, f)
  const html = readFileSync(full, 'utf8')
  // 只抽「本期要点」那一段的 li（整页有多个 points 列表，混进方法论会误导订阅者）
  const startIdx = html.indexOf('一、本期要点')
  const endIdx = startIdx >= 0 ? html.indexOf('<h2>', startIdx + 5) : -1
  const seg = startIdx >= 0 && endIdx > startIdx ? html.slice(startIdx, endIdx) : html.slice(0, 4000)
  const bullets = [...seg.matchAll(/<li>(.*?)<\/li>/gs)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim())
    .filter((s) => s.length > 10)
    .slice(0, 3)
  const plugins = html.match(/插件榜（(\d+)）/)   // "二、插件榜（31）"
  const pubDate = new Date(date + 'T09:00:00+08:00').toUTCString()
  items.push({
    date,
    url: SITE + 'archive/' + date + '.html',
    pubDate,
    iso: new Date(date + 'T09:00:00+08:00').toISOString(),
    count: plugins ? plugins[1] : '',
    summary: bullets.join('；') || DESC,
  })
}
items.sort((a, b) => (a.date < b.date ? 1 : -1))

if (!items.length) { console.error('ERROR report/archive 下没有存档'); process.exit(2) }
const last = items[0]

// ── RSS 2.0 ────────────────────────────────────────────────────────────
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(TITLE)}</title>
  <link>${SITE}</link>
  <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml"/>
  <description>${esc(DESC)}</description>
  <language>zh-cn</language>
  <lastBuildDate>${last.pubDate}</lastBuildDate>
${items.map((it) => `  <item>
    <title>${esc(TITLE + ' · ' + it.date + (it.count ? '（' + it.count + ' 个插件）' : ''))}</title>
    <link>${it.url}</link>
    <guid isPermaLink="true">${it.url}</guid>
    <pubDate>${it.pubDate}</pubDate>
    <description>${esc(it.summary)}</description>
  </item>`).join('\n')}
</channel>
</rss>
`

// ── Atom ───────────────────────────────────────────────────────────────
const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-CN">
  <title>${esc(TITLE)}</title>
  <subtitle>${esc(DESC)}</subtitle>
  <link href="${SITE}"/>
  <link href="${ATOM_URL}" rel="self" type="application/atom+xml"/>
  <id>${SITE}</id>
  <updated>${last.iso}</updated>
${items.map((it) => `  <entry>
    <title>${esc(TITLE + ' · ' + it.date + (it.count ? '（' + it.count + ' 个插件）' : ''))}</title>
    <link href="${it.url}"/>
    <id>${it.url}</id>
    <updated>${it.iso}</updated>
    <summary>${esc(it.summary)}</summary>
  </entry>`).join('\n')}
</feed>
`

writeFileSync(resolve(REPORT, 'feed.xml'), rss, 'utf8')
writeFileSync(resolve(REPORT, 'atom.xml'), atom, 'utf8')
console.log(`[ok] feed.xml + atom.xml（${items.length} 期：${items.map((i) => i.date).join(', ')}）`)
console.log('  最新一期：' + last.url)
