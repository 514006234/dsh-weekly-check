# DSH 插件周榜 · 2026-10-02

> 只做一件事：把"这周 DSH 生态里什么值得装、免费模型还能不能用"讲成人话。**所有星数来自 GitHub 实时接口**，中文说明为人工核实后的策展，不做机翻。

## 一、本期要点

- 收录插件 31 个，合计 420,508 ★；前三名：OpenDesign 设计工作台（99.1k★）、Archify 架构图（76.1k★）、OpenViking 上下文库（39.1k★）。
- 本期涨星：Archify 架构图 +412★、DSHDesktop +259★、OpenDesign 设计工作台 +95★。
- 免费模型可用性：**7/12 可用**，已下线 2 个，上游波动 3 个；可用模型首字延迟中位 1.45s。
- 待审新面孔：walkinglabs/learn-harness-engineering（18.0k★，2026-10-01）。

## 二、DSH 生态项目榜

共 31 个：其中 **17 个是可直接安装的插件（原生bundle）**，其余 14 个是周边工具 / Skill。排序口径是**真实 star 数**，与形态无关。

分类分布：记忆 5｜工作台 3｜多Agent 3｜桌面端 2｜插件市场 2｜娱乐 2｜设计交付 1｜文档图 1｜技能 1｜提示词 1｜榜单 1｜浏览器 1｜模型路由 1｜视觉识图 1｜终端 1｜预设 1｜免费模型 1｜主题皮肤 1｜维护 1｜用量 1

