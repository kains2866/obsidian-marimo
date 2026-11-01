---
title: 原生界面完善实施计划
created: 2026-11-01
updated: 2026-11-01
version: "0.3"
status: implemented
scope:
  - obsidian-marimo-notebook
---

# 原生界面完善计划

依据 [界面方案](../specs/2026-11-01-native-ui-design.md)。测试先行：每项行为改动先写失败测试，再实现。

当前进度：**已实施，全部子项均已实测通过**。勾选表示该子项在真实 Obsidian 宿主（Temp vault）中验证过；未实测项在文末明确列出。

## 约束

- 不改后端协议、不改保存格式、不嵌 iframe/webview。
- 不修改 `obsidian-ipynb` 项目；只在只读意义下参考。
- 保留全部现有修复，不回退别人的改动。
- 测试不得执行用户已有 demo，不改用户笔记。

## 步骤

### U1 状态模型（纯函数，可测）

- [x] `tests/status.test.ts` 先失败后通过：未连接、连接中、运行中、结束、失败、代码修改、未保存、已保存，中英文文案与忙碌标记。
- [x] `src/status.ts`：`statusView()`、`toolbarAvailability()`、`environmentLabel()`。
- [x] 运行中只显示「运行中…」，不叠加修饰（防抖动），有测试覆盖。
- [x] `shouldApplyResult()` 会话归属守卫，有测试覆盖：停止/重连后旧请求不得写回状态。

### U2 工具栏

- [x] 单行紧凑工具栏：连接 / 运行全部 / 保存 / 停止并断开 / 恢复草稿，右侧环境与状态（宿主实测高度 44px）。
- [x] `data-action` 固定标识，宿主脚本按动作定位，不依赖数组下标。
- [x] 连接成功隐藏连接按钮；`setBusy` 改由可用性统一驱动，忙时禁用重复动作（已实测：运行中与保存中运行/保存均禁用）。
- [x] 停止改为真实断开：等待自身子进程退出、释放 writer lease、单元格转回只读（已实测进程消失、`state.readOnly` 为 true）。
- [x] 运行中仍可点击停止：停止不因 `running` 被禁用，点击后取消当前请求并断开。
- [x] 旧请求 `finally` 不覆盖「已停止」状态（宿主复测通过：停止后 1.5s 无迟到 Notice、busy 为 false、状态保持未连接）。

### U2b 会话守卫（`tests/session-guard.test.ts`，先失败后通过）

- [x] `canAdoptClaim()`：停止在 `await plugin.claim` 期间使 `loadGeneration` 失效，迟到的 claim 被释放而不启动内核（宿主实测：claim 延迟 1.6s 期间点击停止，2.4s 后无任何 fixture 进程、无 lease）。
- [x] `shouldApplyStopResult()`：`stop()` 的 `finally` 带 generation/operation 双守卫，换文件或重连后不得回滚新状态（宿主实测：延迟 close 1.5s 期间换文件，新文件状态不被重置、无残留进程）。
- [x] `connectionState()`：`connecting` 优先于 backend 对象存在；`start()` 未返回前运行/保存禁用、停止可用（宿主实测）。
- [x] `toolbarAvailability()` 纳入 `busy`：保存请求在途时运行/保存禁用、停止可用（宿主实测：延迟 save 1.2s 期间按钮禁用）。
- [x] 长运行停止后重连：旧进程确认退出、新 pid 正常运行结束、无迟到错误（宿主实测）。

### U3 单元格

- [x] 左侧运行入口 `setIcon('play')`，带 `aria-label` 与 `title`（宿主实测图标存在）。
- [x] 竖槽与内容分离为网格列，只读时隐藏按钮且列宽不变。
- [x] 悬停中性条、选中强调条，选中由点击与聚焦共同驱动（浅色/深色截图可见）。
- [x] 代码区灰底、最小高度 56px、输出仅在有内容时显示分隔。
- [x] 空 HTML 输出不再生成空白分隔条（最终构建复测确认）。
- [x] 只读回退、空 Notebook、预览错误三种状态均有提示样式。

