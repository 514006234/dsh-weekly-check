// tools/readme-check.mjs — 防止 README 与代码漂移。
//
// 为什么需要：这个包的 README 曾经整段描述一个**已经不存在的架构**
// （注册 sidebar.footer.action 做底部抽屉、只有一处 position:fixed、z-index 90、order 20），
// 而收录投稿的维护者**正是打开这个文件读**。文档说一套、代码做一套，是最容易被扣分的。
//
// 做法：真跑两个测试脚本，把打印出来的项数与 README 里的数字对上；
// 再对几条「架构事实」做正反断言（必须出现的、必须不出现的）。
//
// 用法：node tools/readme-check.mjs
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const readme = readFileSync(resolve(PKG, 'README.md'), 'utf8');
const client = readFileSync(resolve(PKG, 'lib', 'client.js'), 'utf8');

function runCount(file, re) {
  const r = spawnSync(process.execPath, [resolve(HERE, file)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(re);
  return { status: r.status, count: m ? Number(m[1]) : null };
}

let bad = 0;
const check = (ok, label) => { if (!ok) bad += 1; console.log('  ' + (ok ? '✓' : '✗') + ' ' + label); };

const gate = runCount('gate.mjs', /GATE OK \((\d+) checks\)/);
const render = runCount('render-test.mjs', /RENDER TEST OK（(\d+) assertions）/);
console.log('实测：gate ' + gate.status + '/28项?=' + gate.count + '，render ' + render.status + '/78项?=' + render.count);

console.log('\n[1] README 里的测试项数必须与实测一致');
check(gate.count !== null && readme.includes('静态门禁 ' + gate.count + ' 项'), 'gate 项数 ' + gate.count + ' 写在 README 里');
check(render.count !== null && readme.includes('客户端 UI 自检 ' + render.count + ' 项'), 'render 项数 ' + render.count + ' 写在 README 里');

console.log('\n[2] 必须描述的当前事实');
check(readme.includes('sidebar.panellist'), '写了当前注册的图标行槽位');
check(/order 15/.test(readme), '写了 panellist 的 order 15');
check(readme.includes('main'), '写了 main 槽（中间整列面板）');
check(/零处 `position:fixed`/.test(readme), '明确写了零固定定位');
check(/一键安装/.test(readme) && readme.includes('dsh plugin add'), '写了一键安装命令');
check(/互推/.test(readme) && /赞助/.test(readme), '写了「赞助 / 互推」必须区分的口径');

console.log('\n[3] 不得残留的过时说法（这些是代码里已经不存在的架构）');
const stale = [
  ['挂 sidebar.footer.action（order 20）', '把 footer 槽当成当前注册方式'],
  ['唯一一处 `position:fixed`', '声称存在固定定位浮层'],
  ['z-index:90', '声称存在 z-index 浮层'],
  ['只有一处', '含糊声称「只有一处」浮层'],
  ['抽屉退化为临时浮层', '声称窄屏退化为浮层'],
];
for (const [needle, why] of stale) check(!readme.includes(needle), '不含过时说法：' + why);

console.log('\n[4] README 的架构描述必须与代码一致');
check(!/sidebar\.footer\.action/.test(client.replace(/^[\s\S]*?\/\* 抽屉时代结束[\s\S]*?\*\//, '')) || !client.includes("'sidebar.footer.action'"), '代码里确实不再注册 footer 槽');
check(!/position:fixed/.test(client), '代码里确实没有 position:fixed');
check(client.includes('sidebar.panellist'), '代码里确实注册了 sidebar.panellist');
check(client.includes('function copyInstall'), '代码里确实有一键安装');

console.log(bad === 0 ? '\n✓ README 与代码一致（' + 15 + ' 项）' : '\n✗ 有 ' + bad + ' 处不一致');
process.exit(bad === 0 ? 0 : 2);