| ⭐ | 插件 | 中文说明 | 分类 | 形态 | 较上期 | 最近更新 | 许可 |
|---:|---|---|---|---|---:|---|---|
| 99.1k | **OpenDesign 设计工作台**<br>`nexu-io/open-design` | 生成网页/PPT/图片/视频并导出，**不是 DSH 插件**，是它反过来管理 DSH 运行时 | 设计交付 | 外部 | +95 | 2026-10-02 | Apache-2.0 |
| 76.1k | **Archify 架构图**<br>`tt-a1i/archify` | 从代码库生成可验证的架构/流程/时序图，自带 HTML 导出 | 文档图 | Skill | +412 | 2026-09-30 | MIT |
| 39.1k | **OpenViking 上下文库**<br>`volcengine/OpenViking` | 把记忆/知识/RAG/Skill 统一进 `viking://` 虚拟文件系统；**AGPL 且是独立部署**，不适合只想加记忆的人 | 记忆 | 外部 | +42 | 2026-10-02 | AGPL-3.0 |
| 29.8k | **DSH Desktop（社区桌面端）**<br>`anywhere-labs/dsh-desktop` | 把整个 Harness 打进安装包，**无需 Node 环境**；个人项目非官方 | 桌面端 | 外部 | +60 | 2026-10-01 | MIT |
| 25.2k | **Distilly 技能提炼**<br>`titanwings/distilly` | 把「别人怎么想」蒸馏成可复用 Skills（原 colleague-skill） | 技能 | 外部 | +29 | 2026-09-22 | MIT |
| 20.3k | **Voyager 提示词管理**<br>`voyager-crew/voyager` | 浏览器扩展，可在 DSH 网页里复用提示词；**不是 DSH bundle** | 提示词 | 外部 | +6 | 2026-09-29 | GPL-3.0 |
| 17.6k | **DSH 插件精选列表**<br>`awesome-dsh-plugin/awesome-dsh-plugin` | 社区维护的插件清单，找插件的入口 | 榜单 | 外部 | +58 | 2026-10-01 | CC0-1.0 |
| 13.3k | **EverOS 记忆层**<br>`EverMind-AI/EverOS` | 本地优先、Markdown 原生、用户自持的跨 Agent 记忆层 | 记忆 | 外部 | +5 | 2026-10-01 | Apache-2.0 |
| 11.7k | **MemOS 记忆操作系统**<br>`MemTensor/MemOS` | 面向 LLM/Agent 的自进化记忆系统，带混合检索 | 记忆 | 外部 | +3 | 2026-09-29 | Apache-2.0 |
| 11.6k | **DSHDesktop**<br>`dataelement/dsh-desktop` | 又一个社区桌面版 | 桌面端 | 外部 | +259 | 2026-10-02 | MIT |
| 8.3k | **dsh-web 全家桶**<br>`zhu1090093659/dsh-web` | 任务看板/Git图谱/右侧面板/移动端/皮肤等聚合分发 | 工作台 | 原生bundle | +31 | 2026-10-02 | Apache-2.0 |
| 8.0k | **BrowserSkill 浏览器技能**<br>`Tencent/BrowserSkill` | 让 Agent 用你**已登录的真实浏览器**干活，CLI+扩展 | 浏览器 | Skill | +28 | 2026-09-30 | MIT |
| 7.0k | **dsh-routing-suite 智能路由**<br>`yjh051108/dsh-routing-suite` | 按任务把请求路由到不同模型/提供商 | 模型路由 | 原生bundle | 0 | 2026-09-18 | MIT |
| 6.6k | **iPolloWork 企业工作台**<br>`Devin-AXIS/iPolloWork` | 本地优先的多引擎 Agent 工作台 | 工作台 | 外部 | +31 | 2026-10-02 | NOASSERTION |
| 6.2k | **Ouroboros 自进化 Agent OS**<br>`Q00/ouroboros` | 访谈门控 + 分阶段评测 + 预算约束的长任务闭环 | 多Agent | 原生bundle | +4 | 2026-10-02 | MIT |
| 6.1k | **loopx 长任务控制面**<br>`loopx-project/loopx` | 带持久状态内核，维持长任务与团队持续推进 | 多Agent | 外部 | +6 | 2026-10-02 | Apache-2.0 |
| 5.3k | **dsh-market 插件市场**<br>`dsh-market/dsh-market` | DSH 界面内的插件市场：浏览/搜索/一键安装 | 插件市场 | 原生bundle | +76 | 2026-10-01 | MIT |
| 4.2k | **petdex 宠物画廊**<br>`crafter-station/petdex` | 界面里养动画宠物（Codex/Claude/DSH 通用） | 娱乐 | 原生bundle | +4 | 2026-09-28 | MIT |
| 4.1k | **ModLens 视觉识图**<br>`liustack/modlens` | 纯文本模型**直接看图**：粘贴图片返回 OCR/布局/语义证据 | 视觉识图 | 原生bundle | +6 | 2026-09-27 | MIT |
| 4.0k | **treg 工具路由器**<br>`superdesigndev/treg` | 「Agent 工具界的 OpenRouter」，统一调度工具调用 | 多Agent | 原生bundle | +41 | 2026-10-02 | NOASSERTION |
| 4.0k | **better-sidebar 侧边栏底座**<br>`omdsh-dev/DSH-better-sidebar` | 侧边栏变 IDE：文件树/终端/Git/子代理，且开放给三方扩展 | 工作台 | 原生bundle | +11 | 2026-10-01 | MIT |
| 3.9k | **dsh-TUI 终端版**<br>`ccch1mneyyy/dsh-TUI` | 官方公众号收录的 TUI：鲸鱼顶栏/流式思考/上下文进度+TPS | 终端 | 原生bundle | +28 | 2026-10-02 | MIT |
| 3.8k | **余额小鲸鱼**<br>`MeteorNOX/DeepSeek-Balance-Whale-Widget` | 右下角动画小鲸鱼盯余额，可拖拽吸附 | 娱乐 | 原生bundle | +68 | 2026-09-29 | MIT |
| 3.8k | **anchored-standard 两阶段预设**<br>`xiaobright/dsh-anchored-standard` | 先最小对齐启动、再放开全套标准工具的 preset | 预设 | 原生bundle | -1 | 2026-09-10 | NOASSERTION |
| 654 | **Our Free Model 免费模型**<br>`zouyuxuan122/dsh-our-free-model` | 免登录免 Key 用 11 个免费模型（MiMo/Nemotron/Space Bunny 等）；**本机已装并调优** | 免费模型 | 原生bundle | +72 | 2026-10-02 | MIT |
| 411 | **玻璃透明主题**<br>`WYH66666666/DSH-Transparent-UI-Plugin` | 全界面磨砂玻璃主题，模糊度/磨砂度可调 | 主题皮肤 | 原生bundle | +2 | 2026-08-22 | AGPL-3.0 |
| 148 | **插件升级 Skill**<br>`oh-my-dsh/dsh-plugin-upgrade-skill` | 让已装插件跟着 DSH 版本升级（升级顾问） | 维护 | Skill | 0 | 2026-10-01 | MIT |
| 105 | **Web 界面插件市场**<br>`Sanqi-normal/dsh-webui-market-plugin` | 在 Web GUI 里浏览目录、一键装卸到 profile | 插件市场 | 原生bundle | 0 | 2026-08-22 | MIT |
| 4 | **dsh-plugin-memory（记忆）**<br>`LittleBlackTong/dsh-plugin-memory` | 两层 markdown 记忆；**本机实测不推荐**：默认库在 `~/.memory` 且每 60 秒起一次 git 提交 | 记忆 | 原生bundle | 0 | 2026-09-29 | MIT |
| 2 | **dsh-memory 双层记忆**<br>`jipika/dsh-memory` | **本机已装的首选记忆**：全局+项目层 markdown、零外网零 Key 零定时器、审计日志、CSRF 护栏 | 记忆 | 原生bundle | +2 | 2026-10-01 | MIT |
| 1 | **DeepSeek 用量看板**<br>`AzureHalcyon/dsh-deepseek-usage` | 余额/今日用量/缓存命中/热力图，三个只读接口；**本机已装** | 用量 | 原生bundle | 0 | 2026-08-22 | GPL-2.0 |

> ≈ 表示该行星数取自上期快照（本次实时接口未取到）。

