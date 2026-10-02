# dsh-weekly-panel

把《DSH 插件周榜》搬进 DSH 侧边栏的**真实可安装 DSH 插件**（本仓库 `packages/` 下的子包）。

在线周报：https://514006234.github.io/dsh-weekly-check/

## 它长什么样

两扇门，都是框架里的**流内布局**——整份 CSS **零处 `position:fixed`**（`tools/gate.mjs` 会逐字核对），所以它不会遮挡对话区：

- **侧边栏图标行**里的 `📊 周榜`（`sidebar.panellist`，`order 15`）——点一下把中间整列切成本面板；图标自带 `active` 高亮
- **中间整列面板**（`main` 槽，`key = dsh-weekly`）

面板内容：

- 摘要：收录项目数 + 更新时间
- **TOP 10**：中文名、`owner/repo`、实时星数（≥1000 显示 `1.2k`）、较上期涨星（涨绿跌橙；**没数据就不显示，而不是显示 0**）
- **一键安装**：形态为 `原生bundle` 的条目带一个「装」按钮，点击把 `dsh plugin add <repo>` 复制进剪贴板；剪贴板不可用时降级为弹窗让你手动复制（不抛异常、不白屏）
- **免费模型**：可用 `x/y`、已下线数、地区墙数（有限流 / 上游波动时一并列出）
- **本期推荐**：仅当 `latest.json` 里有非空 `sponsors` 数组时显示。**付了钱的标「赞助」，免费互推的标「互推」**——没付钱的不写成赞助
- 两个外链：**打开完整榜单**、**商务合作**

拿不到数据时显示中文失败提示（含具体原因）+「重试」按钮，外链按钮仍然保留——**不白屏**。

## 组成

```
package.json          dsh.bundle.patch + dsh.client（可安装的关键）
cordis.patch.yml      bundle 形态：把自身 insert 成一行
lib/index.js          宿主半：唯一路由 GET /weekly-panel/data（只读、30 分钟内存缓存）
lib/client.js         客户端半：手写 bundle，注册 main（中间整列面板）+ sidebar.panellist（图标行）
tools/gate.mjs        静态门禁 + 宿主半运行时契约（零网络）
tools/render-test.mjs 客户端 UI 自检（假 react + 假 ctx，模拟点击与剪贴板）
README.md             本文件
```

> 历史说明：早期版本曾注册 `sidebar.footer.action`（侧边栏底部按钮 + 内联抽屉），
> **v0.3.0 起已按用户反馈彻底移除**——现在不再注册该槽，也不再有任何浮层或 `z-index`。
> 若你在别处看到「底部按钮 / 抽屉 / rail 浮层」的描述，那是过时信息。

## 数据链路

```
插件面板  ──fetch /weekly-panel/data──▶  宿主半  ──GET──▶  https://514006234.github.io/dsh-weekly-check/latest.json
（前端内存缓存 5 分钟）                    （内存缓存 30 分钟）
```

宿主半的边界（`tools/gate.mjs` 会逐条核对）：

- 只允许 **loopback + 同源**，只允许 **GET**；非 loopback / 跨站 / 错 Host / 错 Origin → 403，非 GET → 405，且这些被拦掉的请求**不会触达上游**
- **唯一出站地址**就是 `UPSTREAM_URL` 这一个 https 常量（门禁会把文件里所有 URL 字面量列出来比对），不转发任何请求参数或请求头
- 不写任何文件、不读任何本地文件、不读环境变量、不接触任何凭据
- 上游失败时：有旧缓存就继续返回旧数据并标 `stale:true`；连旧缓存都没有才返回 `{ok:false, reason}`
- `handleData` 吞掉所有异常：任何情况下都以 JSON 答复，**绝不把异常抛进 HTTP 栈**

## 装法（两种，如实说明）

1. **从插件注册表装**（推荐）：本项目已向上游 `awesome-dsh-plugin` 提交收录申请，
   收录后可以在 DSH 界面内的插件市场里搜索安装。
