// tools/sponsor.mjs — 管理周报的「推荐位」（卖出去的东西必须真能兑现）
//
//   node tools/sponsor.mjs list
//   node tools/sponsor.mjs add --repo owner/name --name "中文名" --cn "推荐语" \
//        --tier "单期推荐" --days 7 --amount 299 --note "微信收款 2026-10-05"
//   node tools/sponsor.mjs add --kind reciprocal --repo owner/name --name "中文名" --cn "推荐语" --note "互推：对方 README 已加我们的链接"
//   node tools/sponsor.mjs remove --repo owner/name
//
// 规则（对外承诺，代码里也照着做）：
//   · **付费**赞助位在周报里独立成栏并标注「赞助」，绝不混进正常榜单，绝不改榜单排序
//   · **免费互推**标注「互推」——没付钱就不能写成赞助（商务页上公开承诺过），
//     所以 reciprocal 这一档不要求 --amount，走 --kind reciprocal
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
  const kind = opt('kind', 'paid') === 'reciprocal' ? 'reciprocal' : 'paid'
  const amount = Number(opt('amount', '0'))
  if (!repo || !name || !cn) { console.error('ERROR 需要 --repo --name --cn'); process.exit(2) }
  // 付费档：只在真收到钱之后才登记。互推档不涉及钱，所以不校验金额。
  if (kind === 'paid' && !(amount > 0)) {
    console.error('ERROR 付费赞助位需要 --amount（真实到账金额），只在收到钱之后才上；')
    console.error('      如果是免费互推，加 --kind reciprocal（不会标注成「赞助」）。')
    process.exit(2)
  }
  const days = Math.max(1, Number(opt('days', '7')) || 7)
  const from = opt('from', BJT())
  const until = new Date(new Date(from + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10)
  store.sponsors = store.sponsors.filter((s) => s.repo !== repo)
  store.sponsors.push({
    repo, name, cn, kind, tier: opt('tier', kind === 'reciprocal' ? '免费互推' : '单期推荐'),
    amount, from, until,
    note: opt('note', ''), addedAt: new Date().toISOString(), addedBy: opt('by', 'manual'),
  })
  save()
  if (kind === 'reciprocal') {
    console.log(`✓ 已登记互推位：${name}（${repo}）${from} → ${until}`)
    console.log('  周报里会标注「互推」而**不是**「赞助」（没付钱就不能写成赞助）；到期自动下架。')
  } else {
    console.log(`✓ 已登记赞助位：${name}（${repo}）¥${amount}　${from} → ${until}（到期自动下架）`)
    console.log('  下一期周报会在「本期推荐」栏出现，并标注「赞助」字样。')
  }
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
      const isRecip = s.kind === 'reciprocal'
      console.log(`${active(s) ? '● 生效中' : '○ 已过期'}  [${isRecip ? '互推' : '赞助'}]  ${s.name}（${s.repo}）${isRecip ? '（不涉及付款）' : '¥' + s.amount}  ${s.from} → ${s.until}  [${s.note || '无凭证备注'}]`)
    }
  }
} else {
  console.error('未知命令：' + cmd + '（可用：add / remove / list）')
  process.exit(2)
}