## 三、免费模型可用性（真跑一次补全）

共 12 个免费模型：**可用 7**，限流 0，地区墙 0，已下线 2，上游波动 3。

| 状态 | 模型 | 线路 | 首字延迟 | 总耗时 | 结果 |
|---|---|---|---|---|---|
| 🔁 上游波动 | `jev-1.13-free` | chat | — | 0.1s | Internal server error |
| ❌ 已下线 | `deepseek-v4-flash-free` | chat | — | 0.2s | Error from provider (Console): Upstream request failed: Model is unavailable. |
| 🔁 上游波动 | `muse-spark-1.3-contributor-free` | responses | 0.79s | 1.2s | HTTP 200 但无正文 |
| 🔁 上游波动 | `muse-spark-1.2-contributor-free` | responses | 1.10s | 1.8s | HTTP 200 但无正文 |
| ✅ 可用 | `mimo-v2.6-flash-free` | chat | 2.51s | 2.8s | "通了" |
| ✅ 可用 | `space-bunny-free` | chat | 2.17s | 3.4s | "[仅思考 271 字]" |
| ✅ 可用 | `longcat-2.5-preview-free` | chat | 1.61s | 2.3s | "通了" |
| ✅ 可用 | `mimo-v2.5-free` | chat | 1.45s | 1.8s | "通了" |
| ❌ 已下线 | `ling-3.0-flash-fin-free` | chat | — | 0.2s | Error from provider (Console): Upstream request failed: Endpoint is unavailable. |
| ✅ 可用 | `nemotron-3-ultra-free` | chat | 0.84s | 5.2s | "通了" |
| ✅ 可用 | `nemotron-3.5-lightning-free` | chat | 0.36s | 1.3s | "通了" |
| ✅ 可用 | `fledge-alpha-free` | chat | 0.76s | 1.1s | "通了" |

> 「上游波动」= 供应商临时过载/超时（已自动重试）；「已下线」= 接口明确返回模型或端点不可用。二者对使用者的含义不同，故分开列。

## 四、待审新面孔（已自动过滤蹭标签项目）

| ⭐ | 仓库 | 最近更新 | 英文简介（原样） |
|---:|---|---|---|
| 18.0k | `walkinglabs/learn-harness-engineering` | 2026-10-01 | Harness engineering beginner tutorial, from 0 to 1 |

> 这些是 `topic:dsh-plugin` 里星数较高但尚未人工核实的新项目，核实后会进入正式榜。

## 五、星数陷阱（贴了标签但不是插件）

| ⭐ | 仓库 | 为什么不算
|---:|---|---|
| 241.0k | `deepseek-ai/deepseek-harness` | DeepSeek Harness 本体，不是插件 |
| 73.6k | `ruvnet/ruflo` | 另一个 agent harness 项目 |
| 43.6k | `reactive-resume/reactive-resume` | 简历生成器，蹭标签 |
| 35.7k | `esengine/DeepSeek-Reasonix` | 独立编码代理，不是插件 |
| 33.8k | `freestylefly/awesome-gpt-image-2` | 提示词案例库，不是插件 |
| 31.5k | `Tencent/WeKnora` | LLM 知识平台，蹭标签 |
| 27.3k | `Molunerfinn/PicGo` | 图片上传工具，与 DSH 无关 |
| 24.4k | `nocobase/nocobase` | 无代码平台，蹭标签 |

## 六、方法与免责

- 插件星数为 GitHub 实时数据（GraphQL 批量取，失败时退化为逐个 REST，仍失败则用上期快照并标 ≈）。
- 中文名/中文说明/形态判断为人工策展；"形态"里的**原生bundle**指可以直接装进 DSH profile，"外部/Skill"指独立应用或技能包。
- 免费模型为**真实调用**（一条极短补全），走的就是免费模型插件自己的传输与指纹；地区墙受出口 IP 影响，换地区结论会变。
- 周报立场：只推荐本机实测过、且读过源码确认没有外网/密钥/定时器风险的项目；其余只列不荐。

## 七、影响力与流量（GitHub 真实数据）

- 本期未采集到流量数据（GitHub 流量接口需要对仓库有推送权限的 token）。

## 八、商务合作

榜单赞助位（插件作者）/ 插件定制开发 / 企业私有部署与可信插件白名单，明码标价见 [COMMERCIAL.md](../COMMERCIAL.md) 或在线页 <https://514006234.github.io/dsh-weekly-check/sponsor/>。
另有一份付费报告《DSH 插件选型与风险报告》的**公开预览**（分档结论 + 公开数据全在）：<https://514006234.github.io/dsh-weekly-check/report-preview/>
榜单排序永远按真实星数，赞助位会明确标注「赞助」，不卖榜一。

<sub>生成时间 2026-10-02T15:01:20.124Z｜数据源 tools/rank-plugins.mjs + tools/survey-free-models.mjs + tools/traffic.mjs</sub>