### U4 输出与响应式

- [x] `src/output-policy.ts` + `tests/output-policy.test.ts`：脚本/图片/事件属性拦截，表格结构属性保留。
- [x] 表格容器横向滚动；窄窗口 480px 实测无横向溢出（`scrollWidth <= clientWidth`）。
- [x] 深浅色均取自主题变量，实测深色下代码区 `#282828`、输出区 `#1c1c1c`。
- [x] 不支持的输出只显示类型说明，不放按钮。

### U5 验证

- [x] Node 47 项 / Python 32 项全量通过；typecheck、build 通过。
- [x] 三文件安装到 Temp 插件目录并 `plugin:reload`（main.js sha256 `7d84a100…d0daa`，dist 与安装目录一致）。
- [x] `assets/verify-native-opening.py` 跑通：唯一 fixture 覆盖点击、预览、连接、运行、保存、运行中停止、换页清理、旧 filename 状态恢复，并检查工具栏动作与输出布局。
- [x] `assets/verify-session-guards.py` 跑通：延迟 claim 停止、start 前不开放运行、保存中禁用、长运行停止后重连、停止中换文件。
- [x] 浅色预览/浅色连接/深色连接/窄窗口截图归档（`assets/ui-*.png`，最终构建拍摄）。
- 未实测项：真实深色系统主题（Temp 宿主跟随系统浅色，仅以 body 类切换近似验证）；触屏/键盘快捷键全流程。

### U6 第二轮完善（参考 obsidian-ipynb 前端样式）

- [x] 测试先行：`normalizeCellStatus`/`showPrototypeInfo`/`isErrorOutput` 共 6 项新用例先失败后通过（Node 53 项全绿）。
- [x] 单元格焦点环与选中态恢复：宿主实测点击后 `is-selected`、强调色边框 + 1px 光晕；连接重渲染后选中态不丢失。
- [x] 活动行高亮：真实点击聚焦后 `.cm-activeLine` 背景为 `--background-primary`，非聚焦透明。
- [x] 错误着色：错误输出 `is-error` 颜色等于主题 `--text-error`（浅色 rgb(233,49,71)、深色 rgb(251,70,76) 实测）。
- [x] 单元格状态：宿主观察到 `running` 状态且图标为 `lucide-loader-2`；停止后状态与图标全部清理；`idle` 状态由 cell-op 事件写入。
- [x] 提示收纳：连接前显示、连接后隐藏、断开后恢复；普通脚本不显示。
- [x] 深浅色与 480px 窄窗截图归档（`assets/ui2-light-connected.png`、`ui2-dark-error.png`、`ui2-narrow.png`）；窄窗收起侧栏后 body 无横向溢出（420/420）。
- [x] 回归：`assets/verify-native-opening.py` 在新构建上重跑通过；`assets/verify-ui-polish.py` 为本轮专用实证脚本，结果存 `assets/ui-polish-verification.json`。
- 未实测项：真实深色系统主题（仍以 body 类近似）；触屏设备上的状态可发现性。

## 测试命令

```bash
npm test
npm run typecheck
npm run build
/Users/tiyukains/.local/share/uv/tools/marimo/bin/python -m unittest discover -s tests
/Users/tiyukains/.local/share/uv/tools/marimo/bin/python ../assets/verify-native-opening.py
/Users/tiyukains/.local/share/uv/tools/marimo/bin/python ../assets/verify-session-guards.py
```

## 修订记录

- 2026-11-01：建立计划。
- 2026-11-01：按实际进度回落为 inProgress；仅勾选已实测子项，补齐「运行中可停止」与会话守卫条目。
- 2026-11-01：会话守卫（U2b）全部实测通过，全量验证与截图完成，状态改为 implemented。
- 2026-11-01：新增 U6 第二轮完善（参考 obsidian-ipynb 样式），五项打磨全部实施并宿主实证。