2. **手动部署本机 profile**：`node tools/deploy-panel.mjs --pkg dsh-weekly-panel`
   （备份 → 拷贝真实目录 → 追加 `dsh.profile.bundles` → 校验 JSON 无 BOM → 出错自动回滚；
   撤销用 `--uninstall`）。

   > 桌面端 profile 由 Electron 应用独占管理，`dsh plugin add` 会直接拒绝，所以这里走拷贝部署。

**任何界面改动都必须完全重启 DSH**——客户端 bundle 是在启动时快照的，不重启就一定看不到。

已知限制：

- 面板只读：不写文件、不读本地文件；数据是 30 分钟粒度的（上游周报每周一更新），面板不做实时刷新，点「重试」可强制重取
- 外链用 `<a target="_blank">`，能否新开标签取决于宿主 webview 的弹窗策略；被挡住时链接地址也写在 `title` 里可复制
- 一键安装只对 `原生bundle` 形态显示——外部应用 / Skill 给了命令也跑不通，所以不给

## 测试

```bash
node tools/gate.mjs          # 静态门禁 28 项 + 宿主半运行时契约（零网络，假 fetch/假 req/res）
node tools/render-test.mjs   # 客户端 UI 自检 78 项（假 react + 假 ctx，模拟点击/剪贴板/降级）
npm test                     # 两个都跑
npm run check                # 语法检查
```

两个脚本**全绿退出 0，有失败退出非 0**。

`gate.mjs` 覆盖：manifest（`dsh.bundle.patch` / `dsh.client` / exports）、`cordis.patch.yml` 的 insert id/name、宿主半只读边界与唯一出站地址、客户端经典脚本形态（无 import/export、只 require `react`）、`__ModuleLoader__.load` 的 id、**双槽注册（`main` key + `sidebar.panellist` id 同值、order 15、label 含「周榜」）与「不再注册 `sidebar.footer.action`」**、**整份 CSS 零 `position:fixed` / 零 `z-index`**、窄窗 `min()` 约束、`box-sizing:border-box`（宿主没有全局 border-box reset，漏了会被框架中间列裁掉右侧）、一键复制 `dsh plugin add`、推荐位必须区分「赞助 / 互推」、以及宿主半运行时：**30 分钟缓存命中/过期重取、上游失败退回旧缓存并标 stale、无缓存失败返回 `ok:false`+reason、同步异常不外抛、防护矩阵 403/405 且不触达上游**。

`render-test.mjs` 用假 React（含依赖比较的 `useEffect`）与假 `ctx` 真实跑组件，覆盖：图标行 `active` 高亮与点击分岔（有/无 `layout.selectPanel`、`selectPanel` 抛异常也要吞掉）、数据到达后的摘要与 TOP10（含星数格式化、涨星着色、0 与缺失不显示）、**一键安装（只有原生bundle 有按钮、点击复制出正确命令、剪贴板不可用时安静降级）**、免费模型计数、**推荐位有/无两种情形 + 付费标「赞助」、互推标「互推」且互不串味**、`ok:false` 失败态与「重试」成功、网络异常、字段缺失的畸形数据不崩、TTL 内反复挂载不重复请求、两个外链的地址与 `noopener`。

## 复用来源

宿主半的 loopback + 同源防护、`ctx.effect` 注册与客户端半的 `__ModuleLoader__.load` 形态、槽位注册写法、CSS 不变量（面板子项 `flex:0 0 auto`）都来自本机**已装并验证可用**的 `dsh-workbench-lite`；在其基础上新增的是：只有唯一出站地址的数据代理路由、30 分钟内存缓存与 stale 降级、`ctx.inject(['webServer'])` 兜底注册、TOP10 / 免费模型 / 推荐位三类内容、一键复制安装命令、以及窄窗与 box-sizing 的实测修复。

## 许可

MIT。
