---
title: marimo 与 Agent 接入开发文档索引
date: 2026-11-01
status: designReview
---

> **历史文档（已归档）**：本文记录的是「在 Obsidian 中嵌入官方 marimo 网页编辑器」路线，**已由原生 Obsidian 前端 + marimo 后端路线取代**，不再执行。原文内容保持原样，仅添加本状态标注；归档说明见同级 `history/README.md`。

# marimo 与 Agent 接入开发文档

本轮交付设计与实施计划。尚未实现 marimo 支持，尚未验证编辑器嵌入，也没有安装 marimo、改变插件版本或提交代码。用户已认可“嵌入官方编辑器，并为外部 Agent 提供连接能力”的方向；具体工程方案供后续审阅。

## 文档目录

| 文档 | 回答的问题 |
| --- | --- |
| [01 产品与交互设计](01-产品与交互设计.md) | 首版做什么、用户怎样使用、什么暂不承诺 |
| [02 技术架构与安全设计](02-技术架构与安全设计.md) | 文件、进程、环境、嵌入、认证、保存和资源如何管理 |
| [03 Agent 接口与协作契约](03-Agent接口与协作契约.md) | Agent 怎样发现正确会话，连接、修改、执行和核验 |
| [04 测试与验收矩阵](04-测试与验收矩阵.md) | 如何确认可用、安全、可恢复，哪些项目仍未测试 |
| [实施计划](../../plans/2026-11-01-marimo-integration.md) | 文件责任、分阶段任务、测试命令与阶段出口 |

## 设计决策

1. 继续保留现有 `.ipynb` 编辑与 Jupyter 运行链路；新增独立 marimo 视图及会话管理。
2. 首版由官方 marimo 编辑器负责单元格编辑和文件保存；插件负责入口、受控启动、状态和连接说明。
3. 首先验证本地官方编辑器在 Obsidian 中的真实嵌入；不能把官方发布页的 iframe 示例当作本地编辑器已兼容的证据。
4. Agent 首选官方 `marimo pair`；不建设通用远程执行 HTTP 服务，也不把 MCP 视为已具备完整写入执行能力。
5. 文件以标准 marimo `.py` 为主；不接管全部 Python 文件，不承诺首版具备 Properties、双链、大纲和 Dataview 的原生适配。
6. 代码实现、更新 Temp、commit、push、Release 是不同阶段。未来源码修改自动更新 Temp；提交和发布仍需用户明确指令。

## 阶段与发布判断

| 阶段 | 交付物 | 进入下一阶段的条件 |
| --- | --- | --- |
| P0 可行性验证 | 固定版本能力报告、宿主实测记录 | 编辑、运行、保存、认证、WebSocket、关闭保护全部有实测证据 |
| P1 本地编辑首版 | 可选安装、受控服务、marimo 标签页 | 生命周期与现有 ipynb 回归通过 |
| P2 Agent 首版 | 会话发现、官方连接说明、结果核验指南 | 正确目标与认证、能力差异、错误不误路由验证通过 |
| P3 原生融合 | 另行评估 Markdown 格式与 Obsidian 索引 | 独立需求与格式保真设计通过审阅，不作为 P1/P2 的隐性任务 |

P0 发现保存保护或隔离能力不足时停止该路线，记录具体阻断；不能通过关闭浏览器安全设置绕过。此时可保留“在系统浏览器打开”的明确降级入口，但不能宣称完成 Obsidian 内编辑。

## 当前证据与未知

- 已核对代码基线：插件 `0.7.6`，最低 Obsidian `1.8.7`，TypeScript/CodeMirror 6 与 Python 桥接。
- 2026-11-01 查询 GitHub 最新 Release：marimo `0.25.2`，发布时间 2026-10-19；该标签的 pyproject 声明 Python `>=3.10`、Apache-2.0。沿用本项目 Python 3.12 作为首个验证环境。
- marimo 官方滚动文档已有 pair、认证和嵌入说明；没有确认这些能力全部存在于 `0.25.2`。
- 尚无 marimo 的 Obsidian 宿主测试、Windows/Linux 新功能测试、保存确认协议或稳定 Agent API 兼容性证据。
- 文档中的接口与新文件名是拟议设计，不是当前插件可调用的 API。

## 官方参考

- [候选 Release 0.25.2](https://github.com/marimo-team/marimo/releases/tag/0.25.2)
- [固定标签的 Python 与许可证声明](https://github.com/marimo-team/marimo/blob/0.25.2/pyproject.toml)
- [CLI](https://docs.marimo.io/cli/) · [安全模型](https://docs.marimo.io/security/)
- [嵌入指南](https://docs.marimo.io/guides/publishing/embedding/)
- [pair](https://docs.marimo.io/guides/generate_with_ai/marimo_pair/) · [MCP](https://docs.marimo.io/guides/editor_features/mcp/)
- [文件格式和 watch](https://docs.marimo.io/guides/editor_features/watching/)

官方 main 文档与固定 Release 的差异，由 P0 能力报告记录；不得把页面更新时间当作版本支持证据。
