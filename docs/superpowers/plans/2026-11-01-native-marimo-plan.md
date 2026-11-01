---
title: 原生 marimo P0 实施计划
created: 2026-11-01
updated: 2026-11-01
version: "0.1"
status: inProgress
scope:
  - obsidian-marimo
---

# Native marimo P0 Implementation Plan

执行使用 executing-plans 与 test-driven-development；提交和发布等待用户指令。

**Goal:** 打通原生 Obsidian 前端与固定版本 marimo 后端的编辑、响应式执行和保存链路。

**Architecture:** 独立插件调用 Python 适配进程；适配进程负责认证、会话和 marimo 协议，前端通过 JSON 行通信。输出只接受白名单类型，不执行返回的脚本。先以真实后端验证协议再决定后续扩展。

**Tech Stack:** TypeScript、Obsidian、Python 3.12、marimo 0.25.2 自带 websockets。

## Global Constraints

仅本机认证连接；不修改现有 Jupyter 插件；不占用用户现有2718服务；不提交、不发布；P0不承诺完整marimo功能。

## Tasks

- [x] T1：WorkBuddy 只读调查本机固定版本源码，返回 WebSocket、REST、认证、保存与输出消息字段，核对内部协议风险。
- [x] T2：tests/test_backend.py 先定义真实编辑、下游响应式、保存集成验收；在 python/backend.py 未实现时运行，确认失败。
- [x] T3：python/backend.py 实现最小适配层。仅使用自己创建的临时文件与服务测试；确保 finally 停止进程，输出不暴露 token。
- [x] T4：src/main.ts 与 src/view.ts 实现独立原生视图、明确执行入口与关闭清理；styles.css 使用 Obsidian 字体与颜色变量。测试状态转换与消息解析，再构建。
- [ ] T5：独立代码审查并修复高优先级问题；安装到Temp、进行宿主验证。记录通过/未验证项，不以接口测试冒充宿主验证。

验证命令：marimo工具环境Python执行 unittest discover；现有TypeScript工具链执行 typecheck/build。产物保存 assets，记录 docs；不创建Git提交。

## 修订记录

- 2026-11-01：建立首轮验证计划。

## 阶段交付记录

- 2026-11-01：P0核心链路已实测并安装Temp；独立审查反馈已处理，修复后定向复审仍待结论。后续完整开发不作为本轮已完成项。
