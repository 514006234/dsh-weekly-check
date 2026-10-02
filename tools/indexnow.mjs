// tools/indexnow.mjs — 把站点 URL 提交给 IndexNow（Bing / Yandex 等参与引擎）。
//
// 为什么做这个：这是唯一一条**不需要任何人配合、也不需要账号**的分发动作。
// 周报每周一期、每期一个新页面（/archive/<日期>.html），每期都该有机会被搜索引擎收录——
// 对我们这种 0 星、0 外链的新站，「被搜到」是少数还能自己推动的入口。
//
// 协议要求：keyLocation 指向一个能返回 key 本身的文本文件。我们把它放在站点根
// （site/<key>.txt，构建时按 *.txt 原样搬到站点根），所以**必须先发布 key 文件再提交**，
// 否则引擎校验失败。本脚本会先探活 key 文件，探不到就明确报错而不是假装提交成功。
//
// 用法：
//   node tools/indexnow.mjs            # 探活 key 文件 → 提交 sitemap 里的全部 URL
//   node tools/indexnow.mjs --dry-run  # 只打印将要提交的 URL
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SITE_DIR = resolve(ROOT, 'site');
const REPORT_DIR = resolve(ROOT, 'report');
const SITE_URL = 'https://514006234.github.io/dsh-weekly-check/';
const HOST = '514006234.github.io';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/* 1) 找 key：site/<32 位十六进制>.txt */
const keyFile = readdirSync(SITE_DIR).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) { console.error('✗ site/ 下没有 <32位十六进制>.txt 的 IndexNow key 文件'); process.exit(2); }
const key = keyFile.replace(/\.txt$/, '');
const keyLocation = SITE_URL + keyFile;

/* 2) 收集要提交的 URL：优先用构建出来的 sitemap */
const sitemap = resolve(REPORT_DIR, 'sitemap.xml');
let urls = [];
if (existsSync(sitemap)) {
  urls = [...readFileSync(sitemap, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
} else {
  urls = [SITE_URL, SITE_URL + 'sponsor/', SITE_URL + 'report-preview/'];
}
urls = [...new Set(urls)];
console.log('IndexNow key: ' + key);
console.log('keyLocation : ' + keyLocation);
console.log('待提交 URL  : ' + urls.length + ' 条');
for (const u of urls.slice(0, 8)) console.log('  ' + u);

if (process.argv.includes('--dry-run')) { console.log('（--dry-run，未提交）'); process.exit(0); }

/* 3) 先探活 key 文件——协议要求它可公开访问，取不到就提交必然失败 */
const probe = await fetch(keyLocation, { headers: { 'user-agent': 'dsh-weekly-check-indexnow' } });
const probeText = probe.ok ? (await probe.text()).trim() : '';
console.log('\n探活 keyLocation → HTTP ' + probe.status + '，内容匹配: ' + (probeText === key));
if (probe.status !== 200 || probeText !== key) {
  console.error('✗ key 文件还没上线（或内容不一致），本次不提交。');
  console.error('  这是正确行为：没上线就提交，引擎会校验失败并可能降低信任。');
  process.exit(3);
}

/* 4) 提交 */
const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8', 'user-agent': 'dsh-weekly-check-indexnow' },
  body: JSON.stringify({ host: HOST, key, keyLocation, urlList: urls }),
});
const body = await res.text();
console.log('提交 → HTTP ' + res.status + (body ? '  ' + body.slice(0, 200) : ''));
// 200/202 都是成功（202 = 已接受待处理）
if (res.status === 200 || res.status === 202) {
  console.log('✓ 已提交（200/202 均为成功）');
} else if (res.status === 403) {
  console.error('✗ 403：key 校验没通过（检查 keyLocation 内容与 host）');
  process.exitCode = 2;
} else if (res.status === 422) {
  console.error('✗ 422：URL 不属于该 host，或 key 格式不对');
  process.exitCode = 2;
} else {
  console.error('✗ 意外状态码 ' + res.status);
  process.exitCode = 2;
}
