---
title: Obsidian 原生 marimo 首轮验证设计
created: 2026-11-01
updated: 2026-11-01
version: "0.1"
status: approvedDirection
scope:
  - obsidian-marimo
---

# 原生 marimo P0

用户已确认采用独立 Obsidian 原生前端与官方 marimo 后端路线，并授权开始。此文档替代旧项目中“嵌入官方编辑器”的路线；旧文档作为历史保留。

## 范围

独立桌面插件，工作名 MarimoNotebook。固定验证 marimo 0.25.2 / Python 3.12。前端跟随 Obsidian 主题；不嵌入官方网页。仅通过显式命令打开标准 marimo Python 文件，不抢占普通 Python 文件或现有 Bridge 的扩展关联。保留 Jupyter 插件。

验证原生代码/Markdown单元格、显式运行、修改上游后下游重算、基础安全输出、保存后由官方 marimo 重新加载。连接与执行前明确用户确认。服务仅 loopback，认证开启。退出关闭自身服务，外部服务不触碰。

首轮不实现数据库/AI界面、通用交互组件、Agent连接管理、Properties与索引、自动升级兼容承诺。若后端接口属于内部协议，必须明确锁定版本，拒绝未经验证的版本。

## 验收与风险

运行真实后端集成测试：初始 x=2、下游 x*3 输出6；只修改 x=4 后下游输出12；保存并检查官方可加载。另测错误输出、取消关闭、文件不被意外覆盖。原生宿主测试须与协议测试分开记录；未实测不得声称通过。

## 修订记录

- 2026-11-01：根据用户确认建立独立原生路线。

> 名称更新：工作名 MarimoNotebook 后续调整为 Marimo Native，插件 ID 为 `marimo-native`。
