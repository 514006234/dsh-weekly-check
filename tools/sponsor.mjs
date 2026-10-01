// tools/sponsor.mjs — 管理周报的「赞助推荐位」（卖出去的东西必须真能兑现）
//
//   node tools/sponsor.mjs list
//   node tools/sponsor.mjs add --repo owner/name --name "中文名" --cn "推荐语" \
//        --tier "单期推荐" --days 7 --amount 299 --note "微信收款 2026-10-05"
//   node tools/sponsor.mjs remove --repo owner/name
//
// 规则（对外承诺，代码里也照着做）：
//   · 赞助位在周报里**独立成栏并标注「赞助」**，绝不混进正常榜单，绝不改榜单排序
//   · 推荐语由我们核实后撰写；--cn 是最终文案，不接受夸张或无法验证的描述
//   · 到期自动失效（按 until 与当期日期比较），不用手工下架

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const FILE = resolve(ROOT, 'data', 'sponsors.json')
const BJT = (d = new Date()) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)

mkdirSync(dirname(FILE), { recursive: true })
const store = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { sponsors: [] }
const argv = process.argv.slice(2)
const cmd = argv[0] || 'list'
const opt = (n, d = '') => (argv.includes('--' + n) ? argv[argv.indexOf('--' + n) + 1] : d)

const save = () => writeFileSync(FILE, JSON.stringify(store, null, 2) + '\n', 'utf8')
const active = (s) => !s.until || s.until >= BJT()

if (cmd === 'add') {
  const repo = opt('repo')
  const name = opt('name')
  const cn = opt('cn')
  const amount = Number(opt('amount', '0'))
  if (!repo || !name || !cn) { console.error('ERROR 需要 --repo --name --cn'); process.exit(2) }
  if (!(amount > 0)) { console.error('ERROR 需要 --amount（真实到账金额），赞助位只在收到钱之后才上'); process.exit(2) }
  const days = Math.max(1, Number(opt('days', '7')) || 7)
  const from = opt('from', BJT())
  const until = new Date(new Date(from + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10)
  store.sponsors = store.sponsors.filter((s) => s.repo !== repo)
  store.sponsors.push({
    repo, name, cn, tier: opt('tier', '单期推荐'), amount, from, until,
    note: opt('note', ''), addedAt: new Date().toISOString(), addedBy: opt('by', 'manual'),
  })
  save()
  console.log(`✓ 已登记赞助位：${name}（${repo}）¥${amount}　${from} → ${until}（到期自动下架）`)
  console.log('  下一期周报会在「本期推荐（赞助）」栏出现，并标注「赞助」字样。')
} else if (cmd === 'remove') {
  const repo = opt('repo')
  const before = store.sponsors.length
  store.sponsors = store.sponsors.filter((s) => s.repo !== repo)
  save()
  console.log(before === store.sponsors.length ? '（没有这个赞助位）' : `✓ 已下架 ${repo}`)
} else if (cmd === 'list') {
  if (!store.sponsors.length) {
    console.log('当前没有赞助位。（收到钱之后用 add 登记；没收到钱不要登记）')
  } else {
    for (const s of store.sponsors) {
      console.log(`${active(s) ? '● 生效中' : '○ 已过期'}  ${s.name}（${s.repo}）¥${s.amount}  ${s.from} → ${s.until}  [${s.note || '无凭证备注'}]`)
    }
  }
} else {
  console.error('未知命令：' + cmd + '（可用：add / remove / list）')
  process.exit(2)
}
