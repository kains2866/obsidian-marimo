---
title: 文档索引
created: 2026-11-01
updated: 2026-11-01
status: current
---

# 文档索引

本目录区分**当前有效**的设计与**已废弃**的历史路线。只有「当前」栏目下的文档可作为实现依据。

## 当前：原生路线（有效）

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [原生设计](superpowers/specs/2026-11-01-native-marimo-design.md) | 已批准方向：独立 Obsidian 原生前端 + 固定版本 marimo 后端 | 已批准 |
| [实施计划](superpowers/plans/2026-11-01-native-marimo-plan.md) | P0 任务拆分与阶段出口 | 进行中 |
| [验证记录](superpowers/specs/2026-11-01-native-marimo-verification.md) | 已执行项、协议核对结论、未验证项 | 原型已验证，含未完成项 |
| [UI 方案](superpowers/specs/2026-11-01-native-ui-design.md) | 工具栏、单元格、输出与状态的界面规范 | 已实施（含会话守卫） |
| [UI 分步计划](superpowers/plans/2026-11-01-native-ui-plan.md) | UI 改造的测试先行步骤与验收 | 已实施，全部子项已实测 |

## 历史：网页嵌入路线（已废弃，勿执行）

| 文档 | 内容 |
| --- | --- |
| [历史归档说明](history/README.md) | 归档范围、来源、迁移处理与废弃原因 |
| [设计文档 5 份](history/superpowers/specs/2026-11-01-marimo-integration/README.md) | 产品交互、技术架构、Agent 契约、测试矩阵 |
| [实施计划](history/superpowers/plans/2026-11-01-marimo-integration.md) | 原网页嵌入路线的分阶段任务 |

**历史文档中「嵌入官方编辑器」「iframe」「Agent 接口」等内容均不再执行。** 当前实现不嵌 iframe/webview，不新增 Agent 连接管理，不做数据库/AI/Properties 集成。

## 相关位置

- 源码与构建：仓库根 `src/`、`python/`、`tests/`、`dist/`（产物，不入库）
- 示例 notebook：[examples/marimo-showcase.py](examples/marimo-showcase.py)，覆盖面见[验证记录](superpowers/specs/2026-11-01-native-marimo-verification.md)
- 宿主验证素材：工作区 `../assets/`（截图、JSON 证据、验证脚本；生成物不入库）
- 项目规则：仓库根 `AGENTS.md`

## 阅读顺序建议

1. 先看[原生设计](superpowers/specs/2026-11-01-native-marimo-design.md)确定范围与边界。
2. 再看[验证记录](superpowers/specs/2026-11-01-native-marimo-verification.md)了解哪些结论有实测支撑、哪些没有。
3. 涉及界面改动时读 [UI 方案](superpowers/specs/2026-11-01-native-ui-design.md)。
4. 只有在追溯「为什么放弃网页嵌入」时才读 `history/`。
