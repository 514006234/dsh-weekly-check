# dsh-dashboard — DSH 中央仪表盘

把「塞在侧边栏底部的狭小抽屉」换成 **DSH 界面中间整列的仪表盘面板**：卡片网格聚合信息，点卡片跳转/打开；侧边栏有对应的全局面板图标行。

零 npm 依赖、零构建：宿主半是普通 ESM 插件，客户端半是手写 bundle（经典脚本）。

## 安装（部署由父 agent 执行）

```bash
# 把本包放进 profile 并写入组合层（示意，以父 agent 的部署脚本为准）
pnpm add -C ~/.dsh/profiles ./packages/dsh-dashboard
```

> **装完必须重启 DSH 才生效。** 客户端 bundle（`lib/client.js`）是**启动快照**：框架在启动时把注册进 `window.__ModuleLoader__` 的脚本执行一遍，
> 运行中的界面不会因为热更新而重新执行它。改完不重启 = 旧代码继续跑。

宿主半的只读路由 `GET /dashboard/data` 会随插件加载自动注册（服务不在位时用 `ctx.inject(['webServer'])` 兜底），不需要额外配置。

## 形态：两个槽位（框架自描述注册表核实，未自行发明）

| 槽位 | kind / scope | 注册参数 | 作用 |
| --- | --- | --- | --- |
| `main` | keyed / root | `{ name:'main', key:'dsh-dashboard' }` | **中间主列**：仪表盘面板本体。keyDomain 已占用的只有 `conversation` |
| `sidebar.panellist` | list / root | `{ name:'sidebar.panellist', id:'dsh-dashboard', order:100, label:'仪表盘' }` | **侧边栏全局面板图标行**；`id` 必须与 `main` 的 `key` 同值（Each list id addresses the matching main panel） |

- 图标行组件收到 ownerProps `{ size, active }`：按 `size` 画等尺寸的自绘内联 SVG 图标，用 `active` 高亮当前选中态。
- 图标行的**点击由侧边栏自己负责**（它做 `selectPanel`），本插件不给图标行接点击。
- 面板本体通过 `register` 选项里的 `inject` 注入三个带 `ctx` 的降级服务面：`dashJump` / `dashOpenSession` / `dashCreateSession`（与 `dsh-workbench-lite` 同一机制）。

## 卡片（数据全部来自真实数据源）

1. **周榜 TOP 6**：`latest.json` 的 `plugins` 按星数取前 6。每行 = 中文名 + `owner/repo` + 星数（99046 → 99.0k）+ 较上期涨星（正数绿色；无 delta 或 0 不显示）。点行 → 切到周榜面板（key `dsh-weekly`），切不动则打开榜单网页。
2. **免费模型状态卡**：`stat.ok/stat.total` 大数字 + 已下线/地区墙/上游波动小字。点击 → 打开周榜面板或榜单网页。
3. **最近会话卡**：`useSessions` 标准 hook 列最近 3 条（标题 + 工作区名，过滤子 agent/草稿）。点击按 `dsh-workbench-lite` 的优先级打开：`uiWorkspace.openSession` → `sessions.open`。
4. **快捷动作卡**：「＋ 新会话」（`createSession(cwd, done)` 面；cwd 默认沿用最近会话的工作目录，拿不到就传空按 `sessions.create` 语义降级）、「打开工作台」（key `dsh-workbench`）、「打开周榜」（key `dsh-weekly`）。
5. **支持本项目卡**：一句话 + 点击打开赞助页。

数据链路：客户端只 fetch 同源只读路由 `GET /dashboard/data`（客户端 5 分钟内存缓存）→ 宿主半以 30 分钟缓存去打**唯一出站地址** `https://514006234.github.io/dsh-weekly-check/latest.json`。宿主半只读（GET only + loopback/同源护栏），不写任何文件。

## 跨面板跳转与降级（任何路径不许抛异常）

```js
function selectPanel(ctx, key) {
  try {
    if (typeof ctx?.layout?.selectPanel === 'function') { ctx.layout.selectPanel(key); return true }
  } catch {}
  return false
}
```

- `ctx.layout` 面缺失（老版本 / 面没接上）→ 返回 false → 回落 `window.open`。
- 官方 `ILayout.selectPanel` 对**未注册的 key 会抛异常**（d.ts 明写 `@throws`）→ try/catch 吞掉 → 回落 `window.open`。
- `window.open` 本身也有 typeof 检查 + try/catch（弹窗拦截也不抛）。
- 打开会话：`uiWorkspace.openSession` → `sessions.open` → 都没有返回 `{ok:false, reason}`，note 里中文提示，不崩。
- 新会话：没有 `sessions.create` / 同步抛错 / Promise 拒绝 → 全部转成 `done(err)`。
- 数据降级：`latest.json` 拉不到 → 卡片区中文失败提示 + 重试按钮；会话面拿不到 → 会话卡「不可用」占位，**其它卡不受影响**。

## 测试

```bash
npm test        # = node tools/gate.mjs && node tools/render-test.mjs，两个都 exit 0 才算过
```

- `tools/gate.mjs`：契约门禁（manifest / patch 一致 / 宿主半只读+唯一出站+loopback 护栏 / 双槽注册 / selectPanel 降级 / 无外链资源 / 抽屉遗留清除 / 宿主半运行时零网络）。
- `tools/render-test.mjs`：假 React + `node:vm` 的 UI 自检（注册参数、TOP6、涨星、免费模型、会话、失败态+重试、快捷动作三条降级路径、支持卡、active 高亮）。

## 已知限制

1. **`sidebar.panellist` 图标行是否真的出现在侧边栏，需要 GUI 实测。** 框架自描述注册表明确承诺了这个槽（kind: list、id 寻址 main 面板、ownerProps `{size, active}`、官方 example 齐全），但**没有第三方插件先例**可参照；本插件是首个按该契约注册的包。若重启后图标行不出现：
   - 先确认是「槽位没被渲染」还是「面板没被选中」（`main` 面板可直接通过其它入口打开验证）；
   - 保留的 `sidebar.footer.action` 入口（旧抽屉形态）**不在本包内**，其去留与改造见父 agent 的方案。
2. **跨面板跳转依赖对方面板以 `main` 槽的 key 注册**：`dsh-weekly` / `dsh-workbench` 这两个 key 若没有对应面板注册，`selectPanel` 会抛（已被吞）并回落打开网页——「打开工作台」按钮的回落目标同样是榜单网页（工作台没有专属网页）。
3. 客户端 bundle 是启动快照：**改完必须重启 DSH**（见上）。
4. 会话卡的「工作区名」按 `cwd` 与工作区路径**精确匹配**（大小写不敏感）；`cwd` 不在任何已登记工作区时显示「工作区外」。
