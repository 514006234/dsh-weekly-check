// tools/deploy-panel.mjs — 把 packages/dsh-weekly-panel 装进本机 DSH 的 desktop profile
//
//   node tools/deploy-panel.mjs              # 安装（拷贝目录 + 把包名追加进 dsh.profile.bundles）
//   node tools/deploy-panel.mjs --uninstall  # 卸载（移除条目 + 删目录）
//   node tools/deploy-panel.mjs --check      # 只检查当前状态
//
// 为什么是"拷贝目录"而不是 dsh plugin add：
//   桌面端的 desktop profile 由 Electron 应用独占管理，`dsh plugin add` 会直接拒绝；
//   本机此前装 workbench 插件用的就是同一条路（真目录拷贝 + bundles 追加）。
//
// 安全措施（都来自本机踩过的坑）：
//   · package.json 一律用 Node 写 UTF-8 **无 BOM**（带 BOM 会让 DSH 启动时 JSON.parse 失败，本机真出过）
//   · 写盘前先备份 .bak；写盘后重新 JSON.parse 校验，校验不过就自动回滚
//   · 只增删自己这一个包名，绝不动别人已装的 9 个 bundle
//   · 拷贝用逐文件递归（Node 25 的 cpSync 对目录会崩）

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SRC = resolve(ROOT, 'packages', 'dsh-weekly-panel')

const PKG_NAME = 'dsh-weekly-panel'
const DSH_HOME = join(homedir(), '.dsh')
const PROFILES = join(DSH_HOME, 'profiles')
const PROFILE = process.env.DSH_PROFILE || 'desktop'
const PROFILE_JSON = join(PROFILES, PROFILE, 'package.json')
const MODULES = join(PROFILES, 'node_modules')
const DEST = join(MODULES, PKG_NAME)

const argv = process.argv.slice(2)
const uninstall = argv.includes('--uninstall')
const checkOnly = argv.includes('--check')

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'))
function writeJsonNoBom(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
  const bytes = readFileSync(file)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error('写出来的文件带 BOM，已中止')
  readJson(file)   // 校验能被解析
}

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    const s = join(src, name)
    const d = join(dest, name)
    if (statSync(s).isDirectory()) copyTree(s, d)
    else copyFileSync(s, d)
  }
}

function report(profile) {
  const bundles = (profile.dsh && profile.dsh.profile && profile.dsh.profile.bundles) || []
  console.log('profile: ' + PROFILE + '  (' + PROFILE_JSON + ')')
  console.log('bundles(' + bundles.length + '): ' + bundles.join(', '))
  console.log('已注册: ' + bundles.includes(PKG_NAME))
  console.log('目录存在: ' + existsSync(DEST) + '  (' + DEST + ')')
  const bytes = readFileSync(PROFILE_JSON)
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  console.log('package.json 带 BOM: ' + bom + (bom ? '  ← 危险，DSH 会启动失败！' : ''))
}

if (!existsSync(PROFILE_JSON)) { console.error('ERROR 找不到 profile：' + PROFILE_JSON); process.exit(2) }
const profile = readJson(PROFILE_JSON)
if (!profile.dsh || !profile.dsh.profile || !Array.isArray(profile.dsh.profile.bundles)) {
  console.error('ERROR profile 结构不符（没有 dsh.profile.bundles）'); process.exit(2)
}

if (checkOnly) { report(profile); process.exit(0) }

if (uninstall) {
  profile.dsh.profile.bundles = profile.dsh.profile.bundles.filter((b) => b !== PKG_NAME)
  copyFileSync(PROFILE_JSON, PROFILE_JSON + '.bak')
  writeJsonNoBom(PROFILE_JSON, profile)
  if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true })
  console.log('✓ 已从 bundles 移除并删除目录')
  report(readJson(PROFILE_JSON))
  console.log('\n完全重启 DSH 后生效（客户端 bundle 在启动时快照）。')
  process.exit(0)
}

// ── 安装 ───────────────────────────────────────────────────────────────
for (const f of ['package.json', 'cordis.patch.yml', join('lib', 'index.js'), join('lib', 'client.js')]) {
  if (!existsSync(resolve(SRC, f))) { console.error('ERROR 源文件缺失：' + f); process.exit(2) }
}

const backup = PROFILE_JSON + '.bak'
copyFileSync(PROFILE_JSON, backup)
console.log('已备份 → ' + backup)

copyTree(SRC, DEST)
console.log('已拷贝插件目录 → ' + DEST)

const before = profile.dsh.profile.bundles.slice()
if (!profile.dsh.profile.bundles.includes(PKG_NAME)) profile.dsh.profile.bundles.push(PKG_NAME)   // 追加到末尾，不动别人
try {
  writeJsonNoBom(PROFILE_JSON, profile)
} catch (e) {
  console.error('✗ 写 profile 失败：' + e.message + ' → 正在回滚')
  copyFileSync(backup, PROFILE_JSON)
  rmSync(DEST, { recursive: true, force: true })
  process.exit(3)
}

const after = readJson(PROFILE_JSON)
console.log('bundles: ' + before.length + ' → ' + after.dsh.profile.bundles.length)
console.log('新增条目: ' + after.dsh.profile.bundles.filter((b) => !before.includes(b)).join(', '))
console.log('其他条目未被改动: ' + before.every((b) => after.dsh.profile.bundles.includes(b)))
report(after)
console.log('\n⚠ 现在请**完全重启 DSH**（关闭再打开）——桌面端插件的界面改动只有在重启后才会出现。')
console.log('   重启后：侧边栏底部应出现「📊 周榜」按钮；点开是不遮挡对话的抽屉面板。')
console.log('   若启动异常：node tools/deploy-panel.mjs --uninstall 即可撤销（或把 profile 的 package.json.bak 拷回去）。')
