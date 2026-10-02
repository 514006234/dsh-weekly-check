/**
 * 检查宿主（DSH Web 前端）的样式表有没有「全局 box-sizing:border-box」。
 *
 * 为什么重要：面板根元素（.dwp-main / .dwk-page）自己带
 * `width:100%` + 左右各 28px 内边距。如果宿主没有全局 border-box，
 * 那么面板的外框宽度 = 父容器宽度 + 56px，右侧会被框架
 * `.pI_x6G_centerCol{overflow:hidden}` 直接裁掉——这正是用户看到的「右侧被切」。
 *
 * 用法：node tools/css-reset-check.mjs [CSS 文件或目录 ...]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULTS = [
  join('D:', 'npm-global', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai',
    'dsh-web-frontend', 'dist', 'assets'),
];

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULTS;

function collectCss(p) {
  const abs = resolve(p);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return /\.css$/i.test(abs) ? [abs] : [];
  return readdirSync(abs).filter((f) => /\.css$/i.test(f)).map((f) => join(abs, f));
}

function blocks(css) {
  // 极简切分：minified CSS 没有嵌套，按 } 切开足够定位选择器
  const out = [];
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === '}') {
      const chunk = css.slice(start, i);
      start = i + 1;
      const brace = chunk.indexOf('{');
      if (brace === -1) continue;
      out.push({ selector: chunk.slice(0, brace).trim(), decl: chunk.slice(brace + 1) });
    }
  }
  return out;
}

const GLOBAL_SEL = /(^|[\s,])\*|html|body|::?before|::?after|:where|:is/;
let globalReset = null;
const lines = [];

for (const file of targets.flatMap(collectCss)) {
  const css = readFileSync(file, 'utf8');
  lines.push('# ' + file + ' (' + css.length + ' 字符)');
  let hits = 0;
  for (const b of blocks(css)) {
    if (!/box-sizing/i.test(b.decl)) continue;
    hits += 1;
    const decl = (b.decl.match(/box-sizing\s*:\s*[a-z-]+/i) || ['?'])[0];
    const isGlobal = GLOBAL_SEL.test(b.selector) && b.selector.length < 120;
    if (isGlobal && /border-box/i.test(b.decl)) globalReset = b.selector;
    if (hits <= 12 || isGlobal) {
      lines.push('  ' + (isGlobal ? '[全局?]' : '        ') + ' ' + b.selector.slice(0, 130) + '  =>  ' + decl);
    }
  }
  lines.push('  含 box-sizing 的规则共 ' + hits + ' 条');
}

lines.push('');
lines.push('=== 结论 ===');
lines.push('宿主全局 border-box reset：' + (globalReset ? '【有】 → 选择器 ' + globalReset : '【没有】'));
lines.push(
  globalReset
    ? '面板根元素自带内边距不会撑宽；右侧被裁若仍然发生，原因在别处。'
    : '面板根元素带 padding，必须自己写 box-sizing:border-box，否则会比父容器宽 56px 并被裁掉。',
);

const report = lines.join('\n');
process.stdout.write(report + '\n');
