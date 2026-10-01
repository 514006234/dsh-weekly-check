# dsh-weekly-panel

把《DSH 插件周榜》搬进 DSH 侧边栏的**真实可安装 DSH 插件**（本仓库 `packages/` 下的子包）。

在线周报：https://514006234.github.io/dsh-weekly-check/

## 它长什么样

侧边栏**底部**多一个入口按钮 `📊 周榜`，角标就是当期插件数。点开是一个**内联抽屉**（把上方的工作区列表往上挤，不遮挡对话区）：

- 摘要：插件总数 + 更新时间
- **插件 TOP 10**：中文名、`owner/repo`、星数（≥1000 显示 `1.2k`）、较上期涨星（正数绿色 `+2`，下跌橙色 `-1`，没数据就不显示而不是显示 0）
- **免费模型**：可用 `x/y`、已下线数、地区墙数（有限流/上游波动时一并列出）
- **本期推荐（赞助）**：仅当 `latest.json` 里有非空 `sponsors` 数组时显示，每张卡都带「赞助」徽标（这是收入位，必须在插件里也显示，且绝不含糊）
- 两个按钮：**打开完整榜单**、**商务合作**

拿不到数据时显示中文失败提示（含具体原因）+「重试」按钮，外链按钮仍然保留——**不白屏**。

## 组成

```
package.json          dsh.bundle.patch + dsh.client（可安装的关键）
cordis.patch.yml      bundle 形态：把自身 insert 成一行
lib/index.js          宿主半：唯一路由 GET /weekly-panel/data（只读、30 分钟内存缓存）
lib/client.js         客户端半：手写 bundle，挂 sidebar.footer.action（order 20）
tools/gate.mjs        静态门禁 + 宿主半运行时契约（零网络）
tools/render-test.mjs 客户端 UI 自检（假 react + 假 ctx，模拟点击）
README.md             本文件
```

## 数据链路

```
插件抽屉  ──fetch /weekly-panel/data──▶  宿主半  ──GET──▶  https://514006234.github.io/dsh-weekly-check/latest.json
（前端内存缓存 5 分钟）                    （内存缓存 30 分钟）
```

宿主半的边界（`tools/gate.mjs` 会逐条核对）：

- 只允许 **loopback + 同源**，只允许 **GET**；非 loopback / 跨站 / 错 Host / 错 Origin → 403，非 GET → 405，且这些被拦掉的请求**不会触达上游**
- **唯一出站地址**就是 `UPSTREAM_URL` 这一个 https 常量（门禁会把文件里所有 URL 字面量列出来比对），不转发任何请求参数或请求头
- 不写任何文件、不读任何本地文件、不读环境变量、不接触任何凭据
- 上游失败时：有旧缓存就继续返回旧数据并标 `stale:true`；连旧缓存都没有才返回 `{ok:false, reason}`
- `handleData` 吞掉所有异常：任何情况下都以 JSON 答复，**绝不把异常抛进 HTTP 栈**

## 装法与限制（重要，如实说明）

**本包没有被安装到任何 profile**，也没有改仓库根目录的任何文件。要真正在 GUI 里看到它，需要你自己做两步：

1. 把 `packages/dsh-weekly-panel/` 以真实目录（不是软链）拷进该 profile 的 `node_modules/`，并把 `dsh-weekly-panel` 追加到该 profile `package.json` 的 `dsh.profile.bundles` 末尾；
2. **完全重启 DSH**。

> 客户端 bundle 是在启动时快照的，所以**不重启就一定看不到**。作者本人只在静态与模拟层面验证过本包（见下），**没有**也不会声称"已在 GUI 里验证"。

已知限制：

- 抽屉里的外链用 `<a target="_blank">`，能否新开标签取决于宿主 webview 的弹窗策略；被挡住时链接地址也写在 `title` 里可复制。
- 数据是 30 分钟粒度的（上游周报每周一更新），面板不做实时刷新；点「重试」可强制重取。
- 侧边栏收起（`wide=false`）时抽屉退化为临时浮层（唯一一处 `position:fixed`，`z-index:90`）；宽屏下始终在文档流内，不覆盖对话。

## 测试

```bash
node tools/gate.mjs          # 静态门禁 + 宿主半运行时契约（零网络，假 fetch/假 req/res）
node tools/render-test.mjs   # 客户端 UI 自检（假 react + 假 ctx，模拟点击）
npm test                     # 两个都跑
npm run check                # 语法检查
```

两个脚本**全绿退出 0，有失败退出非 0**。

`gate.mjs` 覆盖：manifest（`dsh.bundle.patch` / `dsh.client` / exports）、`cordis.patch.yml` 的 insert id/name、宿主半只读边界与唯一出站地址、客户端经典脚本形态（无 import/export、只 require `react`）、`__ModuleLoader__.load` 的 id、`sidebar.footer.action` 注册与 `order 20`、抽屉"不遮挡对话"的 CSS 不变量（在流内 + 仅 rail 浮层 + `z-index ≤ 90`）、以及宿主半运行时：**30 分钟缓存命中/过期重取、上游失败退回旧缓存并标 stale、无缓存失败返回 `ok:false`+reason、同步异常不外抛、防护矩阵 403/405 且不触达上游**。

`render-test.mjs` 用假 React（含依赖比较的 `useEffect`）与假 `ctx` 真实跑组件，覆盖：收起态与角标、展开后的摘要与 TOP10（含截断、星数格式化、涨星着色）、免费模型计数、赞助位有/无两种情形、`ok:false` 失败态与「重试」成功、网络异常、请求挂起时的加载态、字段缺失的畸形数据不崩、TTL 内反复开合不重复请求、展开态持久化、两个外链的地址与 `noopener`、`wide=false` 时的浮层。

## 复用来源

宿主半的 loopback + 同源防护、`ctx.effect` 注册与客户端半的 `__ModuleLoader__.load` 形态、槽位注册写法、CSS 不变量（角标/面板子项 `flex:0 0 auto`）都来自本机**已装并验证可用**的 `dsh-workbench-lite`；在其基础上新增的是：只有唯一出站地址的数据代理路由、30 分钟内存缓存与 stale 降级、`ctx.inject(['webServer'])` 兜底注册、TOP10/免费模型/赞助位三类内容与外链。

## 许可

MIT。
