---
title: 历史文档归档
created: 2026-11-01
status: archived
---

# 历史文档：网页嵌入路线（已废弃）

> **本目录全部文档均为历史资料。所记录的路线是「在 Obsidian 中嵌入官方 marimo 网页编辑器」，该路线已由「原生 Obsidian 前端 + marimo 后端」取代。当前设计与计划见 `docs/README.md` 与 `docs/superpowers/`。历史方案不再执行，也不作为当前实现依据。**

## 来源

| 项目 | 原位置 |
| --- | --- |
| 5 份设计文档 | `obsidian-ipynb-workspace/docs/superpowers/specs/2026-11-01-marimo-integration/` |
| 1 份实施计划 | `obsidian-ipynb-workspace/docs/superpowers/plans/2026-11-01-marimo-integration.md` |

原文件保留在原 Jupyter 项目工作区未删除，此处为迁入本仓库的副本。理由：迁移只应带走 marimo 路线相关文档，删除会破坏对方工作区自身的文档索引，且本项目不应改动 Jupyter 项目。

## 迁移处理

- 目录结构保留为 `history/superpowers/{specs,plans}/`，与原始相对层级一致，因此文档之间的相对链接（`01-…md`、`../../plans/…`、`../specs/…`）无需改写即可继续生效。
- 正文内容未作删改。仅在每份文件 frontmatter 之后插入一行可见的状态标注，说明其已被原生路线取代。
- `status: designReview` 等原始 frontmatter 字段按原样保留，以维持来源可追溯；其「未实现/待审阅」语义仅在当时成立。

## 为何废弃

原方案依赖官方编辑器网页嵌入，需要处理 iframe/webview 隔离、认证桥接和宿主样式冲突，且无法获得原生 Obsidian 的编辑、主题与键盘行为。原生路线直接以 Obsidian 视图渲染单元格，由固定版本 marimo 后端执行，边界更清晰：

1. 不嵌 iframe/webview，交互与主题由 Obsidian 本体负责。
2. 后端只作为执行与保存服务，内部协议锁定 marimo 0.25.2。
3. 文件仍是官方 marimo 标准 `.py`，可被官方 CLI 重新加载。

具体取舍见 `docs/superpowers/specs/2026-11-01-native-marimo-design.md`。
