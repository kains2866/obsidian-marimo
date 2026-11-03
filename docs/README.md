---
title: 文档索引
created: 2026-11-01
updated: 2026-11-02
status: current
---

# 文档索引

本目录区分**当前有效**的设计与**已废弃**的历史路线。只有「当前」栏目下的文档可作为实现依据。

## 公开与发行资料

- [英文首页](../README.md)／[中文首页](../README.zh-CN.md)：当前功能、安装、隐私与边界。
- [发行准备计划](superpowers/plans/2026-11-02-release-preparation.md)／[发行流程](RELEASING.md)／[提交材料](SUBMISSION.md)。
- [0.0.2 发行说明](releases/0.0.2.md)／[0.0.1 发行说明](releases/0.0.1.md)／[第三方许可](../THIRD_PARTY_NOTICES.md)。

下方的设计与早期验证记录保留各自日期对应的范围；当前功能以首页和源码为准。

- [本轮发行准备验证](verification/2026-11-02-release-preparation.md)：实际执行的检查与未验证边界。

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

**历史文档中「嵌入官方编辑器」「iframe」「Agent 接口」等内容均不再执行。** 当前主要界面不嵌 iframe/webview。Agent 连接管理、数据库和 Properties 未纳入本轮；可选 AI 已在后续原生实现中加入，见当前首页。

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
