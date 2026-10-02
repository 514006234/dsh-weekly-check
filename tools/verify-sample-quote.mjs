// 证明「样张」是原文照录：把预览页里那段引文抽出来，去标签后逐句到付费报告里查。
// 为什么要较这个真：样张上写着「原文照录，一字未改」，那就必须真的是原文；
// 一旦是手打的近似句，就是在用不实陈述卖东西。
import { readFileSync } from 'node:fs';

const page = readFileSync('D:/ds工作区/dsh-weekly-check/site/report-preview.html', 'utf8');
const report = readFileSync('D:/ds工作区/dsh-money/product/DSH插件选型与风险报告-2026-10.md', 'utf8');

// 取出 <blockquote class="sample"> ... </blockquote>
const m = page.match(/<blockquote class="sample">([\s\S]*?)<\/blockquote>/);
if (!m) { console.log('✗ 预览页里找不到样张区块'); process.exit(1); }

const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const norm = (s) => s.replace(/[`*]/g, '').replace(/\s+/g, '');

const sampleText = stripTags(m[1]);
const reportNorm = norm(report);

// 逐句（按 · 与换行切）取长度足够的句子来核对
const sentences = sampleText
  .split(/[\n·]/)
  .map((s) => s.trim())
  .filter((s) => s.length >= 12 && !/^注意这两条的形状/.test(s) && !/^R\d/.test(s) && !/^下面两条/.test(s));

let bad = 0;
console.log('待核对句子 ' + sentences.length + ' 条：');
for (const s of sentences) {
  const hit = reportNorm.includes(norm(s));
  if (!hit) bad += 1;
  console.log('  ' + (hit ? '✓' : '✗') + ' ' + s.slice(0, 62));
}

console.log('\n结论：' + (bad === 0 ? '全部为原文照录' : bad + ' 条不是原文（必须改）'));
process.exit(bad === 0 ? 0 : 2);
